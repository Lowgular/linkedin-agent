#!/usr/bin/env node
// world/compose.mjs — author the world's loop from world.json, after the scrub: my profile, my posts, the
// people who reacted, their profiles. The recording stays the stage; this file sets who is on it. Run by
// the import (worlds/linkedin-po in marek) after the scrub; idempotent, so `node compose.mjs` alone
// re-composes what world/ holds.
//
// world.json names a few invented people (slug, name, headline, location, about) and, for every post of
// the world, which of them reacted. Then:
//
// - On every page a post is seen on — my profile's Activity cards, the Activity page's cards, the post's
//   own page — the reactions link under the post shows the spec's count. A click on it opens a composed
//   state: the page as it opens with the reactions dialog put in, its rows rebuilt for the spec's people,
//   one dialog per post per page, so two cards of one post lead to one state. Dismiss leads back to the
//   state the dialog opened from; every row leads to that person's profile page. A post with no reactors
//   has no reactions link at all: the link is removed, and nothing opens. The recorded dialogs those
//   links used to open are dropped; composed states and transitions are marked synth and remade on
//   every run, so the count can change but a removed link cannot come back without re-importing the page.
// - Every person gets a profile page composed from a recorded profile: the top card with their name,
//   headline and location, About with their text, every other section removed. Nothing else: no
//   experience, no activity, no education.
//
// Templates are harvested from world/ into templates/ the first time they are missing — the profile
// page world.json names, as scrubbed (templates/profile.json), and the open reactions dialog of the
// pages it names (templates/dialog-profile.json for profile pages, templates/dialog-feed.json for the
// feed's pages: the two are styled by different bundles) — and the template profile page is then
// removed from world/, since it is a template, not a page of the world. Commit templates/.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const worldDir = path.join(here, 'world');
const templatesDir = path.join(here, 'templates');
const spec = JSON.parse(readFileSync(path.join(here, 'world.json'), 'utf8'));
const HOST = 'www.linkedin.com';
const log = [];

// ---- the tree, as lib/snapshot.js writes it: { t, a: [[k, v]], c: [node | string], x } ----
const attrs = n => Object.fromEntries((n.a || []).map(([k, v]) => [k, v]));
const setAttr = (n, k, v) => { n.a = n.a || []; const i = n.a.findIndex(a => a[0] === k); if (i < 0) n.a.push([k, v]); else n.a[i][1] = v; };
const isEl = c => c && typeof c === 'object' && c.t && !c.t.startsWith('#');
const elements = n => (n.c || []).filter(isEl);
const text = n => (typeof n === 'string' ? n : (n.c || []).map(text).join(' '));
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const clone = n => JSON.parse(JSON.stringify(n));
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
// each(root, fn): fn(node, parent) on every element, depth first; return false from fn not to descend.
const each = (root, fn) => { const walk = (n, p) => { if (!isEl(n)) return; if (fn(n, p) === false) return; for (const c of n.c || []) walk(c, n); }; walk(root, null); };
const find = (root, pred) => { const out = []; each(root, (n, p) => { if (pred(n)) out.push({ node: n, parent: p }); }); return out; };
const first = (root, pred) => { const f = find(root, pred)[0]; return f ? f.node : null; };
// chain(root, target): the ancestors of target, root first.
const chain = (root, target) => { let out = null; const walk = (n, trail) => { if (out) return; if (n === target) { out = trail; return; } for (const c of elements(n)) walk(c, [...trail, n]); }; walk(root, []); return out; };
const remove = (root, node) => { const p = chain(root, node); if (!p || !p.length) return false; const parent = p[p.length - 1]; parent.c = parent.c.filter(c => c !== node); return true; };
// replaceText(root, from, to): in every text node and attribute value under root.
const replaceText = (root, from, to) => { if (!from || from === to) return; each(root, n => { if (n.c) n.c = n.c.map(c => (typeof c === 'string' ? c.split(from).join(to) : c)); if (n.a) for (const a of n.a) a[1] = String(a[1]).split(from).join(to); }); };
// setText(node, s): the element's content is the one text node s.
const setText = (node, s) => { node.c = [s]; };
const elements_ = elements;
const xpathOf = (html, target) => {
  const parts = [];
  const walk = (n, trail) => { if (n === target) { parts.push(...trail); return true; } for (const c of elements_(n)) { const i = elements_(n).filter(x => x.t === c.t).indexOf(c) + 1; if (walk(c, [...trail, c.t + '[' + i + ']'])) return true; } return false; };
  return walk(html, []) ? '/html/' + parts.join('/') : null;
};
const bodyRoot = html => { const body = elements(html).find(n => n.t === 'body'); return body && elements(body)[0]; };
const openDialog = html => first(html, n => n.t === 'dialog' && attrs(n).open !== undefined);
const URN = /urn:li:activity:(\d+)/g;
const urnsIn = n => [...new Set([...JSON.stringify(n).matchAll(URN)].map(m => m[1]))];
// A reactions link: <a> whose first element holds the count and the word.
const REACTIONS = /^\s*\d[\d,]*\s+reactions?\s*$/;
const isReactionsLink = n => n.t === 'a' && elements(n).length && REACTIONS.test(norm(text(elements(n)[0])));
const plural = n => `${n} ${n === 1 ? 'reaction' : 'reactions'}`;

