#!/usr/bin/env node
/**
 * The correctness score of an answer in plain language, 0 to 1. The agent's final message — from the
 * ATIF trajectory Harbor writes for every harness — is read into the shape of the task's facts
 * (tests/expected.json, built from the shapes in shapes.json) by Claude Haiku, which is made to call one
 * tool, `answer`, whose input schema is derived from those facts: the same keys, every field nullable, a
 * description per field from the shapes. Haiku extracts; it does not judge. Then code compares, fact by
 * fact — a number, a string, a date, a linked thing identified by name or link, a list with exactly its
 * members — each fact 1 or 0, and the score is their mean, every fact weighing the same. The answer is
 * all that is graded: how the agent got there is the trajectory's to show, not the score's.
 *
 * The extractor is Claude Haiku by default — through the API when ANTHROPIC_API_KEY is set, else through the
 * Claude Code CLI with CLAUDE_CODE_OAUTH_TOKEN — or Gemini, through the Gemini API with GEMINI_API_KEY, forced
 * onto the same `answer` function. EXTRACTOR=claude|gemini chooses; unset, it is Claude when a Claude login
 * is there and Gemini when only a Gemini key is. EXTRACTOR_MODEL overrides the model of either.
 */
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// The extractor is part of the grade: Claude Opus, the strongest reader, so that hedged answers are read as their
// author meant them (Haiku took an answer's alternative for its answer). Gemini is the fallback with only a Gemini key.
export const EXTRACTORS = { claude: 'claude-opus-5-5', gemini: 'gemini-3.5-flash-lite' };
/** Which extractor runs, and on which model: EXTRACTOR, else Claude with a Claude login, else Gemini with a key. */
export function extractor(env = process.env) {
  const asked = (env.EXTRACTOR || '').trim().toLowerCase();
  const kind = asked || (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN ? 'claude' : env.GEMINI_API_KEY ? 'gemini' : 'claude');
  if (!EXTRACTORS[kind]) throw new Error(`EXTRACTOR must be claude or gemini, not ${asked}`);
  return { kind, model: env.EXTRACTOR_MODEL || EXTRACTORS[kind] };
}
export const EXTRACTOR_MODEL = EXTRACTORS.claude;

/** The shapes the facts are built from (shapes.json beside this file): field meanings, identities, and
 * which key holds which shape. */
const SHAPES_FILE = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'shapes.json'), 'utf8'));
export const SHAPES = SHAPES_FILE.shapes;
export const KEYS = SHAPES_FILE.keys;

/** The agent's final message: from Harbor's ATIF trajectory — the last agent step that says something —
 * or, when the file is not one, the text itself. */
export function finalMessage(text) {
  let document;
  try { document = JSON.parse(text); } catch { return text; }
  if (!document || !Array.isArray(document.steps)) return text;
  const step = [...document.steps].reverse().find(s => s.source === 'agent' && typeof s.message === 'string' && s.message.trim());
  if (!step) throw new Error('No final agent message in the trajectory.');
  return step.message;
}

// ---- The schema: the facts' own shape, every field nullable, described from the shapes. ----

const shapeOf = key => KEYS[key] ?? null;
const meaning = (shape, key) => SHAPES[shape]?.fields?.[key]
  ?? Object.values(SHAPES).map(s => s.fields?.[key]).find(Boolean)
  ?? (key.startsWith('total_') ? `the sum of ${key.slice(6)} over the posts listed` : key.replace(/_/g, ' '));

/** The JSON schema of the `answer` tool for these facts: the same keys; a number, string, boolean or
 * object where the facts have one, null where the message does not say; a list of the same item shape. */
