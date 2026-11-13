import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { migrateDb } from '../src/db/migrate';
import { recreateDatabase } from './helpers/migrate-partial';
import { backfillPostSources, writeIfEmpty, type BackfillLine } from '../scripts/backfill-post-sources';
import type { Source } from '@forge/shared';

const ADMIN = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
// Its own scratch database: `forge_backfill_test` belongs to backfill-migration.spec.ts.
const SCRATCH_DB = 'forge_sources_backfill_test';
const SCRATCH = ADMIN.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);

const TWO: Source[] = [
  { kind: 'file', ref: 'harness/agents/worker.md', note: 'pinned to opus' },
  { kind: 'web', ref: 'https://nodejs.org', note: 'the current lts' },
];
const ONE: Source[] = [{ kind: 'web', ref: 'https://one', note: 'the only one' }];

/** How an older run stored it: prose either side of a fenced block. */
const FENCED = `here is the draft\n\n\`\`\`json\n${JSON.stringify({ body_linkedin: 'b', hashtags: [], sources: TWO })}\n\`\`\`\n\nthat is all`;
/** How plan A's runs store it: the bare payload. */
const BARE = JSON.stringify({ body_linkedin: 'b', hashtags: [], sources: ONE });

describe('backfill post sources', () => {
  let sql: postgres.Sql;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    await recreateDatabase(ADMIN, SCRATCH_DB);
    await migrateDb(SCRATCH);
    sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });

    // sql.json, not a bound string against ::jsonb: postgres.js encodes a JS string as a JSON
    // string, so `'[]'::jsonb` would store the two characters, not an empty array.
    const post = async (key: string, sources: Source[] = []) => {
      const [row] = await sql<{ id: number }[]>`
        insert into posts (tier, status, sources) values ('T1', 'draft_ready', ${sql.json(sources)}) returning id`;
      id[key] = row!.id;
      return row!.id;
    };
    const draft = async (postId: number, output: string, startedAt: string, status = 'succeeded') => {
      await sql`
        insert into runs (engine, kind, model, prompt, output, status, post_id, started_at)
        values ('claude', 'draft', 'claude-opus-5', 'p', ${output}, ${status}, ${postId}, ${startedAt})`;
    };

    // An older run's fenced output, and a superseded earlier one that must not win.
    const fenced = await post('fenced');
    await draft(fenced, JSON.stringify({ body_linkedin: 'b', hashtags: [], sources: [] }), '2026-08-01T00:00:00Z');
    await draft(fenced, FENCED, '2026-09-01T00:00:00Z');

    await draft(await post('bare'), BARE, '2026-09-01T00:00:00Z');
    await draft(await post('filled', ONE), FENCED, '2026-09-01T00:00:00Z');
    await draft(await post('unparseable'), 'not json', '2026-09-01T00:00:00Z');
    await post('norun');
  });

  afterAll(async () => {
    await sql?.end();
    // Dropping needs no connection to the scratch database itself.
    const admin = postgres(ADMIN, { max: 1, onnotice: () => {} });
    try { await admin.unsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`); } finally { await admin.end(); }
  });

  const find = (lines: BackfillLine[], key: string) => lines.find((l) => l.postId === id[key])!;
  const sourcesOf = async (key: string) => {
    const [row] = await sql<{ sources: unknown }[]>`select sources from posts where id = ${id[key]!}`;
    return row!.sources;
  };

  it('reads both stored shapes, reports one line per post, and a dry run writes nothing', async () => {
    const lines = await backfillPostSources(SCRATCH, { write: false });

    expect(lines).toHaveLength(5);
    expect(find(lines, 'fenced')).toEqual({ postId: id.fenced, outcome: 'set', count: 2, runId: expect.any(Number) });
    expect(find(lines, 'bare')).toEqual({ postId: id.bare, outcome: 'set', count: 1, runId: expect.any(Number) });
    expect(find(lines, 'filled')).toEqual({ postId: id.filled, outcome: 'skipped_non_empty' });
    expect(find(lines, 'norun')).toEqual({ postId: id.norun, outcome: 'skipped_no_run' });
    expect(find(lines, 'unparseable').outcome).toBe('skipped_unparseable');

    expect(await sourcesOf('fenced')).toEqual([]);
    expect(await sourcesOf('bare')).toEqual([]);
  });

  it('writes with --yes, and a second pass claims nothing', async () => {
    const first = await backfillPostSources(SCRATCH, { write: true });
    expect(find(first, 'fenced').outcome).toBe('set');
    expect(await sourcesOf('fenced')).toEqual(TWO);
    expect(await sourcesOf('bare')).toEqual(ONE);
    expect(await sourcesOf('filled')).toEqual(ONE); // untouched

    const second = await backfillPostSources(SCRATCH, { write: true });
    expect(find(second, 'fenced')).toEqual({ postId: id.fenced, outcome: 'skipped_non_empty' });
    expect(find(second, 'bare')).toEqual({ postId: id.bare, outcome: 'skipped_non_empty' });
    expect(await sourcesOf('fenced')).toEqual(TWO);
  });

  it('writeIfEmpty refuses a column that is no longer empty', async () => {
    const wrote = await writeIfEmpty(sql, id.filled!, TWO);

    expect(wrote).toBe(false);
    expect(await sourcesOf('filled')).toEqual(ONE);
  });

  it('reports each line as it is decided, so a later throw loses nothing already printed', async () => {
    const seen: BackfillLine[] = [];
    const lines = await backfillPostSources(SCRATCH, { write: false, onLine: (l) => seen.push(l) });
    expect(seen).toEqual(lines);
    expect(seen.length).toBeGreaterThan(0);
  });
});