// ---- the world on disk ----
const pageDir = page => path.join(worldDir, page);
const readStates = page => JSON.parse(readFileSync(path.join(pageDir(page), 'states.json'), 'utf8'));
const writeStates = (page, data) => writeFileSync(path.join(pageDir(page), 'states.json'), JSON.stringify(data, null, 2) + '\n');
const readState = (page, id) => JSON.parse(readFileSync(path.join(pageDir(page), id + '.json'), 'utf8'));
const dropState = (page, data, id) => { delete data.states[id]; const f = path.join(pageDir(page), id + '.json'); if (existsSync(f)) unlinkSync(f); };
const pages = () => {
  const out = [];
  const walk = dir => { if (!existsSync(dir)) return; const entries = readdirSync(dir).sort(); if (entries.includes('states.json')) out.push(path.relative(worldDir, dir).split(path.sep).join('/')); for (const e of entries) { const p = path.join(dir, e); if (statSync(p).isDirectory()) walk(p); } };
  walk(path.join(worldDir, HOST));
  return out;
};
// A page's own kind: a profile (/in/<slug>) is styled by one bundle, the feed's pages by another.
const kindOf = page => (/^www\.linkedin\.com\/in\/[^/]+$/.test(page) ? 'profile' : 'feed');

// ---- templates ----
function harvest() {
  mkdirSync(templatesDir, { recursive: true });
  const t = spec.templates;
  const profileFile = path.join(templatesDir, 'profile.json');
  if (!existsSync(profileFile)) {
    if (!existsSync(path.join(pageDir(t.profile), 'states.json'))) throw new Error(`No template profile: import ${t.profile} first (templates/profile.json is missing)`);
    const data = readStates(t.profile);
    writeFileSync(profileFile, readFileSync(path.join(pageDir(t.profile), data.initial + '.json')));
    log.push(`templates/profile.json harvested from ${t.profile}`);
  }
  for (const [kind, page] of Object.entries(t.dialogs)) {
    const file = path.join(templatesDir, `dialog-${kind}.json`);
    if (existsSync(file)) continue;
    if (!existsSync(path.join(pageDir(page), 'states.json'))) throw new Error(`No page to take the ${kind} dialog from: import ${page} first (templates/dialog-${kind}.json is missing)`);
    const data = readStates(page);
    let dialog = null;
    for (const id of Object.keys(data.states)) { dialog = openDialog(readState(page, id).html); if (dialog) break; }
    if (!dialog) throw new Error(`${page} holds no state with an open dialog to take as the ${kind} dialog`);
    writeFileSync(file, JSON.stringify(dialog));
    log.push(`templates/dialog-${kind}.json harvested from ${page}`);
  }
  if (existsSync(pageDir(t.profile))) { rmSync(pageDir(t.profile), { recursive: true, force: true }); log.push(`${t.profile} removed from world/: it is the template`); }
}
const templates = { dialog: {} };
const loadTemplates = () => {
  templates.profile = JSON.parse(readFileSync(path.join(templatesDir, 'profile.json'), 'utf8'));
  for (const kind of ['profile', 'feed']) templates.dialog[kind] = JSON.parse(readFileSync(path.join(templatesDir, `dialog-${kind}.json`), 'utf8'));
};

