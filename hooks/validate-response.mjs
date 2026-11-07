#!/usr/bin/env node
/** Attempt one repair of the envelope and each procedure output. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDirectory = fileURLToPath(new URL('../', import.meta.url));

async function loadOutputSchema(key) {
  const match = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(key);
  if (!match) throw new Error('expected an operation key such as profile.detail');
  const [, page, procedure] = match;
  const source = path.join(agentDirectory, 'pages', page, 'procedures', `${procedure}.output.json`);
  return { schema: JSON.parse(await readFile(source, 'utf8')), source };
}

function schemaErrors(ajv, schema, value, label) {
  const check = ajv.compile(schema);
  return check(value) ? [] : [ajv.errorsText(check.errors, { dataVar: label, separator: '; ' })];
}

async function validateResponse(message) {
  let value;
  try {
    if (typeof message !== 'string') throw new Error('missing response');
    value = JSON.parse(message);
  } catch {
    return ['response must be bare JSON, without Markdown fences or surrounding prose'];
  }
  // Load inside the error boundary so dependency or schema failures are visible.
  const { default: Ajv } = await import('ajv');
  const ajv = new Ajv({ allErrors: true });
  const envelope = JSON.parse(await readFile(new URL('../response.schema.json', import.meta.url), 'utf8'));
  const errors = schemaErrors(ajv, envelope, value, 'response');
  if (errors.length) return errors;
  for (const [index, { name: key, value: serialized }] of value.operations.entries()) {
    const label = `operations[${index}].value (${key})`;
    let output;
    try { output = JSON.parse(serialized); }
    catch { errors.push(`${label} must contain valid serialized JSON`); continue; }
    try {
      const { schema, source } = await loadOutputSchema(key);
      errors.push(...schemaErrors(ajv, schema, output, label).map(error => `${error} (schema: ${source})`));
    } catch (error) {
      errors.push(`${label}: cannot validate output: ${error.message}`);
    }
  }
  return errors;
}

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const event = JSON.parse(raw);
  if (event?.hook_event_name !== 'Stop' || event.stop_hook_active) return;
  let errors;
  try { errors = await validateResponse(event.last_assistant_message); }
  catch (error) {
    console.error(`[validate-response] ${error.message}`);
    errors = [`validation could not complete: ${error.message}`];
  }
  if (!errors.length) return;
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `Response validation failed:\n${errors.join('\n')}\nRead response.schema.json and the Output schema of each reported procedure. Re-emit one valid JSON object; operations must be an array of objects with name (page.procedure) and value (a JSON-serialized response matching that procedure's Output schema). Correct the response using existing observations; do not repeat actions already performed or invent missing evidence.`,
  }) + '\n');
}

// Malformed hook events cannot safely be repaired by the model. Retries fail open.
main().catch(error => console.error(`[validate-response] Hook failed: ${error.message}`));
