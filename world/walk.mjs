#!/usr/bin/env node
// world/walk.mjs — walk the loop world.json describes against a served world and say what
// holds: on every page a post is seen on (my profile, my Activity page, each post's page), every reactions
// link shows the spec's count and opens a dialog listing the spec's people, no post without reactors has
// a link, Dismiss leads back to the page, and every row leads to that person's profile, which shows their
// name, headline and About and no Experience, Education or Activity. Exit 1 when anything does not hold.
//
//   node walk.mjs                          against the fake served plain on http://localhost:4173, in a Chrome of its own
//   node walk.mjs --resolve 4443           against the fake under LinkedIn's names: https://www.linkedin.com
//                                          resolved to 127.0.0.1:4443, certificate errors ignored
//   node walk.mjs --cdp http://localhost:9222 --base https://linkedin-stub.web.app
//                                          in a browser already running: the dev-browser container, its CDP mapped
//                                          to localhost:9224 by compose
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const resolvePort = opt('--resolve', null);
const cdp = opt('--cdp', null);
const base = (opt('--base', resolvePort ? 'https://www.linkedin.com' : 'http://localhost:4173')).replace(/\/$/, '');
const specFile = opt('--world', ['world.json', path.join(here, 'world.json')].find(existsSync));
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const pw = ['../mcp/browser-mcp/node_modules/playwright-core/index.mjs'].map(p => path.resolve(here, p)).find(existsSync);
if (!pw) { console.error('No playwright-core: npm install in mcp/browser-mcp/'); process.exit(2); }
const { chromium } = await import(pw);

const failures = [];
const ok = (cond, what) => { console.log(`${cond ? '  ✓' : '  ✗'} ${what}`); if (!cond) failures.push(what); };
const names = slugs => slugs.map(s => spec.people[s].name);
const plural = n => `${n} ${n === 1 ? 'reaction' : 'reactions'}`;
const REACTIONS = /^\d+ reactions?$/;

