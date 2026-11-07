import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { taggedUrl } from './browser.mjs';

const identifier = z.string().regex(/^[a-f0-9]{16}$/);
const RUN = { run: identifier.describe('Browser session ID from session_start; share this to resume a task.') };
const TAB = { ...RUN, tab: identifier.describe('Tab ID belonging to this run, from session_start, tab_open or tab_list.') };
const REF = { ...TAB, captureId: identifier.describe('ID of the latest capture of this tab.'), ref: z.string().regex(/^[a-z]?\d*e\d+$/).describe('Element ref from that capture.') };
const timeout = z.number().int().min(1).max(60).default(15);

export function createServer(state) {
  const server = new McpServer({ name: 'browser-mcp', version: '0.1.0' }, {
    instructions: 'Generic browser tools. Start a session or resume a listed run; every page operation names its run and tab. Capture the page or a section, then use its refs and captureId. A newer capture or action invalidates old refs. Sessions outlive clients. Close only sessions/tabs you own or were asked to close. All sessions share the browser login profile; run IDs separate tabs, not cookies or permissions.',
  });
  const tool = (name, description, inputSchema, handler, readOnly = false) => {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly } }, async input => {
      try {
        const result = await handler(input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message ?? String(error) }] };
      }
    });
  };
  tool('session_start', 'Start a named browser session with one new tab. Persists until explicitly closed, independent of the calling agent. HTTP URLs get a run query parameter by default; disable tagUrls for sites that cannot accept it.', {
    name: z.string().max(200).optional(), url: z.string().default('about:blank'), tagUrls: z.boolean().default(true),
  }, input => state.start(input));
  tool('session_list', 'List shared sessions, their names and tab IDs so another task or harness can resume a run.', {}, async () => ({ sessions: Object.entries(state.sessions).map(([run, s]) => ({ run, name: s.name, createdAt: s.createdAt, tagUrls: s.tagUrls, tabs: Object.keys(s.tabs) })) }), true);
  tool('session_close', 'Close all tabs owned by this session and remove its record. Does not close other sessions or the browser.', RUN, ({ run }) => state.lock(run, () => state.close(run)));
  tool('tab_open', 'Add a tab to an existing session, optionally navigating to an HTTP(S) URL.', { ...RUN, url: z.string().default('about:blank') }, ({ run, url }) => state.lock(run, () => state.addTab(run, url)));
  tool('tab_list', 'List the tabs of one session and their current URLs, titles and availability.', RUN, ({ run }) => state.lock(run, () => state.listTabs(run)), true);
  tool('tab_close', 'Close one tab owned by this session. Never closes an unrelated tab.', TAB, ({ run, tab }) => state.lock(run, () => state.closeTab(run, tab)));
  tool('page_info', 'Read the current URL and title of a session tab.', TAB, ({ run, tab }) => state.withTab(run, tab, async page => ({ run, tab, url: page.url(), title: await page.title() })), true);
  tool('navigate', 'Navigate this tab to an HTTP(S) URL or about:blank; a relative address is resolved by the service\u2019s before-navigation hook, when one is set. Invalidates refs. Session URL tagging is applied.', { ...TAB, url: z.string() }, ({ run, tab, url }) => state.withTab(run, tab, async page => {
    const address = taggedUrl(await state.resolve(url, run), run, state.session(run).tagUrls);
    state.captures.delete(tab);
    await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await state.hook('afterNavigation', { page, url: page.url() });
    await state.tag(run, page);
    return { run, tab, url: page.url(), title: await page.title() };
  }));
  tool('capture', 'Read the accessibility UI as YAML with refs. Defaults to the whole page body; selector can scope it to one element (CSS or Playwright selector). Returns captureId required for ref actions. Replaces this tab’s previous capture.', { ...TAB, selector: z.string().min(1).default('body') }, ({ run, tab, selector }) => state.withTab(run, tab, page => state.snapshot(run, tab, page.locator(selector))), true);
  tool('capture_by_role', 'Read the accessibility UI of the one element with an ARIA role, as YAML with refs, optionally narrowed by its accessible name. name is a regular expression, not a string to equal: "Save" also matches "Save draft"; for an exact name anchor it, ^Save$, and escape regex characters, ^99\\+$. Hidden elements are not matched. Fails unless exactly one element matches, saying how many did. Returns captureId required for ref actions. Replaces this tab’s previous capture.', {
    ...TAB, role: z.string().min(1).describe('ARIA role, e.g. dialog, treegrid, tablist, button.'), name: z.string().min(1).optional().describe('Regular expression the accessible name must match, e.g. ^Akcje$.'),
  }, ({ run, tab, role, name }) => state.withTab(run, tab, page => {
    let pattern;
    if (name !== undefined) {
      try { pattern = new RegExp(name); } catch (error) { throw new Error(`name is not a valid regular expression: ${error.message}`); }
    }
    return state.snapshot(run, tab, page.getByRole(role, pattern ? { name: pattern } : {}));
  }), true);
  tool('capture_section', 'Read the accessibility UI of a section identified by an exact accessible heading. Uses the nearest section/article/region, or a surrounding block with no peer headings. Fails on an absent or ambiguous heading; selector optionally scopes the search.', {
    ...TAB, heading: z.string().min(1), level: z.number().int().min(1).max(6).optional(), selector: z.string().optional(),
  }, ({ run, tab, heading, level, selector }) => state.withTab(run, tab, async page => {
    const scope = selector ? page.locator(selector) : page;
    const target = scope.getByRole('heading', { name: heading, exact: true, ...(level ? { level } : {}) });
    if (await target.count() !== 1) throw new Error('Expected exactly one heading. Scope the capture or inspect the page first.');
    const marker = 'data-browser-mcp-' + randomBytes(8).toString('hex');
    await target.evaluate((h, marker) => {
      let element = h.closest('section, article, [role=region]');
      if (!element) {
        element = h;
        const level = Number(h.getAttribute('aria-level') ?? h.tagName.slice(1)) || 6;
        while (element.parentElement && !['BODY', 'MAIN'].includes(element.parentElement.tagName)) {
          const parent = element.parentElement;
          const peers = [...parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(other => other !== h && other.getClientRects().length && Number(other.getAttribute('aria-level') ?? other.tagName.slice(1)) <= level);
          if (peers.length) break;
          element = parent;
        }
      }
      element.setAttribute(marker, '');
    }, marker);
    try { return await state.snapshot(run, tab, page.locator(`[${marker}]`)); }
    finally { await page.locator(`[${marker}]`).evaluateAll((els, marker) => els.forEach(el => el.removeAttribute(marker)), marker).catch(() => {}); }
  }), true);
  const act = (action, input, work) => state.withTab(input.run, input.tab, async page => {
    const target = await state.ref(input.run, input.tab, input.captureId, input.ref);
    // An uncertain action must not be repeated using the same snapshot.
    state.captures.delete(input.tab);
    const result = await work(target, page);
    await state.hook('afterAction', { page, action, target });
    await state.tag(input.run, page);
    return { run: input.run, tab: input.tab, url: page.url(), ...result };
  });
  tool('click', 'Click an element from the latest capture. Invalidates the capture even if the click fails; inspect before retrying uncertain actions.', REF, input => act('click', input, async target => { await target.click({ timeout: 15000 }); return { clicked: input.ref }; }));
  tool('double_click', 'Double-click an element from the latest capture — e.g. a row, to open it. Invalidates the capture even if it fails; inspect before retrying.', REF, input => act('double_click', input, async target => { await target.dblclick({ timeout: 15000 }); return { doubleClicked: input.ref }; }));
  tool('fill', 'Replace an editable element’s contents with text. Empty text clears it. Requires a fresh capture and invalidates refs.', { ...REF, text: z.string().max(100000) }, input => act('fill', input, async target => { await target.fill(input.text, { timeout: 15000 }); return { filled: input.ref }; }));
  tool('type', 'Type text as keyboard events into the referenced editable element, appending at its cursor. Use fill to replace the contents.', { ...REF, text: z.string().max(10000) }, input => act('type', input, async target => { await target.pressSequentially(input.text, { timeout: 15000 }); return { typed: input.ref }; }));
  tool('pick_files', 'Choose files in a file input from the latest capture: the input itself, or the element that opens its file chooser when clicked, such as an upload button. Replaces any files chosen before. Paths are absolute, on the machine this service runs on. Invalidates the capture even if it fails. Returns the names chosen.', {
    ...REF, files: z.array(z.string().min(1)).min(1).max(20).describe('Absolute paths of the files, on this service\u2019s machine.'),
  }, input => {
    const missing = input.files.filter(file => !path.isAbsolute(file) || !existsSync(file));
    if (missing.length) throw new Error(`No file at ${missing.join(', ')}: give absolute paths on the machine the browser service runs on.`);
    return act('pick_files', input, async (target, page) => {
      if (await target.evaluate(el => el instanceof HTMLInputElement && el.type === 'file')) await target.setInputFiles(input.files, { timeout: 15000 });
      else {
        const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), target.click({ timeout: 15000 })]);
        await chooser.setFiles(input.files);
      }
      return { picked: input.files.map(file => path.basename(file)) };
    });
  });
  tool('press_key', 'Press a key or key chord on the referenced element, e.g. Enter, Escape, ControlOrMeta+A. May submit forms.', { ...REF, key: z.string().min(1).max(100) }, input => act('press_key', input, async target => { await target.press(input.key, { timeout: 15000 }); return { pressed: input.key }; }));
  tool('scroll', 'Scroll the document or a captured scroll container by pixels (negative means up). For a container, supply ref and captureId together. Returns the observed scroll position and atBottom; invalidates refs.', {
    ...TAB, amount: z.number().int().min(-5000).max(5000).default(800), ref: REF.ref.optional(), captureId: identifier.optional(),
  }, input => state.withTab(input.run, input.tab, async page => {
    if (!!input.ref !== !!input.captureId) throw new Error('Provide both ref and captureId for container scrolling.');
    const target = input.ref ? await state.ref(input.run, input.tab, input.captureId, input.ref) : page.locator('body');
    state.captures.delete(input.tab);
    const result = await target.evaluate((root, { amount, scoped }) => {
      const candidates = [root, ...root.querySelectorAll('*')];
      const el = candidates.find(e => e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 3 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? (scoped ? root : document.scrollingElement);
      el.scrollTop += amount;
      return { top: el.scrollTop, atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 3 };
    }, { amount: input.amount, scoped: !!input.ref });
    return { run: input.run, tab: input.tab, ...result };
  }));
  tool('wait_for_text', 'Wait for exact visible text to appear or disappear, optionally within a selector. Capture again afterward before acting.', { ...TAB, text: z.string().min(1), selector: z.string().optional(), gone: z.boolean().default(false), seconds: timeout }, input => state.withTab(input.run, input.tab, async page => {
    state.captures.delete(input.tab);
    const scope = input.selector ? page.locator(input.selector) : page;
    await scope.getByText(input.text, { exact: true }).first().waitFor({ state: input.gone ? 'hidden' : 'visible', timeout: input.seconds * 1000 });
    return { run: input.run, tab: input.tab, matched: true };
  }), true);
  tool('wait_for_navigation', 'Wait until the tab URL contains the supplied text, or no longer contains it when gone=true. Capture again afterward.', { ...TAB, urlIncludes: z.string().min(1), gone: z.boolean().default(false), seconds: timeout }, input => state.withTab(input.run, input.tab, async page => {
    state.captures.delete(input.tab);
    await page.waitForURL(url => url.href.includes(input.urlIncludes) !== input.gone, { timeout: input.seconds * 1000 });
    return { run: input.run, tab: input.tab, url: page.url() };
  }), true);
  return server;
}
