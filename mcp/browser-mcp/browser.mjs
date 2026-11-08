import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mapHosts, settled } from './hosts.mjs';

const id = () => randomBytes(8).toString('hex');
const SESSIONS = /^https?:\/\/.+\/v1\/sessions\/?$/;
export function taggedUrl(value, run, enabled = true) {
  const url = new URL(value);
  if (!['http:', 'https:', 'about:'].includes(url.protocol) || (url.protocol === 'about:' && value !== 'about:blank')) {
    throw new Error('Use an http(s) URL or about:blank.');
  }
  if (enabled && ['http:', 'https:'].includes(url.protocol)) url.searchParams.set('run', run);
  return url.href;
}

export class BrowserState {
  constructor({ cdp, stateFile, hooks = {}, steel = {}, hostMap = {} }) {
    this.cdp = cdp; this.stateFile = stateFile; this.hooks = hooks; this.steel = steel; this.hostMap = hostMap; this.steelSession = null;
    this.sessions = {}; this.handles = new Map(); this.captures = new Map(); this.queues = new Map();
    this.saving = Promise.resolve(); this.connecting = null; this.connection = null;
  }
  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (saved.version !== 1 || saved.cdp !== this.cdp) throw new Error('State version or browser endpoint differs; use a separate state directory.');
      this.sessions = saved.sessions;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  async save() {
    const data = JSON.stringify({ version: 1, cdp: this.cdp, sessions: this.sessions }, null, 2);
    const write = this.saving.then(async () => {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
      await fs.writeFile(this.stateFile + '.tmp', data, { mode: 0o600 });
      await fs.rename(this.stateFile + '.tmp', this.stateFile);
    });
    this.saving = write.catch(() => {});
    return write;
  }
  async lock(key, work) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    this.queues.set(key, current);
    try { return await current; } finally { if (this.queues.get(key) === current) this.queues.delete(key); }
  }
  session(run) {
    const session = this.sessions[run];
    if (!session) throw new Error(`Unknown run ${run}. Use session_list or session_start.`);
    return session;
  }
  async browser() {
    if (this.connection?.isConnected()) return this.connection;
    if (!this.connecting) this.connecting = (async () => {
      // An http(s) address is Chrome's own: make sure it has a tab before attaching. A ws(s) address is a
      // browser service's endpoint, with no /json to ask: a tab is opened once attached. An address ending in
      // /v1/sessions is a session API (Steel's, https://api.steel.dev/v1/sessions, or a self-hosted one): a
      // session is created there and attached by the endpoint it gives.
      const endpoint = SESSIONS.test(this.cdp) ? await this.startSession() : this.cdp;
      const http = /^https?:/.test(endpoint);
      if (http) {
        const targets = await fetch(`${this.cdp}/json`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
        if (!targets.some(t => t.type === 'page')) {
          const response = await fetch(`${this.cdp}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error('Could not create initial Chrome tab.');
        }
      }
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
      const context = browser.contexts()[0] ?? await browser.newContext();
      if (Object.keys(this.hostMap).length) await mapHosts(context, this.hostMap);
      await this.hook('onConnect', { browser, context, mapHosts });
      if (!http && !context.pages().length) await context.newPage();
      this.connection = browser;
      browser.on('disconnected', () => { this.connection = null; this.steelSession = null; this.handles.clear(); this.captures.clear(); });
      return browser;
    })().catch(error => { throw new Error(`Browser unavailable at ${this.cdp}: ${error.message}`); }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  // A session from the session API: one per connection, on the account's profile when one is named (read, never
  // saved back), released when it times out or the service stops; watched at its page in Steel's dashboard.
  async startSession() {
    const { key, timeout = 900000, profile } = this.steel;
    const response = await fetch(this.cdp.replace(/\/$/, ''), { method: 'POST', headers: { ...(key ? { 'steel-api-key': key } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ timeout, ...(profile ? { profileId: profile } : {}) }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`The session API refused a session: ${response.status} ${(await response.text()).slice(0, 200)}${key ? '' : ' (STEEL_API_KEY is not set)'}`);
    const session = await response.json();
    this.steelSession = session.id;
    console.log(`Session ${session.id}: watch it at ${session.sessionViewerUrl ?? session.debugUrl ?? 'its dashboard'}`);
    if (!session.websocketUrl) throw new Error('The session API gave no websocketUrl to attach to.');
    return session.websocketUrl;
  }
  async targetId(page) {
    const cdp = await page.context().newCDPSession(page);
    try { return (await cdp.send('Target.getTargetInfo')).targetInfo.targetId; } finally { await cdp.detach(); }
  }
  bind(tab, page) {
    this.handles.set(tab, page);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) this.captures.delete(tab); });
    page.on('close', () => { this.handles.delete(tab); this.captures.delete(tab); });
    return page;
  }
  async page(run, tab) {
    const meta = this.session(run).tabs[tab];
    if (!meta) throw new Error(`Tab ${tab} does not belong to run ${run}.`);
    const existing = this.handles.get(tab);
    if (existing && !existing.isClosed()) return existing;
    // Target IDs survive MCP/service restarts and cross-origin navigations.
    // Never adopt a tab just because a website supplies a run query parameter.
    const browser = await this.browser();
    for (const page of browser.contexts().flatMap(c => c.pages())) {
      if (await this.targetId(page).catch(() => null) === meta.targetId) return this.bind(tab, page);
    }
    throw new Error(`Tab ${tab} is no longer open. Close its record or create a new tab; unrelated tabs will not be adopted.`);
  }
  async tag(run, page) {
    if (!this.session(run).tagUrls || !/^https?:/.test(page.url())) return;
    const value = taggedUrl(page.url(), run);
    if (value !== page.url()) await page.evaluate(url => history.replaceState(history.state, '', url), value);
  }
  // The tool waits on the hook's promise: it returns once the hook is done with the page.
  async hook(name, context) {
    if (!this.hooks[name]) return;
    try { await this.hooks[name](context); } catch (error) { throw new Error(`${name} hook: ${error.message ?? error}`); }
  }
  // The address to open: what the before-navigation hook makes of the one given — e.g. a relative one resolved against a site.
  async resolve(url, run) {
    if (!this.hooks.beforeNavigation) return url;
    try { return await this.hooks.beforeNavigation({ url, run }) ?? url; } catch (error) { throw new Error(`beforeNavigation hook: ${error.message ?? error}`); }
  }
  async addTab(run, url = 'about:blank') {
    const session = this.session(run);
    const address = taggedUrl(await this.resolve(url, run), run, session.tagUrls);
    const context = (await this.browser()).contexts()[0];
    if (!context) throw new Error('Chrome has no browser context.');
    const page = await context.newPage();
    const tab = id();
    try {
      const targetId = await this.targetId(page);
      session.tabs[tab] = { targetId, createdAt: new Date().toISOString() };
      this.bind(tab, page);
      await this.save();
      if (address !== 'about:blank') {
        await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await settled(page);
        await this.hook('afterNavigation', { page, url: page.url() });
      }
      await this.tag(run, page);
      return { run, tab, url: page.url() };
    } catch (error) {
      await page.close().catch(() => {});
      delete session.tabs[tab]; await this.save(); throw error;
    }
  }
  async start({ name, tagUrls = true, url = 'about:blank' }) {
    const run = id();
    this.sessions[run] = { name: name ?? '', createdAt: new Date().toISOString(), tagUrls, tabs: {} };
    try { return await this.addTab(run, url); }
    catch (error) { delete this.sessions[run]; await this.save(); throw error; }
  }
  async listTabs(run) {
    const tabs = [];
    for (const tab of Object.keys(this.session(run).tabs)) {
      try {
        const page = await this.page(run, tab);
        tabs.push({ tab, open: true, url: page.url(), title: await page.title() });
      } catch (error) { tabs.push({ tab, open: false, error: error.message }); }
    }
    return { run, tabs };
  }
  async closeTab(run, tab) {
    const meta = this.session(run).tabs[tab];
    if (!meta) throw new Error(`Tab ${tab} does not belong to run ${run}.`);
    // If Chrome is unreachable, retain the ownership record for a later retry.
    const browser = await this.browser();
    const pages = browser.contexts().flatMap(c => c.pages());
    for (const page of pages) {
      if (await this.targetId(page).catch(() => null) === meta.targetId) { await page.close(); break; }
    }
    delete this.session(run).tabs[tab]; this.handles.delete(tab); this.captures.delete(tab);
    await this.save(); return { run, tab, closed: true };
  }
  async close(run) {
    const tabs = Object.keys(this.session(run).tabs);
    for (const tab of tabs) await this.closeTab(run, tab);
    delete this.sessions[run]; await this.save();
    return { run, closed: tabs.length };
  }
  async withTab(run, tab, work) {
    return this.lock(run, async () => {
      const page = await this.page(run, tab);
      await this.tag(run, page);
      return work(page);
    });
  }
  async snapshot(run, tab, locator) {
    this.captures.delete(tab);
    const count = await locator.count();
    if (count !== 1) throw new Error(`Capture must identify exactly one element; ${count} matched. Use a more specific selector.`);
    await locator.scrollIntoViewIfNeeded({ timeout: 10000 });
    const yaml = await locator.ariaSnapshot({ mode: 'ai' });
    const captureId = id();
    this.captures.set(tab, { captureId, refs: new Set([...yaml.matchAll(/\[ref=([^\]]+)\]/g)].map(m => m[1])) });
    return { run, tab, captureId, yaml };
  }
  async ref(run, tab, captureId, ref) {
    const capture = this.captures.get(tab);
    if (!capture || capture.captureId !== captureId || !capture.refs.has(ref)) {
      throw new Error('Stale or foreign ref/captureId. Capture this tab again before acting.');
    }
    const page = await this.page(run, tab);
    const target = page.locator(`aria-ref=${ref}`);
    if (await target.count() !== 1) throw new Error('Ref no longer identifies one element. Capture again.');
    return target;
  }
  async disconnect() {
    await this.saving;
    if (this.connection) await this.connection.close(); // Disconnect CDP; does not close external Chrome.
    if (this.steelSession) await fetch(`${this.cdp.replace(/\/$/, '')}/${this.steelSession}/release`, { method: 'POST', headers: this.steel.key ? { 'steel-api-key': this.steel.key } : {}, signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
}