let browser, context;
if (cdp) { browser = await chromium.connectOverCDP(cdp); context = browser.contexts()[0] || await browser.newContext(); }
else {
  const launchArgs = ['--blink-settings=imagesEnabled=false'];
  if (resolvePort) launchArgs.push(`--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${resolvePort}, MAP linkedin.com 127.0.0.1:${resolvePort}, MAP static.licdn.com 127.0.0.1:${resolvePort}, MAP media.licdn.com 127.0.0.1:${resolvePort}`, '--ignore-certificate-errors');
  try { browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }); }
  catch { browser = await chromium.launch({ headless: true, args: launchArgs }); }
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
}
const page = await context.newPage();
page.setDefaultTimeout(8000);
const goto = async url => { const r = await page.goto(url, { waitUntil: 'domcontentloaded' }); return r ? r.status() : null; };
// The reactions link has no accessible name: its label ("4 reactions") is a hidden div, its visible part the
// reaction icons; the count also shows as the Like button's text beside it. Found by that hidden label.
const reactionLinks = () => page.locator('a').filter({ has: page.getByText(REACTIONS) });
const linkText = link => link.locator('> div').first().textContent();
const postOf = link => link.evaluate(el => { for (let n = el; n; n = n.parentElement) { const m = new Set((n.innerHTML.match(/urn:li:activity:(\d+)/g) || []).map(s => s.slice('urn:li:activity:'.length))); if (m.size === 1) return [...m][0]; if (m.size > 1) return null; } return null; });
const dialogPeople = async () => {
  const dialog = page.locator('dialog[open]');
  const labels = await dialog.locator('[aria-label*=" reacted with "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  const tab = await dialog.getByRole('button', { name: /All reactions$/ }).getAttribute('aria-label').catch(() => null);
  const links = await dialog.locator('a[href*="/in/"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
  return { names: labels.map(l => l.split(' reacted with ')[0]), tab, links };
};
const checkProfile = async slug => {
  const person = spec.people[slug];
  ok(new RegExp(`/in/${slug}/?(\\?|$)`).test(page.url()), `lands on /in/${slug}/ (${page.url().replace(base, '')})`);
  const h = page.getByRole('heading', { name: person.name, exact: true });
  ok(await h.count() > 0, `${person.name}: name heading`);
  ok(await page.getByText(person.headline, { exact: true }).count() > 0, `${person.name}: headline "${person.headline.slice(0, 40)}…"`);
  ok(await page.getByText(person.about.slice(0, 60)).count() > 0, `${person.name}: About text`);
  ok(await page.getByRole('heading', { name: 'About' }).count() > 0, `${person.name}: About heading`);
  for (const gone of ['Experience', 'Education', 'Activity', 'Featured', 'Skills']) ok(await page.getByRole('heading', { name: new RegExp(`^${gone}`) }).count() === 0, `${person.name}: no ${gone} section`);
};

const surfaces = [
  { url: `${base}/in/${spec.me}/`, label: 'my profile' },
  { url: `${base}/in/${spec.me}/recent-activity/all/`, label: 'my Activity page' },
  ...Object.keys(spec.posts).map(urn => ({ url: `${base}/feed/update/urn:li:activity:${urn}/`, label: `post ${urn}`, urn })),
];
const reached = new Set();
for (const s of surfaces) {
  console.log(`\n${s.label}  ${s.url.replace(base, '')}`);
  const status = await goto(s.url);
  ok(status === 200, `opens (${status})`);
  if (status !== 200) continue;
  const n = await reactionLinks().count();
  if (s.urn) {
    const expected = spec.posts[s.urn].reactors;
    ok(n === (expected.length ? 1 : 0), expected.length ? `one reactions link` : `no reactions link: ${expected.length} reactors`);
    // The facepile above the comments: one avatar per reactor, "View all reactions" opening the dialog.
    const pile = page.locator('main [data-testid^="ReactionFacepileCollection-"]');
    if (!expected.length) ok(await pile.locator('a').count() === 0, 'facepile empty');
    else {
      const labels = await pile.locator('[aria-label*=" reacted with "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label').split(' reacted with ')[0]));
      ok(JSON.stringify(labels) === JSON.stringify(names(expected)), `facepile shows ${labels.join(', ')}`);
      const all = pile.locator('a', { has: page.locator('[aria-label="View all reactions"]') });
      if (await all.count()) {
        await Promise.all([page.waitForURL(/state=/), all.click()]);
        const d = await dialogPeople();
        ok(JSON.stringify(d.names) === JSON.stringify(names(expected)), `View all reactions opens the dialog`);
        await goto(s.url);
      }
      await Promise.all([page.waitForURL(/\/in\//), pile.locator('a[href*="/in/"]').first().click()]);
      await checkProfile(expected[0]);
      await goto(s.url);
    }
  } else ok(n > 0, `${n} reactions links`);
  for (let i = 0; i < n; i++) {
    if (i) await goto(s.url);
    const link = reactionLinks().nth(i);
    const urn = await postOf(link);
    const post = urn && spec.posts[urn];
    const shown = (await linkText(link)).trim().replace(/\s+/g, ' ');
    if (!post) { ok(false, `link ${i} "${shown}": post ${urn} not in world.json`); continue; }
    ok(shown === plural(post.reactors.length), `post ${urn}: link reads "${shown}", spec ${post.reactors.length}`);
    await Promise.all([page.waitForURL(/state=/), link.click()]);
    const d = await dialogPeople();
    ok(JSON.stringify(d.names) === JSON.stringify(names(post.reactors)), `post ${urn}: dialog lists ${d.names.join(', ') || 'nobody'}`);
    ok(d.tab === `${post.reactors.length} All reactions`, `post ${urn}: tab "${d.tab}"`);
    ok(JSON.stringify(d.links.map(h => h.match(/\/in\/([^/]+)\//)[1])) === JSON.stringify(post.reactors), `post ${urn}: rows link to ${post.reactors.join(', ')}`);
    // Dismiss: back to the page, no dialog.
    await Promise.all([page.waitForURL(u => !u.toString().includes('state=')), page.locator('dialog[open]').getByRole('button', { name: 'Dismiss' }).click()]);
    ok(await page.locator('dialog[open]').count() === 0, `post ${urn}: Dismiss closes the dialog, back at ${page.url().replace(base, '')}`);
    // Every row: the person's profile.
    for (let j = 0; j < post.reactors.length; j++) {
      await goto(s.url);
      await Promise.all([page.waitForURL(/state=/), reactionLinks().nth(i).click()]);
      const row = page.locator('dialog[open]').locator('a[href*="/in/"]').nth(j);
      await Promise.all([page.waitForURL(/\/in\//), row.click()]);
      await checkProfile(post.reactors[j]);
      reached.add(post.reactors[j]);
    }
  }
  if (s.label === 'my profile') {
    // The ways onto a post from the profile: the Featured card, a card's timestamp, Show all posts.
    await goto(s.url);
    const featured = page.getByRole('heading', { name: 'Featured' });
    const featuredLink = page.locator('section', { has: featured }).locator('a[href*="/feed/update/"]').first();
    if (await featuredLink.count()) { await Promise.all([page.waitForURL(/\/feed\/update\//), featuredLink.click()]); ok(/\/feed\/update\//.test(page.url()), `Featured card opens its post (${page.url().replace(base, '').slice(0, 60)})`); }
    else ok(false, 'a Featured card linking to a post');
    await goto(s.url);
    await Promise.all([page.waitForURL(/recent-activity/), page.getByRole('link', { name: 'Show all posts' }).click()]);
    ok(/recent-activity\/all/.test(page.url()), 'Show all posts opens the Activity page');
  }
}
console.log('');
for (const slug of Object.keys(spec.people)) ok(reached.has(slug), `${spec.people[slug].name} reached from a dialog`);
await browser.close();
console.log(failures.length ? `\n▸ ${failures.length} check(s) failed` : '\n▸ the loop holds');
process.exit(failures.length ? 1 : 0);
