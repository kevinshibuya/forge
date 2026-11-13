#!/usr/bin/env node
// Live probe of the `api` backend (slice 2, C4). Runs from app/api against an api started on a
// second port with `start:api`; the dev api on 3001 is left alone. It spends real money on the
// provider keys in app/api/.env: two triages and one draft, a few cents.
//
//   node scripts/probe-api-backend.mjs            # API_URL defaults to http://localhost:3002/api
//
// Scratch records only: two ideas, one T3 post, all removed at the end. The `triage` api registry
// row is patched to OpenAI for the second triage and restored in a finally. Exits non-zero if any
// run did not succeed or the row was not restored.
import { execFileSync } from 'node:child_process';

const API = (process.env.API_URL ?? 'http://localhost:3002/api').replace(/\/+$/, '');

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

function ledgerFor(runId) {
  const sql = `select coalesce(json_agg(l order by l.id), '[]') from (select id, attempt, engine, model, exit, tokens_input, tokens_cache_write, tokens_cache_read, tokens_output, cost_usd::float8, provider_request_id from ledger where run_id = ${Number(runId)}) l`;
  return JSON.parse(execFileSync('docker', ['exec', 'forge-db', 'psql', '-U', 'forge', '-d', 'forge', '-Atc', sql], { encoding: 'utf8' }));
}

async function waitTerminal(runId, timeoutMs = 300_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const run = await call('GET', `/runs/${runId}`);
    if (run.status !== 'running' && run.status !== 'queued') return run;
    if (Date.now() > until) throw new Error(`run ${runId} still ${run.status} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const IDEA_A = 'probe-api-backend: I started writing one ledger row per model call in forge, with the tokens and the '
  + 'cost at list price. The first week showed a one-word triage on the Claude CLI carried 22,140 prompt tokens, almost all of it '
  + 'the harness, not my prompt. Cutting the CLI flags took a draft from 25,251 prompt tokens and $0.075 to 4,256 tokens and $0.022.';
const IDEA_B = 'probe-api-backend: measured on the API, a T1 post (triage, draft, one refine) costs $0.046 in text with a warm '
  + 'prompt cache, against the $0.20 I had estimated. The cached 2,404-token constitution is what makes the refine cheap: '
  + '58% of its input was a cache read at a tenth of the price.';

const results = [];
function record(label, run) {
  const ledger = ledgerFor(run.id);
  results.push({ label, runId: run.id, status: run.status, engine: run.engine, model: run.model, failureKind: run.failureKind ?? null, ledger });
}

const ideas = [];
let postId;
let triageRow;
let restored = false;
try {
  const rows = await call('GET', '/registry');
  triageRow = rows.find((r) => r.task === 'triage' && r.backend === 'api');
  if (!triageRow) throw new Error('no triage row on the api backend');

  // The ideas carry real specifics from slice 2's measurements: a thin label gets an honest decline
  // under the output contract, and the probe then fails on the model's judgement, not the backend.
  const a = await call('POST', '/ideas', { rawText: IDEA_A, source: 'work' });
  ideas.push(a.id);
  const t1 = await call('POST', `/ideas/${a.id}/triage`);
  record('triage (anthropic)', await waitTerminal(t1.runId));

  await call('PATCH', `/registry/${triageRow.id}`, { engine: 'openai', model: 'gpt-5.6-terra' });
  try {
    const b = await call('POST', '/ideas', { rawText: IDEA_B, source: 'work' });
    ideas.push(b.id);
    const t2 = await call('POST', `/ideas/${b.id}/triage`);
    record('triage (openai)', await waitTerminal(t2.runId));
  } finally {
    await call('PATCH', `/registry/${triageRow.id}`, { engine: triageRow.engine, model: triageRow.model });
    const after = (await call('GET', '/registry')).find((r) => r.id === triageRow.id);
    restored = after?.engine === triageRow.engine && after?.model === triageRow.model;
  }

  const promoted = await call('POST', `/ideas/${a.id}/promote`, { tier: 'T3' });
  postId = promoted.postId;
  const launch = await call('POST', `/posts/${postId}/draft`, {});
  record('draft T3 (anthropic)', await waitTerminal(launch.runId));
} finally {
  if (postId !== undefined) await call('DELETE', `/posts/${postId}`).catch((e) => console.error(`cleanup: ${e.message}`));
  for (const id of ideas) await call('PATCH', `/ideas/${id}`, { status: 'discarded' }).catch((e) => console.error(`cleanup: ${e.message}`));
}

console.log(JSON.stringify(results, null, 2));
const spend = results.flatMap((r) => r.ledger).reduce((s, l) => s + (l.cost_usd ?? 0), 0);
console.log(`registry row ${triageRow?.id} restored: ${restored}; recorded spend $${spend.toFixed(6)}`);
const bad = results.filter((r) => r.status !== 'succeeded');
if (bad.length || !restored || results.length !== 3) {
  console.error(`FAIL: ${bad.map((r) => `${r.label} ${r.status} ${r.failureKind}`).join('; ') || 'row not restored or a run missing'}`);
  process.exit(1);
}
console.log('PASS');
