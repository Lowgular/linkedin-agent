import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, get } from 'node:http';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serve } from '../server.mjs';
import { taggedUrl } from '../browser.mjs';

test('URL tags preserve existing query/hash and reject executable/local URLs', () => {
  assert.equal(taggedUrl('https://example.com/path?q=1#section', 'abc'), 'https://example.com/path?q=1&run=abc#section');
  assert.equal(taggedUrl('https://example.com/?q=1', 'abc', false), 'https://example.com/?q=1');
  assert.equal(taggedUrl('about:blank', 'abc'), 'about:blank');
  for (const url of ['javascript:alert(1)', 'file:///tmp/test', 'data:text/html,Hi']) assert.throws(() => taggedUrl(url, 'abc'));
});

const executablePath = process.env.BROWSER_MCP_TEST_CHROME;
test('shared HTTP clients: generic UI, ownership, stale refs, isolation and service restart', { skip: !executablePath, timeout: 90000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-mcp-test-'));
  const fixture = createServer((req, res) => res.end(`<!doctype html><title>Generic fixture</title><main><section><h2>Details</h2><label>Name <input aria-label="Name"></label><button onclick="document.querySelector('output').textContent='Saved'" ondblclick="document.querySelector('output').textContent='Opened'">Save</button><output>Waiting</output></section><section><h2>Other</h2><p>Other section text</p></section><div><input type="file" aria-label="Direct" onchange="document.querySelector('#picked').textContent=[...this.files].map(f=>f.name).join(',')"><input type="file" id="hidden" hidden multiple onchange="document.querySelector('#picked').textContent='via button: '+[...this.files].map(f=>f.name).join(',')"><button onclick="document.querySelector('#hidden').click()">Browse</button><output id="picked">none</output></div><div style="height:1200px">Long content</div></main>`));
  let context, service;
  const clients = [];
  const connect = async () => {
    const client = new Client({ name: 'integration-client', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.server.address().port}/mcp`)));
    clients.push(client); return client;
  };
  const call = async (client, name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert(!response.isError, JSON.stringify(response));
    return response.structuredContent;
  };
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${fixture.address().port}/`;
    context = await chromium.launchPersistentContext(path.join(temp, 'chrome'), { executablePath, headless: true, args: ['--remote-debugging-port=0'] });
    const [cdpPort] = (await fs.readFile(path.join(temp, 'chrome/DevToolsActivePort'), 'utf8')).split('\n');
    const cdp = `http://127.0.0.1:${cdpPort}`;
    const stateFile = path.join(temp, 'state.json');
    // Hooks record what they were called for; the service awaits them in its own process.
    const hookFile = path.join(temp, 'hook.mjs');
    await fs.writeFile(hookFile, "export default async ({ page, action, url }) => { (globalThis.devBrowserHookCalls ??= []).push(action ?? 'navigate'); }");
    // The before-navigation hook resolves a relative address against the fixture, and refuses one it is told to.
    const resolveFile = path.join(temp, 'resolve.mjs');
    await fs.writeFile(resolveFile, `export default ({ url }) => { if (url === '/refuse') throw new Error('refused'); return url.startsWith('/') ? '${url}'.slice(0, -1) + url : url; }`);
    const hooks = { beforeNavigation: resolveFile, afterAction: hookFile, afterNavigation: hookFile };
    globalThis.devBrowserHookCalls = [];
    service = await serve({ port: 0, cdp, stateFile, hooks });
    const a = await connect(), b = await connect();
    const list = await a.listTools();
    assert.equal(list.tools.length, 20);
    assert(!list.tools.some(t => /topCard|threadCapture|profile/i.test(t.name)));
    const health = `http://127.0.0.1:${service.server.address().port}/health`;
    assert.equal((await fetch(health, { headers: { Origin: 'https://example.com' } })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      get(health, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(badHostStatus, 403);
    const first = await call(a, 'session_start', { name: 'first', url });
    const second = await call(b, 'session_start', { name: 'second', url, tagUrls: false });
    const ids = { run: first.run, tab: first.tab };
    assert.equal(new URL(first.url).searchParams.get('run'), first.run);
    assert.equal(new URL(second.url).searchParams.get('run'), null);
    assert.equal((await call(b, 'session_list')).sessions.length, 2);
    const foreign = await b.callTool({ name: 'tab_close', arguments: { run: second.run, tab: first.tab } });
    assert.equal(foreign.isError, true);
    const section = await call(a, 'capture_section', { ...ids, heading: 'Details' });
    assert(section.yaml.includes('Save')); assert(!section.yaml.includes('Other section'));
    const inputRef = section.yaml.match(/textbox "Name"[^\n]*\[ref=([^\]]+)\]/)[1];
    const newer = await call(b, 'capture', ids);
    assert.equal((await a.callTool({ name: 'fill', arguments: { ...ids, captureId: section.captureId, ref: inputRef, text: 'stale' } })).isError, true);
    const freshRef = newer.yaml.match(/textbox "Name"[^\n]*\[ref=([^\]]+)\]/)[1];
    await call(a, 'fill', { ...ids, captureId: newer.captureId, ref: freshRef, text: 'Hello' });
    let snap = await call(b, 'capture_section', { ...ids, heading: 'Details' });
    assert(snap.yaml.includes('Hello'));
    await call(b, 'type', { ...ids, captureId: snap.captureId, ref: snap.yaml.match(/textbox "Name"[^\n]*\[ref=([^\]]+)\]/)[1], text: ' world' });
    snap = await call(a, 'capture_section', { ...ids, heading: 'Details' });
    assert(snap.yaml.includes('Hello world'));
    await call(a, 'click', { ...ids, captureId: snap.captureId, ref: snap.yaml.match(/button "Save"[^\n]*\[ref=([^\]]+)\]/)[1] });
    await call(a, 'wait_for_text', { ...ids, text: 'Saved' });
    // A double-click reaches the page as one: the fixture's output counts dblclick events.
    await call(a, 'navigate', { ...ids, url: url + '?dbl=1' });
    snap = await call(a, 'capture', ids);
    await call(a, 'double_click', { ...ids, captureId: snap.captureId, ref: snap.yaml.match(/button "Save"[^\n]*\[ref=([^\]]+)\]/)[1] });
    await call(a, 'wait_for_text', { ...ids, text: 'Opened' });
    await call(a, 'scroll', { ...ids, amount: 500 });
    const extra = await call(b, 'tab_open', { run: first.run, url });
    assert.equal((await call(a, 'tab_list', { run: first.run })).tabs.length, 2);
    await call(a, 'navigate', { ...ids, url: url + '?new=1' });
    assert((await call(a, 'page_info', ids)).url.includes('run='));
    const relative = await call(a, 'navigate', { ...ids, url: '/?relative=1' });
    assert(relative.url.startsWith(url + '?relative=1'), relative.url);
    const refused = await a.callTool({ name: 'navigate', arguments: { ...ids, url: '/refuse' } });
    assert(refused.isError && refused.content[0].text.includes('beforeNavigation hook: refused'), JSON.stringify(refused));
    const save = await call(a, 'capture_by_role', { ...ids, role: 'button', name: '^Save$' });
    assert(save.yaml.includes('button "Save"'));
    const ambiguous = await a.callTool({ name: 'capture_by_role', arguments: { ...ids, role: 'heading', name: 'e' } });
    assert(ambiguous.isError && ambiguous.content[0].text.includes('2 matched'), JSON.stringify(ambiguous));
    const invalid = await a.callTool({ name: 'capture_by_role', arguments: { ...ids, role: 'button', name: '(' } });
    assert(invalid.isError && invalid.content[0].text.includes('not a valid regular expression'), JSON.stringify(invalid));
    assert.deepEqual(globalThis.devBrowserHookCalls, ['navigate', 'navigate', 'fill', 'type', 'click', 'navigate', 'double_click', 'navigate', 'navigate', 'navigate']);
    // Files go into a file input, directly or through the chooser a button opens.
    const upload = path.join(temp, 'upload.txt'), other = path.join(temp, 'second.txt');
    await fs.writeFile(upload, 'one'); await fs.writeFile(other, 'two');
    snap = await call(a, 'capture', ids);
    await call(a, 'pick_files', { ...ids, captureId: snap.captureId, ref: snap.yaml.match(/"Direct"[^\n]*\[ref=([^\]]+)\]/)[1], files: [upload] });
    await call(a, 'wait_for_text', { ...ids, text: 'upload.txt' });
    snap = await call(a, 'capture', ids);
    const picked = await call(a, 'pick_files', { ...ids, captureId: snap.captureId, ref: snap.yaml.match(/button "Browse"[^\n]*\[ref=([^\]]+)\]/)[1], files: [upload, other] });
    assert.deepEqual(picked.picked, ['upload.txt', 'second.txt']);
    await call(a, 'wait_for_text', { ...ids, text: 'via button: upload.txt,second.txt' });
    snap = await call(a, 'capture', ids);
    const nowhere = await a.callTool({ name: 'pick_files', arguments: { ...ids, captureId: snap.captureId, ref: snap.yaml.match(/button "Browse"[^\n]*\[ref=([^\]]+)\]/)[1], files: ['relative.txt'] } });
    assert(nowhere.isError && nowhere.content[0].text.includes('No file at relative.txt'), JSON.stringify(nowhere));
    // Disconnect every client and restart the service. Tabs and sessions must survive.
    for (const client of clients.splice(0)) await client.close();
    await service.close(); service = await serve({ port: 0, cdp, stateFile, hooks });
    const c = await connect();
    assert.equal((await call(c, 'session_list')).sessions.length, 2);
    assert.equal((await call(c, 'page_info', ids)).title, 'Generic fixture');
    assert.equal((await c.callTool({ name: 'click', arguments: { ...ids, captureId: snap.captureId, ref: freshRef } })).isError, true);
    await call(c, 'tab_close', { run: first.run, tab: extra.tab });
    await call(c, 'session_close', { run: first.run });
    assert.equal((await call(c, 'tab_list', { run: second.run })).tabs[0].open, true);
    await call(c, 'session_close', { run: second.run });
    assert.equal((await call(c, 'session_list')).sessions.length, 0);
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    await service?.close(); await context?.close();
    await new Promise(resolve => fixture.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
