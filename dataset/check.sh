#!/usr/bin/env bash
# dataset/check.sh — the dataset's consistency check, before a build. Offline, for every task,
# the comparison is probed with the facts themselves (score 1), the facts without links (1: a thing is
# identified by its name or its link), nothing found (0), every value altered (below 1), a list with one
# member more (below 1) and the facts loosely phrased — "6 days ago", "April 2026", "1,406", a shortened
# opening (1). Then, with the extractor's login (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, or this
# machine's Claude Code login), the facts given as a message must extract to score 1 and a message that
# found nothing to 0; --offline skips that. The question is the task's instruction.md, as the agent gets
# it. One task: ./check.sh post-reactors-none
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
offline=0; only=""
for arg in "$@"; do case "$arg" in --offline) offline=1;; *) only="$arg";; esac; done
node --input-type=module - "$here" "$only" "$offline" <<'JS'
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const [here, only, offline] = process.argv.slice(2);
const { score, correctness } = await import(path.join(here, 'shared/tests/correctness.mjs'));
const clone = v => JSON.parse(JSON.stringify(v));
const strip = (v, key) => JSON.parse(JSON.stringify(v, (k, x) => k === key ? undefined : x));
const nulled = v => Array.isArray(v) ? null : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nulled(x)])) : null;
const altered = v => Array.isArray(v) ? v.slice(0, -1) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, altered(x)])) : typeof v === 'number' ? v + 1 : typeof v === 'string' ? v + ' x' : v;
const widened = v => { const c = clone(v); let done = false; const walk = x => { if (done || !x || typeof x !== 'object') return; if (Array.isArray(x)) { x.push(x.length && typeof x[0] === 'object' ? { name: 'Someone Else', link: 'https://www.linkedin.com/in/someone-else/' } : 'something else'); done = true; return; } Object.values(x).forEach(walk); }; walk(c); return done ? c : null; };
const loose = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'number' ? x.toLocaleString('en-US') : k === 'posted' ? x.replace(/^(\d+)d$/, '$1 days ago').replace(/^(\d+)w$/, '$1 weeks ago') : k === 'from' ? x.replace(/^Apr /, 'April ') : k === 'to' && x === 'Present' ? 'now' : k === 'link' ? x.replace('https://www.', 'www.').replace(/\/$/, '') : k === 'text' ? x.slice(0, 40) : x));
const show = r => r.score.toFixed(2);
let failed = 0;
for (const task of readdirSync(path.join(here, 'tasks')).sort()) {
  if (only && task !== only) continue;
  const dir = path.join(here, 'tasks', task);
  if (!existsSync(path.join(dir, 'instruction.md'))) continue;
  if (!existsSync(path.join(dir, 'tests/expected.json'))) { console.log(`${task.padEnd(26)} no facts yet`); continue; }
  const expected = JSON.parse(readFileSync(path.join(dir, 'tests/expected.json'), 'utf8'));
  const question = readFileSync(path.join(dir, 'instruction.md'), 'utf8').trim();
  const facts = expected.answer, options = { ordered: !!expected.ordered, question };
  const probes = [
    ['facts', score(facts, facts, options), s => s === 1],
    ['no links', score(facts, strip(facts, 'link'), options), s => s === 1],
    ['nothing', score(facts, nulled(facts), options), s => s === 0],
    ['altered', score(facts, altered(facts), options), s => s < 1],
    ['loose', score(facts, loose(facts), options), s => s === 1],
  ];
  const wider = widened(facts); if (wider) probes.push(['one more', score(facts, wider, options), s => s < 1]);
  const problems = probes.filter(([, r, ok]) => !ok(r.score)).map(([name, r]) => `${name} ${show(r)}: ${r.facts.filter(f => !f.pass).map(f => `${f.fact} got ${JSON.stringify(f.got)}`).join('; ') || 'all facts passed'}`);
  let extracted = '';
  if (offline !== '1') {
    const [right, blank] = await Promise.all([
      correctness(question, expected, 'Here is what the page showed:\n' + JSON.stringify(facts, null, 2)),
      correctness(question, expected, 'I could not find that on LinkedIn.'),
    ]);
    if (right.score !== 1) problems.push(`extracted facts ${show(right)}: ${right.facts.filter(f => !f.pass).map(f => `${f.fact} got ${JSON.stringify(f.got)}`).join('; ')}`);
    if (blank.score !== 0) problems.push(`extracted nothing ${show(blank)}`);
    extracted = `, extraction ${show(right)} / ${show(blank)}`;
  }
  if (problems.length) failed++;
  console.log(`${task.padEnd(26)} ${probes[0][1].total} facts, ${probes.map(([n, r]) => `${n} ${show(r)}`).join(', ')}${extracted}${problems.length ? '\n  ✗ ' + problems.join('\n  ✗ ') : ''}`);
}
if (failed) { console.error(`${failed} task(s) inconsistent.`); process.exit(1); }
JS