export function schemaFor(facts, shape = null) {
  if (Array.isArray(facts)) {
    const item = facts.length ? schemaFor(facts[0], shape) : schemaFor(Object.fromEntries((SHAPES[shape]?.identity ?? ['name']).map(k => [k, ''])), shape);
    return { type: ['array', 'null'], description: 'every item the message names, in the message\'s order; empty when it says there are none; null when it does not say', items: { ...item, type: 'object' } };
  }
  if (facts && typeof facts === 'object') {
    const properties = {};
    for (const [key, value] of Object.entries(facts)) {
      const inner = shapeOf(key) ?? shape;
      const schema = schemaFor(value, inner);
      properties[key] = { description: (value && typeof value === 'object') ? (SHAPES[inner]?.what ?? key) : meaning(shape, key), ...schema };
    }
    return { type: ['object', 'null'], properties, required: Object.keys(properties), additionalProperties: false };
  }
  const type = typeof facts === 'number' ? 'number' : typeof facts === 'boolean' ? 'boolean' : 'string';
  return { type: [type, 'null'] };
}

export function extractorPrompt(question, answer) {
  return `Read the assistant's message below and call the answer tool with what it states — nothing it does not say. Copy names, numbers, dates and quoted text as written. A list holds the items the message gives as its answer to the question, in the message's order; it leaves out what the message mentions only as context — items it says it excluded, runners-up, what else is on the page — and is empty when the message says there are none. When the message gives a definite answer and also an alternative — a borderline case, a broader reading, an "including" variant — take the definite answer, for the list and for every total. A count the message gives as none, no or zero is 0. Leave null what the message does not say.

The question the message answers:
${question.trim()}

The assistant's message:
${answer.trim()}`;
}

