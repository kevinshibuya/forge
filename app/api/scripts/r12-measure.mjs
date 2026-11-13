#!/usr/bin/env node
// R12 re-run on the ledger (slice 2, C5). Runs from app/api against an `api`-backend instance on a
// second port (`start:api`); spends real money on the keys in app/api/.env, about six Sonnet calls.
//
//   node scripts/r12-measure.mjs                  # API_URL defaults to http://localhost:3002/api
//
// Scratch records only: two triages of one scratch idea 30 s apart (does the second read the cache?),
// three scratch posts promoted at T3, T2 and T1 with one draft each, and one refine on the T1 right
// after its draft (the cache-read case). Prints the ledger table, then deletes the posts and
// discards the ideas. No registry edits: the rows as seeded are what is measured.
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

const psql = (sql) => execFileSync('docker', ['exec', 'forge-db', 'psql', '-U', 'forge', '-d', 'forge', '-Atc', sql], { encoding: 'utf8' }).trim();

async function waitTerminal(runId, timeoutMs = 600_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const run = await call('GET', `/runs/${runId}`);
    if (run.status !== 'running' && run.status !== 'queued') return run;
    if (Date.now() > until) throw new Error(`run ${runId} still ${run.status} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const IDEAS = {
  T3: 'Pricing every model call at list price changed which model I reach for. A one-word triage on the CLI carried 22k tokens of harness prompt; cutting it to 4k made the same draft cost a third.',
  T2: 'A ledger row per model call and per attempt, written on every exit path, is what made a timeout visible as money spent rather than a silent failure. What I would build first in any LLM app.',
  T1: 'Moving a personal writing tool from CLI subscriptions to metered APIs: what the seam between the two looks like, why the provider schemas differ (oneOf vs anyOf, strict required), and what caching actually saves on a 5k-token constitution.',
};

const postsBefore = Number(psql('select count(*) from posts'));
const runs = []; // { label, tier, runId }
const ideas = [];
const posts = [];
try {
  const scratch = await call('POST', '/ideas', { rawText: IDEAS.T3, source: 'work' });
  ideas.push(scratch.id);
  const t1 = await call('POST', `/ideas/${scratch.id}/triage`);
  runs.push({ label: 'triage #1', tier: null, runId: (await waitTerminal(t1.runId)).id });
  await new Promise((r) => setTimeout(r, 30_000));
  const t2 = await call('POST', `/ideas/${scratch.id}/triage`);
  runs.push({ label: 'triage #2 (+30 s)', tier: null, runId: (await waitTerminal(t2.runId)).id });

  for (const tier of ['T3', 'T2', 'T1']) {
    const idea = tier === 'T3' ? scratch : await call('POST', '/ideas', { rawText: IDEAS[tier], source: 'work' });
    if (tier !== 'T3') ideas.push(idea.id);
    const { postId } = await call('POST', `/ideas/${idea.id}/promote`, { tier });
    posts.push(postId);
    const draft = await call('POST', `/posts/${postId}/draft`, {});
    runs.push({ label: `draft ${tier}`, tier, runId: (await waitTerminal(draft.runId)).id });
    if (tier === 'T1') {
      // The run row goes terminal a moment before the post leaves `drafting`; refine needs `draft_ready`.
      for (let i = 0; (await call('GET', `/posts/${postId}`)).post.status === 'drafting'; i++) {
        if (i > 30) throw new Error(`post ${postId} still drafting`);
        await new Promise((r) => setTimeout(r, 500));
      }
      const refine = await call('POST', `/posts/${postId}/refine`, { feedback: 'Cut the opening sentence and end on the concrete number, not a question.' });
      runs.push({ label: 'refine T1', tier, runId: (await waitTerminal(refine.runId)).id });
    }
  }
} finally {
  for (const id of posts) await call('DELETE', `/posts/${id}`).catch((e) => console.error(`cleanup: ${e.message}`));
  for (const id of ideas) await call('PATCH', `/ideas/${id}`, { status: 'discarded' }).catch((e) => console.error(`cleanup: ${e.message}`));
}

const ids = runs.map((r) => r.runId).join(',');
const rows = JSON.parse(psql(`select coalesce(json_agg(x order by x.run_id, x.id), '[]') from (
  select l.id, l.run_id, r.kind, r.status, l.attempt, l.model, l.exit, l.tokens_input, l.tokens_cache_write, l.tokens_cache_read, l.tokens_output, l.cost_usd::float8
  from ledger l join runs r on r.id = l.run_id where l.run_id in (${ids})) x`));

const cells = ['label', 'run', 'kind', 'status', 'model', 'in', 'cache_w', 'cache_r', 'out', 'cost_usd'];
console.log(`| ${cells.join(' | ')} |\n|${cells.map(() => '---').join('|')}|`);
for (const r of rows) {
  const label = runs.find((x) => x.runId === r.run_id)?.label ?? '?';
  console.log(`| ${[label, r.run_id, r.kind, r.status, r.model, r.tokens_input, r.tokens_cache_write, r.tokens_cache_read, r.tokens_output, r.cost_usd?.toFixed(6)].join(' | ')} |`);
}
const refine = rows.find((r) => runs.find((x) => x.runId === r.run_id)?.label === 'refine T1');
if (refine) {
  const total = (refine.tokens_input ?? 0) + (refine.tokens_cache_write ?? 0) + (refine.tokens_cache_read ?? 0);
  console.log(`\nrefine cache-read share of input: ${total ? ((100 * (refine.tokens_cache_read ?? 0)) / total).toFixed(1) : 'n/a'}%`);
}
const spend = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
console.log(`total recorded spend $${spend.toFixed(6)}`);
const nullCells = rows.filter((r) => r.tokens_input == null || r.tokens_output == null);
const postsAfter = Number(psql('select count(*) from posts'));
console.log(`posts before ${postsBefore}, after ${postsAfter}`);
if (nullCells.length || rows.length < runs.length || postsAfter !== postsBefore || rows.some((r) => r.status !== 'succeeded')) {
  console.error('FAIL: a null token cell, a missing ledger row, a failed run, or scratch posts left behind');
  process.exit(1);
}
console.log('PASS');
