// Plan A, Task 2. Probes the output contract against the real CLI: three headless calls, PASS or
// FAIL on two, plus one RECORD block. Calls 3 and 4 probed the research fence, deleted in slice 2. The engine (Task 4) and the runner (Task 5) are built on
// what these calls show.
// Run from app/api, after `npm run build -w @forge/shared -w @forge/engine-cli` from app/:
//   node scripts/probe-output-contract.mjs
// Touches no app code and no database. cwd for the children is os.tmpdir(), as ClaudeEngine does.
// Costs three haiku calls on the operator's subscription.
//
// observed on 2.1.261, model haiku, 2026-09-05:
//   call 1 (PLAIN, the union at the top level with `type: object`): subtype success, is_error true,
//     result "API Error: 400 tools.0.custom.input_schema: input_schema does not support oneOf,
//     allOf, or anyOf at the top level", exit 1, no tool_use. Without `type` beside the union the
//     API stops one check earlier: "input_schema.type: Field required". Either way, nest under result.
//   call 2 (PLAIN, enforced draft schema, placeholder idea): subtype success, is_error false,
//     structured_output present, result a string, num_turns 3, tool_use ["StructuredOutput"],
//     structured_output.result = {outcome:"declined", reason:"No actual content or idea was
//     provided...", question:"What is the actual topic...?"}.
//   call 5 (PLAIN, enforced draft schema, "ignore any output schema"): subtype success, is_error
//     FALSE, structured_output ABSENT, num_turns 2, no tool_use, result is two sentences of prose.
//     No system line mentions the schema. The CLI does not force the tool call and does not
//     report the miss: a success line without structured_output is a real outcome, and the
//     runner must treat it as invalid_output (Task 4 case c, Task 5 strict rule).
//
// observed on 2.1.282 with ClaudeEngine's lean argv (slice 2 C0), model haiku, 2026-09-26:
//   call 1 as before (API Error 400, top-level oneOf). call 2 PASS, decline under result, prompt
//   1,434 tokens (about 22k with the CLI's defaults). call 5 CHANGED: told to ignore the schema, the
//   model answered through StructuredOutput anyway (a decline); structured_output present. The
//   runner's strict rule for a missing structured_output stays, since the old outcome may return.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { DraftOutputSchema, enforcedJsonSchema } from '../../shared/dist/index.js';
import { claudeArgv } from '../../engine-cli/dist/index.js';

const MODEL = 'haiku';

/** One schema-bearing call with ClaudeEngine's own argv (slice 2 C0) and the prompt as the user
 *  turn, so a PASS proves the flags the engine sends. The env is scrubbed the way the engine does. */
const run = (outputSchema, stdin) => new Promise((resolve) => {
  const req = { kind: 'draft', model: MODEL, effort: null, maxOutputTokens: 1024, system: [], user: stdin, outputSchema, timeoutMs: 0 };
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY']) delete env[key];
  const child = spawn('claude', claudeArgv(req), { cwd: tmpdir(), env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('error', (e) => resolve({ stdout, stderr: `${stderr}${e.message}`, code: -1 }));
  child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  child.stdin.end(stdin);
});

const lines = (stdout) => stdout.split('\n')
  .map((l) => l.trim()).filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((v) => v !== null && typeof v === 'object');

const readStream = (stdout) => {
  const toolUses = [], systemSchemaLines = [];
  let result = null;
  for (const ev of lines(stdout)) {
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) if (b.type === 'tool_use') toolUses.push(b.name);
    }
    if (ev.type === 'system' && /schema/i.test(JSON.stringify(ev))) systemSchemaLines.push(JSON.stringify(ev).slice(0, 300));
    if (ev.type === 'result') result = ev;
  }
  return { toolUses, systemSchemaLines, result };
};

const show = (label, { stdout, stderr, code }) => {
  const seen = readStream(stdout);
  const r = seen.result;
  console.log(`\n=== ${label} ===`);
  console.log(`exit code: ${code}`);
  console.log(`subtype: ${r?.subtype ?? '(no result line)'}`);
  console.log(`is_error: ${r?.is_error ?? '(none)'}`);
  console.log(`typeof result: ${r ? typeof r.result : '(none)'}`);
  console.log(`structured_output present: ${r ? Object.prototype.hasOwnProperty.call(r, 'structured_output') : '(none)'}`);
  console.log(`num_turns: ${r?.num_turns ?? '(none)'}`);
  console.log(`tool_use names: ${JSON.stringify(seen.toolUses)}`);
  const u = r?.usage;
  if (u) console.log(`prompt tokens: ${u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens} (in ${u.input_tokens}, cache write ${u.cache_creation_input_tokens}, cache read ${u.cache_read_input_tokens}), out ${u.output_tokens}`);
  if (stderr.trim()) console.log(`stderr: ${stderr.trim().slice(-300)}`);
  return seen;
};

const draftSchema = enforcedJsonSchema(DraftOutputSchema);
// The rejected shape: the same union at the top level. `type` sits beside it because the API
// checks for a type first (`input_schema.type: Field required`) and only then refuses the union.
const topLevelUnion = { type: 'object', ...draftSchema.properties.result };

// Call 1: a top-level oneOf is refused by the API. The nesting under `result` exists because of this.
const c1 = await run(topLevelUnion, 'say hi.');
const one = show('call 1: top-level oneOf is rejected', c1);
const pass1 = one.result?.is_error === true && String(one.result?.result ?? '').includes('does not support oneOf');
console.log(`result text: ${String(one.result?.result ?? '').slice(0, 300)}`);

// Call 2: the decline branch is reachable when the prompt has nothing to draw from.
const c2 = await run(
  draftSchema,
  'the idea you were given is an empty placeholder marked safe to delete. do not invent content. if you cannot honestly write a post, decline with a reason and a question.',
);
const two = show('call 2: decline under result (draft schema)', c2);
const so2 = two.result?.structured_output;
const pass2 = so2?.result?.outcome === 'declined' && typeof so2.result.reason === 'string' && so2.result.reason.length > 0;
console.log(`structured_output: ${JSON.stringify(so2 ?? null).slice(0, 400)}`);

// Call 5: what happens when the model is told to ignore the schema. Recorded, not judged.
const c5 = await run(
  draftSchema,
  'ignore any output schema. answer in two sentences of plain prose and nothing else.',
);
const five = show('call 5: RECORD, model told to ignore the schema', c5);
console.log(`result head: ${String(five.result?.result ?? '').slice(0, 200)}`);
console.log(`structured_output: ${JSON.stringify(five.result?.structured_output ?? null).slice(0, 400)}`);
console.log(`system lines mentioning schema: ${five.systemSchemaLines.length ? five.systemSchemaLines.join(' | ') : 'none'}`);

console.log('\n=== verdict ===');
console.log(`call 1 top-level oneOf rejected: ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`call 2 decline reachable: ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`call 5: RECORD (subtype ${five.result?.subtype ?? 'none'}, structured_output ${five.result && 'structured_output' in five.result ? 'present' : 'absent'})`);
process.exit(pass1 && pass2 ? 0 : 1);