/** The message read into the facts' shape by the extractor: an object matching schemaFor(facts). */
export async function extract(question, facts, answer) {
  const schema = schemaFor(facts);
  const prompt = extractorPrompt(question, answer);
  const { kind, model } = extractor();
  if (kind === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('EXTRACTOR=gemini needs GEMINI_API_KEY.');
    // Gemini forced onto one function, `answer`, its parameters the same JSON Schema the Claude tool gets.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ functionDeclarations: [{ name: 'answer', description: 'What the assistant\'s message states, in the shape of the question\'s answer.', parametersJsonSchema: { ...schema, type: 'object' } }] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['answer'] } },
        generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      }),
    });
    if (!response.ok) throw new Error(`Extractor API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json();
    const call = (body.candidates?.[0]?.content?.parts || []).find(part => part.functionCall)?.functionCall;
    if (!call) throw new Error('The extractor did not call the answer function.');
    return call.args || {};
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 1500, temperature: 0,
        tools: [{ name: 'answer', description: 'What the assistant\'s message states, in the shape of the question\'s answer.', input_schema: { ...schema, type: 'object' } }],
        tool_choice: { type: 'tool', name: 'answer' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Extractor API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json();
    const call = body.content.find(part => part.type === 'tool_use');
    if (!call) throw new Error('The extractor did not call the answer tool.');
    return call.input;
  }
  // The Claude Code CLI as the extractor: one turn, no tools of its own, no settings, no sessions, its own
  // config dir; the schema as its structured output.
  const config = await mkdtemp(path.join(tmpdir(), 'extract-'));
  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn('claude', [
        '-p', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify({ ...schema, type: 'object' }),
        '--max-turns', '3', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
        '--disallowedTools', 'Bash,Read,Write,Edit,MultiEdit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,Agent',
      ], { cwd: config, env: { ...process.env, CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1' } });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`Extractor CLI exited ${code}: ${err.slice(0, 300)}`)));
      child.stdin.end(prompt);
    });
    const result = JSON.parse(stdout);
    if (!result.structured_output) throw new Error('The extractor CLI returned no structured output.');
    return result.structured_output;
  } finally { await rm(config, { recursive: true, force: true }); }
}

// ---- The comparison: fact by fact, 1 or 0. ----

const MONTHS = { january: 'jan', february: 'feb', march: 'mar', april: 'apr', may: 'may', june: 'jun', july: 'jul', august: 'aug', september: 'sep', sept: 'sep', october: 'oct', november: 'nov', december: 'dec' };
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const UNITS = { s: 's', sec: 's', second: 's', m: 'm', min: 'm', minute: 'm', h: 'h', hr: 'h', hour: 'h', d: 'd', day: 'd', w: 'w', wk: 'w', week: 'w', mo: 'mo', month: 'mo', y: 'y', yr: 'y', year: 'y' };

/** A string as compared: whitespace, quotes and dashes normalized, case folded, a final ellipsis or period
 * dropped — an opening quoted as "Last quarter the design system got simpler…" is that text's opening. */
export const norm = value => String(value ?? '')
  .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/[–—−]/g, '-')
  .replace(/\s+/g, ' ').trim().replace(/\s*(…|\.{3})$/, '').replace(/\.$/, '').toLowerCase();

const number = value => {
  if (typeof value === 'number') return value;
  const digits = String(value ?? '').replace(/[,\s ]/g, '').match(/-?\d+(\.\d+)?/);
  return digits ? Number(digits[0]) : null;
};
const link = value => norm(value).replace(/^https?:\/\//, '').replace(/^(www\.)?linkedin\.com/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
/** An age in LinkedIn's form: "6d", "6 days ago", "six days", "a week ago", "1w • Edited" → "6d", "1w". */
const age = value => {
  const s = norm(value).replace(/\bago\b|•.*$|\bedited\b/g, '').trim();
  const m = s.match(/^(\d+|[a-z]+)\s*([a-z]+)$/) ?? s.match(/^(\d+)([a-z]+)$/);
  if (!m) return s;
  const n = WORDS[m[1]] ?? number(m[1]);
  const unit = UNITS[m[2].replace(/s$/, '')] ?? UNITS[m[2]] ?? m[2];
  return n == null ? s : `${n}${unit}`;
};
/** A date as shown: "April 2026" → "apr 2026"; "present", "now", "current", "today" → "present". */
const date = value => {
  const s = norm(value);
  if (/^(present|now|current|currently|today|ongoing)$/.test(s)) return 'present';
  return s.split(/\s+/).map(w => MONTHS[w] ?? w).join(' ');
};
const DATE_FIELDS = new Set(['from', 'to']);

/** Whether an extracted value states the expected one. */
export function same(key, expected, got) {
  if (got == null) return false;
  if (typeof expected === 'number') return number(got) === expected;
  if (typeof expected === 'boolean') return got === expected || norm(got) === String(expected);
  if (key === 'link') return link(got) === link(expected);
  if (key === 'posted') return age(got) === age(expected);
  if (DATE_FIELDS.has(key)) return date(got) === date(expected);
  if (key === 'text' || key === 'about' || key === 'description') {
    const a = norm(expected), b = norm(got);
    // An opening identifies the text when it is long enough to be distinctive: some twenty characters, four words.
    return a === b || (a.length >= 20 && b.length >= 20 && (b.startsWith(a) || a.startsWith(b)));
  }
  return norm(got) === norm(expected);
}

const identityOf = shape => SHAPES[shape]?.identity ?? null;
/** Whether an extracted object is the expected one: any identity field matches. */
const identified = (shape, expected, got) => {
  const keys = (identityOf(shape) ?? []).filter(k => expected[k] != null);
  return !!got && typeof got === 'object' && keys.some(k => same(k, expected[k], got[k]));
};

/** Whether the question itself states this identity value — a link it gives, a name it uses: then the
 * thing is given, not a fact to find. */
const given = (question, key, value) => !!question && (key === 'link' ? link(question).includes(link(value)) : norm(question).includes(norm(value)));

/** The facts of expected, each compared with got: [{fact, expected, got, pass}]. A linked thing's identity
 * is one fact (name or link, a post also its opening words) unless the question states it; every other
 * field is one; a list is the facts of each member plus one for having exactly those members, in order
 * when `ordered`. */
export function compare(expected, got, { ordered = false, shape = null, at = '', question = '' } = {}) {
  const facts = [];
  if (Array.isArray(expected)) {
    const list = Array.isArray(got) ? got : null;
    const used = new Set();
    expected.forEach((member, i) => {
      const where = `${at}[${i}]`;
      const isThing = member && typeof member === 'object' && identityOf(shape);
      let match = null, index = -1;
      if (list) list.forEach((candidate, j) => {
        if (match || used.has(j)) return;
        const hit = isThing ? identified(shape, member, candidate) : (member && typeof member === 'object' ? true : same(at.split('.').pop(), member, candidate));
        if (hit && (!ordered || j === i)) { match = candidate; index = j; }
      });
      if (index >= 0) used.add(index);
      if (isThing) facts.push({ fact: `${where} is ${identityOf(shape).map(k => member[k]).filter(Boolean).join(' | ')}`, expected: Object.fromEntries(identityOf(shape).filter(k => member[k] != null).map(k => [k, member[k]])), got: match ?? (list?.[i] ?? null), pass: !!match });
      if (member && typeof member === 'object') facts.push(...compare(member, match ?? {}, { ordered, shape, at: where, question }).filter(f => !f.identity));
      else if (!isThing) facts.push({ fact: where, expected: member, got: match ?? null, pass: !!match });
    });
    const exact = !!list && list.length === expected.length && used.size === expected.length;
    facts.push({ fact: `${at} has exactly ${expected.length} member(s)${ordered ? ', in order' : ''}`, expected: expected.length, got: list ? list.length : null, pass: exact });
    return facts;
  }
  if (expected && typeof expected === 'object') {
    const ids = identityOf(shape) ?? [];
    const present = ids.filter(k => expected[k] != null);
    if (present.length && !at.endsWith(']') && !present.some(k => given(question, k, expected[k]))) {
      // A linked thing at a key: its identity is one fact, unless the question names it.
      facts.push({ identity: true, fact: `${at} is ${present.map(k => expected[k]).join(' | ')}`, expected: Object.fromEntries(present.map(k => [k, expected[k]])), got: got && typeof got === 'object' ? Object.fromEntries(present.map(k => [k, got[k] ?? null])) : got ?? null, pass: identified(shape, expected, got) });
    }
    for (const [key, value] of Object.entries(expected)) {
      if (present.includes(key)) continue;
      const inner = shapeOf(key) ?? shape;
      const where = at ? `${at}.${key}` : key;
      const sub = got && typeof got === 'object' ? got[key] : null;
      if (value && typeof value === 'object') facts.push(...compare(value, sub, { ordered, shape: inner, at: where, question }));
      else facts.push({ fact: where, expected: value, got: sub ?? null, pass: same(key, value, sub) });
    }
    return facts;
  }
  return [{ fact: at, expected, got: got ?? null, pass: same(at.split('.').pop(), expected, got) }];
}

/** The score of an extraction against the facts: the facts compared and their mean. Options: `ordered`
 * (lists in order), `question` (what it states is given). */
export function score(facts, got, options = {}) {
  const compared = compare(facts, got, options).map(({ identity, ...f }) => f);
  const passed = compared.filter(f => f.pass).length;
  return { score: compared.length ? passed / compared.length : 0, passed, total: compared.length, facts: compared };
}

/** The whole metric: extract, compare. */
export async function correctness(question, expected, answer) {
  const facts = expected.answer, ordered = !!expected.ordered;
  const extracted = await extract(question, facts, answer);
  return { extractor: extractor(), extracted, ...score(facts, extracted, { ordered, question }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [expectedFile, responseFile = '/logs/agent/trajectory.json', logs = '/logs/verifier'] = process.argv.slice(2);
  if (!expectedFile) throw new Error('Usage: correctness.mjs EXPECTED [RESPONSE] [LOG_DIRECTORY]');
  let result;
  try {
    const expected = JSON.parse(await readFile(expectedFile, 'utf8'));
    const question = await readFile(path.join(path.dirname(expectedFile), 'instruction.md'), 'utf8');
    const answer = finalMessage(await readFile(responseFile, 'utf8'));
    result = { answer, ...await correctness(question, expected, answer) };
  } catch (error) { result = { score: 0, error: error.message }; }
  await mkdir(logs, { recursive: true });
  await writeFile(`${logs}/result.json`, JSON.stringify(result, null, 2));
  await writeFile(`${logs}/reward.txt`, String(result.score));
  const failed = (result.facts ?? []).filter(f => !f.pass).map(f => `  ✗ ${f.fact}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.got)}`);
  console.log(`${result.score} (${result.passed ?? 0}/${result.total ?? 0} facts)${result.error ? `\n  ${result.error}` : ''}${failed.length ? '\n' + failed.join('\n') : ''}`);
}