// ---- the dialog, rebuilt for the spec's people ----
function dialogFor(kind, slugs) {
  const d = clone(templates.dialog[kind]);
  const n = slugs.length;
  // One tab, All, with the count.
  const ul = first(first(d, x => x.t === 'nav') || d, x => x.t === 'ul');
  if (ul) {
    const all = elements(ul)[0];
    ul.c = [all];
    const button = first(all, x => x.t === 'button');
    if (button) setAttr(button, 'aria-label', `${n} All reactions`);
    each(all, x => { if (x.c) x.c = x.c.map(c => (typeof c === 'string' && /^\s*All\s+\d[\d,]*\s*$/.test(c) ? `All ${n}` : c)); });
  }
  // The rows: the container's children are row units, each holding one link to a person.
  const links = find(d, x => x.t === 'a' && /linkedin\.com\/in\//.test(attrs(x).href || ''));
  if (!links.length) throw new Error(`The ${kind} dialog template holds no row linking to a person`);
  const unitOf = link => { const anc = chain(d, link.node); for (let i = anc.length - 1; i > 0; i--) if (find(anc[i - 1], x => x.t === 'a' && /linkedin\.com\/in\//.test(attrs(x).href || '')).length > 1) return { unit: anc[i], container: anc[i - 1] }; return null; };
  // The row to copy: someone else's (my own row reads "You", not a name), who reacted with a Like.
  const units = links.map(unitOf).filter(Boolean);
  const others = units.filter(u => !find(u.unit, x => x.t === 'a' && (attrs(x).href || '').includes(`/in/${spec.me}/`)).length);
  const liked = others.find(u => JSON.stringify(u.unit).includes('like-consumption')) || others[0] || units[0];
  liked.container.c = slugs.map((slug, i) => rowFor(liked.unit, slug, i));
  // Nothing scrolled: the dialog opens at its top.
  each(d, x => { if (x.x && x.x.scroll) delete x.x.scroll; if (x.x && !Object.keys(x.x).length) delete x.x; });
  return d;
}
function rowFor(unit, slug, i) {
  const person = spec.people[slug];
  if (!person) throw new Error(`world.json names no person ${slug}`);
  const r = clone(unit);
  const labelled = first(r, x => / reacted with /.test(attrs(x)['aria-label'] || ''));
  if (!labelled) throw new Error('The dialog row template has no "reacted with" label');
  // The name is the first text of the first paragraph (the degree, "• 1st", follows it in its own span), the
  // headline the first text of the second.
  const ps = find(labelled, x => x.t === 'p').map(f => f.node);
  const firstText = n => { let t = null; each(n, x => { if (t !== null) return false; for (const c of x.c || []) if (typeof c === 'string' && norm(c)) { t = c; break; } }); return t; };
  const oldName = ps[0] && firstText(ps[0]), oldHeadline = ps[1] && firstText(ps[1]);
  if (!oldName) throw new Error('The dialog row template has no name');
  each(r, x => { if (x.c) x.c = x.c.map(c => (typeof c !== 'string' ? c : c === oldName ? person.name : oldHeadline && c === oldHeadline ? person.headline : c)); });
  setAttr(labelled, 'aria-label', `${person.name} reacted with Like, 1st degree connection, ${person.headline}`);
  for (const { node } of find(r, x => x.t === 'a' && attrs(x).href)) setAttr(node, 'href', `https://${HOST}/in/${slug}/`);
  for (const { node } of find(r, x => attrs(x)['data-lazy-mount-id'] !== undefined)) setAttr(node, 'data-lazy-mount-id', 'r' + hash(slug + i).slice(0, 6));
  return r;
}

// ---- every page a post is seen on ----
function composeSurface(page) {
  const data = readStates(page);
  if (!data.initial || !existsSync(path.join(pageDir(page), data.initial + '.json'))) return null;
  const base = readState(page, data.initial);
  const links = find(base.html, isReactionsLink);
  const hasFacepile = !!first(base.html, x => (attrs(x)['data-testid'] || '').startsWith('ReactionFacepileCollection-'));
  if (!links.length && !hasFacepile) return null;
  // Out with what the recording and earlier runs put here: the dialogs the reactions links opened.
  const stale = new Set();
  for (const t of data.transitions) if (t.from === data.initial && typeof t.to === 'string' && t.click && t.click.tag === 'a' && REACTIONS.test(t.click.name || '')) stale.add(t.to);
  for (const [id, meta] of Object.entries(data.states)) if (meta.synth) stale.add(id);
  for (const id of stale) if (id !== data.initial) dropState(page, data, id);
  data.transitions = data.transitions.filter(t => !t.synth && !stale.has(t.from) && !(typeof t.to === 'string' && stale.has(t.to)));
  // Each link: the post it belongs to, by the nearest ancestor that names exactly one post.
  const kind = kindOf(page);
  const byPost = new Map();
  let removed = 0, untouched = 0;
  for (const { node } of links) {
    const anc = chain(base.html, node);
    let urn = null;
    for (let i = anc.length - 1; i >= 0 && !urn; i--) { const u = urnsIn(anc[i]); if (u.length === 1) urn = u[0]; else if (u.length > 1) break; }
    const post = urn && spec.posts[urn];
    if (!post) { untouched++; log.push(`${page}: a reactions link of ${urn ? 'post ' + urn : 'no post'} is not in world.json, left as recorded`); continue; }
    setCount(base.html, node, post.reactors.length);
    if (!post.reactors.length) { remove(base.html, node); removed++; continue; }
    if (!byPost.has(urn)) byPost.set(urn, []);
    byPost.get(urn).push(node);
  }
  // A post's own page also shows a facepile above the comments: one avatar per reactor, each a link to
  // the person, then "View all reactions" when there are many. Rebuilt for the spec's people; empty, as
  // recorded, when nobody reacted.
  const facepiles = new Map();
  for (const { node } of find(base.html, x => (attrs(x)['data-testid'] || '').startsWith('ReactionFacepileCollection-'))) {
    // The collection is named by the post's urn, which for a group post is the group post's, not the
    // activity's; the post is the activity named around it.
    const anc = chain(base.html, node);
    const outer = [...anc].reverse().find(x => x.t === 'a') || null;
    let urn = null;
    for (let i = anc.length - 1; i >= 0 && !urn; i--) { const u = urnsIn(anc[i]); if (u.length === 1) urn = u[0]; else if (u.length > 1) break; }
    const post = urn && spec.posts[urn];
    if (!post) { log.push(`${page}: a facepile of ${urn ? 'post ' + urn : 'no post'} is not in world.json, left as recorded`); continue; }
    if (process.env.COMPOSE_DEBUG) log.push(`${page}: facepile of ${urn}, ${post.reactors.length} reactor(s), outer ${outer ? 'found' : 'missing'}`);
    if (!post.reactors.length) { node.c = []; continue; }   // as recorded for a post nobody reacted to: the collection, empty
    const avatars = elements(node).filter(a => a.t === 'a' && / reacted with /.test(JSON.stringify(a)));
    const more = elements(node).filter(a => !avatars.includes(a));
    if (!avatars.length) continue;
    node.c = [...post.reactors.map(slug => { const a = clone(avatars[0]); const person = spec.people[slug]; setAttr(a, 'href', `https://${HOST}/in/${slug}/`); const l = first(a, x => / reacted with /.test(attrs(x)['aria-label'] || '')); if (l) setAttr(l, 'aria-label', `${person.name} reacted with Like`); return a; }), ...more];
    facepiles.set(urn, { outer, more: more.filter(a => a.t === 'a') });
    // An avatar is a link inside the facepile's own link; nested so, the browser does not follow it on
    // its own, so each is a transition to the person's page, as a dialog row is.
    for (const a of elements(node).filter(a => a.t === 'a' && / reacted with /.test(JSON.stringify(a)))) {
      const slug = (attrs(a).href.match(/\/in\/([^/]+)\//) || [])[1];
      const xpath = xpathOf(base.html, a);
      data.transitions = data.transitions.filter(t => !(t.from === data.initial && t.click && t.click.xpath === xpath));
      data.transitions.push({ from: data.initial, click: { tag: 'a', role: 'link', name: attrs(first(a, x => attrs(x)['aria-label']) || a)['aria-label'] || '', xpath, href: attrs(a).href }, to: { page: `${HOST}/in/${slug}` }, synth: true });
    }
  }
  // The post's age and impressions, wherever the page shows them, so pages recorded days apart agree:
  // the age in the timestamp link to the post ("6d", "1w • Edited"), the impressions in the analytics
  // link ("1,406 impressions"), each named to its post by the address around it.
  const AGE = /^(\s*)\d+[a-z]+(\s*•\s*Edited)?(\s*)$/;
  for (const { node } of find(base.html, x => x.t === 'a' && /feed\/update\/urn:li:activity:\d+/.test(attrs(x).href || ''))) {
    const urn = attrs(node).href.match(/urn:li:activity:(\d+)/)[1], post = spec.posts[urn];
    if (!post || !post.age) continue;
    each(node, x => { if (x.c) x.c = x.c.map(c => (typeof c === 'string' && AGE.test(c) ? c.replace(/\d+[a-z]+/, post.age) : c)); });
  }
  for (const { node } of find(base.html, x => x.c && x.c.some(c => typeof c === 'string' && /^\s*[\d,]+ impressions\s*$/.test(c)))) {
    const anc = chain(base.html, node);
    let urn = null;
    for (let i = anc.length - 1; i >= 0 && !urn; i--) { const u = urnsIn(anc[i]); if (u.length === 1) urn = u[0]; else if (u.length > 1) break; }
    const post = urn && spec.posts[urn];
    if (!post || !post.impressions) continue;
    node.c = node.c.map(c => (typeof c === 'string' && /^\s*[\d,]+ impressions\s*$/.test(c) ? c.replace(/[\d,]+/, post.impressions) : c));
  }
  const dismissName = 'Dismiss';
  let composed = 0;
  for (const [urn, nodes] of byPost) {
    const slugs = spec.posts[urn].reactors;
    const state = clone(base);
    delete state.scroll;
    const root = bodyRoot(state.html);
    const dialog = dialogFor(kind, slugs);
    root.c = [dialog, ...(root.c || [])];
    const json = JSON.stringify(state), id = hash(json);
    writeFileSync(path.join(pageDir(page), id + '.json'), json);
    data.states[id] = { title: state.title, via: { tag: 'a', role: 'link', name: plural(slugs.length) }, post: urn, synth: true };
    for (const node of nodes) {
      const xpath = xpathOf(base.html, node);
      data.transitions = data.transitions.filter(t => !(t.from === data.initial && t.click && t.click.xpath === xpath));
      data.transitions.push({ from: data.initial, click: { tag: 'a', role: 'link', name: plural(slugs.length), xpath, href: attrs(node).href || null }, to: id, synth: true });
    }
    for (const node of [facepiles.get(urn)?.outer, ...(facepiles.get(urn)?.more || [])].filter(Boolean)) {
      const xpath = xpathOf(base.html, node);
      data.transitions = data.transitions.filter(t => !(t.from === data.initial && t.click && t.click.xpath === xpath));
      data.transitions.push({ from: data.initial, click: { tag: 'a', role: 'link', name: norm(text(node)) || (first(node, x => attrs(x)['aria-label']) ? attrs(first(node, x => attrs(x)['aria-label']))['aria-label'] : ''), xpath, href: attrs(node).href || null }, to: id, synth: true });
    }
    const dismiss = first(dialog, x => x.t === 'button' && attrs(x)['aria-label'] === dismissName);
    if (dismiss) data.transitions.push({ from: id, click: { tag: 'button', role: 'button', name: dismissName, xpath: xpathOf(state.html, dismiss), href: null }, to: data.initial, synth: true });
    for (const { node } of find(dialog, x => x.t === 'a' && /linkedin\.com\/in\//.test(attrs(x).href || ''))) {
      const slug = attrs(node).href.match(/\/in\/([^/]+)\//)[1];
      data.transitions.push({ from: id, click: { tag: 'a', role: 'link', name: norm(text(node)).slice(0, 160), xpath: xpathOf(state.html, node), href: attrs(node).href }, to: { page: `${HOST}/in/${slug}` }, synth: true });
    }
    composed++;
  }
  // The base state, with its counts set and its links removed, under its own name still: the page's
  // transitions name it, and a recording is replaced page by page, never by state.
  writeFileSync(path.join(pageDir(page), data.initial + '.json'), JSON.stringify(base));
  writeStates(page, data);
  return { composed, removed, untouched };
}
// The count under a post shows twice: in the reactions link's label ("7", " reactions": the space is the
// second node's) and inside the card's Like button beside it. Both follow the spec; at zero the label's
// link goes (the caller removes it) and the button's count is blank, as a post nobody reacted to is recorded.
function setCount(html, link, n) {
  const label = elements(link)[0];
  label.c = label.c.map(c => (typeof c !== 'string' ? c : c.replace(/\d[\d,]*/, String(n)).replace(/reactions?/, n === 1 ? 'reaction' : 'reactions')));
  // One reaction kind: every reaction here is a Like.
  const ul = first(link, x => x.t === 'ul');
  if (ul) { const lis = elements(ul); const like = lis.find(li => JSON.stringify(li).includes('like-consumption')) || lis[0]; if (like) ul.c = [like]; }
  const anc = chain(html, link);
  for (let i = anc.length - 1; i >= Math.max(0, anc.length - 3); i--) {
    const button = first(anc[i], x => x.t === 'button' && (attrs(x)['aria-label'] || '').startsWith('Reaction button state'));
    if (!button) continue;
    each(button, x => { if (x.c) x.c = x.c.map(c => (typeof c === 'string' && /^\s*\d[\d,]*\s*$/.test(c) ? (n ? String(n) : '') : c)); });
    return;
  }
  log.push(`a reactions link has no Like button beside it: its count shows once`);
}

// ---- a person's profile page, from the template ----
function composeProfile(slug, person) {
  const page = `${HOST}/in/${slug}`;
  const state = clone(templates.profile);
  const templateName = state.title.replace(/\s*\|\s*LinkedIn\s*$/, '');
  const templateSlug = spec.templates.profile.split('/').pop();
  const main = first(state.html, x => x.t === 'main');
  if (!main) throw new Error('The template profile has no main');
  // Sections: the top card and About stay, every other section with a heading of its own goes; a section
  // whose first heading belongs to a nested section is only a wrapper, walked into.
  const ownHeading = s => { let h = null; each(s, (n, p) => { if (h) return false; if (n !== s && n.t === 'section') return false; if (n.t === 'h2') { h = norm(text(n)); return false; } }); return h; };
  const keep = new Set([templateName, 'About']);
  const prune = node => {
    for (const c of elements(node)) {
      if (c.t === 'aside') { remove(state.html, c); continue; }
      if (c.t === 'section') {
        const h = ownHeading(c);
        if (h === null) { if (find(c, x => x.t === 'h2').length) prune(c); else remove(state.html, c); continue; }   // a wrapper is walked into; a widget with no heading at all goes
        if (keep.has(h)) continue;
        remove(state.html, c); continue;
      }
      prune(c);
    }
  };
  prune(main);
  // The top card: name, headline, location; no company, no mutual connections, no Sales Navigator.
  const nameH2 = first(main, x => x.t === 'h2' && norm(text(x)) === templateName);
  const top = chain(main, nameH2).filter(x => x.t === 'section').pop();
  const after = []; let seen = false; each(top, x => { if (x === nameH2) seen = true; else if (seen && x.t === 'p') after.push(x); });
  const [headlineP, companyP, locationP] = after.filter(p => !/^·/.test(norm(text(p))) && norm(text(p)));
  if (!headlineP || !companyP || !locationP) throw new Error('The template top card does not read as headline, company, location');
  const companyName = norm(text(companyP)), templateHeadline = norm(text(headlineP)), templateLocation = norm(text(locationP));
  setText(headlineP, person.headline);
  remove(state.html, companyP);
  setText(locationP, person.location);
  // The Sales Insights widget ("Key signals", "posted in the past 30 days"): the smallest block holding it all.
  const insights = first(main, x => x.t === 'p' && norm(text(x)) === 'Sales Insights');
  if (insights) { const anc = chain(main, insights); for (let i = anc.length - 1; i >= 0; i--) { const t = norm(text(anc[i])); if (/past 30 days|Key signals/.test(t)) { if (/\bAbout\b/.test(t)) throw new Error('The Sales Insights block cannot be told from About'); remove(state.html, anc[i]); break; } } }
  for (const { node } of find(top, x => attrs(x).role === 'button' && norm(text(x)) === companyName)) remove(state.html, node);
  for (const { node } of find(top, x => x.t === 'a' && /mutual connections/.test(norm(text(x))))) remove(state.html, node);
  for (const { node } of find(top, x => x.t === 'a' && /^https:\/\/www\.linkedin\.com\/sales\//.test(attrs(x).href || ''))) remove(state.html, node);
  for (const { node } of find(top, x => x.t === 'p' && /^\d[\d,+]*\s+connections$/.test(norm(text(x))))) setText(node, `${person.connections || '500+'} connections`);
  // About.
  const about = first(main, x => x.t === 'section' && ownHeading(x) === 'About');
  const aboutText = about && first(about, x => attrs(x)['data-testid'] === 'expandable-text-box');
  if (!aboutText) throw new Error('The template profile has no About text');
  setText(aboutText, person.about);
  // The name and the address, everywhere: title, head, the top card, the bell, the links.
  // The name, headline and address everywhere: the title, the head, the compact header that appears on
  // scroll, the bell, the links.
  replaceText(state.html, templateName, person.name);
  replaceText(state.html, templateHeadline, person.headline);
  replaceText(state.html, templateLocation, person.location);
  replaceText(state.html, templateSlug, slug);
  state.title = `${person.name} | LinkedIn`;
  state.url = `https://${HOST}/in/${slug}/`;
  delete state.scroll;
  // Write: this page is composed whole, nothing recorded lives here.
  mkdirSync(pageDir(page), { recursive: true });
  for (const f of readdirSync(pageDir(page))) if (f.endsWith('.json')) unlinkSync(path.join(pageDir(page), f));
  const json = JSON.stringify(state), id = hash(json);
  writeFileSync(path.join(pageDir(page), id + '.json'), json);
  writeStates(page, { page, initial: id, states: { [id]: { title: state.title, synth: true } }, transitions: [] });
  return id;
}

// ---- run ----
harvest();
loadTemplates();
const peopleFile = path.join(here, 'people.json');
if (existsSync(peopleFile)) {
  const taken = Object.values(JSON.parse(readFileSync(peopleFile, 'utf8'))).filter(p => p.fake);
  for (const [slug, p] of Object.entries(spec.people)) { const clash = taken.find(t => t.fake.slug === slug || t.fake.name === p.name); if (clash) throw new Error(`${p.name} (${slug}) is already a scrubbed person in people.json: pick another name`); }
}
let surfaces = 0, dialogs = 0, removedLinks = 0;
for (const page of pages()) {
  if (spec.people[page.split('/').pop()] && kindOf(page) === 'profile') continue;   // composed below
  const r = composeSurface(page);
  if (!r) continue;
  surfaces++; dialogs += r.composed; removedLinks += r.removed;
}
for (const [slug, person] of Object.entries(spec.people)) composeProfile(slug, person);
for (const l of log) console.log('  ' + l);
console.log(`▸ composed: ${dialogs} dialog state(s) on ${surfaces} page(s), ${removedLinks} reactions link(s) removed, ${Object.keys(spec.people).length} profile page(s)`);
