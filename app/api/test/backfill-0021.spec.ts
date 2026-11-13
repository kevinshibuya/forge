import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { migrateDb } from '../src/db/migrate';
import { migrateUpTo, recreateDatabase } from './helpers/migrate-partial';

const ADMIN = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const SCRATCH_DB = 'forge_backfill_0021_test';
const SCRATCH = ADMIN.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);

/** A settings row with rates that differ from the list prices, and a non-default draft_t3 model,
 *  so the assertions can tell which source priced a row and which seeded the registry. */
const SETTINGS = {
  scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: null },
  models: {
    draft_t1: 'claude-opus-4-8', draft_t2: 'claude-opus-4-8', draft_t3: 'claude-haiku-4-5',
    triage: 'claude-sonnet-5', image_html: 'claude-opus-4-8', image_gen: 'gpt-image-2',
    image_review: 'claude-opus-4-8', retro: 'claude-opus-4-8',
  },
  pricing: {
    perModel: {
      'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
      'claude-opus-4-8': { inputPerMTok: 15, outputPerMTok: 75 },
    },
    imagePerUnit: 0.25,
  },
  runTimeoutMs: 600_000, retrievalK: 5, imageCandidateBatch: 4,
  embeddingModel: 'text-embedding-3-small',
  personaDoc: '', goalDoc: '', designLanguageDoc: '', retroEveryMeasured: 3,
};

describe('migration 0021 cost backfill and registry seed', () => {
  it('prices historic runs from the settings row and seeds the cli rows from its models map', async () => {
    await recreateDatabase(ADMIN, SCRATCH_DB);
    await migrateUpTo(SCRATCH, '0020_post_delete');
    const sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });
    try {
      await sql`insert into settings (id, data) values (1, ${sql.json(SETTINGS)})`;
      const [single] = await sql`
        insert into runs (engine, kind, model, prompt, status, tokens_input, tokens_output)
        values ('claude', 'draft', 'claude-sonnet-5', 'p', 'succeeded', 1000000, 100000)
        returning id`;
      // The managed run's own totals would price at 7.5 + 0.5; the backfill must sum its steps instead.
      const [managed] = await sql`
        insert into runs (engine, kind, model, prompt, status, tokens_input, images_generated)
        values ('claude', 'image_hybrid', 'claude-opus-4-8', 'p', 'succeeded', 500000, 2)
        returning id`;
      await sql`
        insert into run_steps (run_id, seq, kind, engine, model, prompt, tokens_input, tokens_output, started_at, finished_at)
        values (${managed!.id}, 1, 'image_plan', 'claude', 'claude-sonnet-5', 'p', 500000, 0, now(), now())`;
      await sql`
        insert into run_steps (run_id, seq, kind, engine, model, prompt, tokens_output, images_generated, started_at, finished_at)
        values (${managed!.id}, 2, 'image_gen', 'codex', 'gpt-image-2', 'p', 33538, 2, now(), now())`;

      await migrateDb(SCRATCH);

      const cost = async (table: 'runs' | 'run_steps', where: postgres.PendingQuery<postgres.Row[]>) => {
        const [row] = await sql`select cost_usd::float8 as c from ${sql(table)} where ${where}`;
        return row!.c as number | null;
      };
      expect(await cost('runs', sql`id = ${single!.id}`)).toBeCloseTo(4.5, 6);
      expect(await cost('run_steps', sql`run_id = ${managed!.id} and seq = 1`)).toBeCloseTo(1.5, 6);
      expect(await cost('run_steps', sql`run_id = ${managed!.id} and seq = 2`)).toBeCloseTo(0.5, 6);
      expect(await cost('runs', sql`id = ${managed!.id}`)).toBeCloseTo(2.0, 6);

      const [draftT3] = await sql`
        select engine, model, input_per_mtok::float8 as i, cache_write_per_mtok::float8 as cw,
               cache_read_per_mtok::float8 as cr, output_per_mtok::float8 as o
        from model_registry where task = 'draft_t3' and backend = 'cli'`;
      expect(draftT3).toMatchObject({ engine: 'claude', model: 'claude-haiku-4-5' });
      expect([draftT3!.i, draftT3!.cw, draftT3!.cr, draftT3!.o]).toEqual([1, 1.25, 0.1, 5]);

      const [imageGen] = await sql`
        select engine, model, image_per_unit::float8 as img from model_registry where task = 'image_gen' and backend = 'cli'`;
      expect(imageGen).toMatchObject({ engine: 'codex', model: 'gpt-image-2', img: 0.25 });
    } finally {
      await sql.end();
    }
  });

  it('prices nothing when there is no settings row', async () => {
    await recreateDatabase(ADMIN, SCRATCH_DB);
    await migrateUpTo(SCRATCH, '0020_post_delete');
    const sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });
    try {
      await sql`
        insert into runs (engine, kind, model, prompt, status, tokens_input, tokens_output, images_generated)
        values ('claude', 'draft', 'claude-sonnet-5', 'p', 'succeeded', 1000, 100, 1)`;
      await migrateDb(SCRATCH);
      const [priced] = await sql`select count(*)::int as n from runs where cost_usd is not null`;
      expect(priced!.n).toBe(0);
      const [opus] = await sql`select model from model_registry where task = 'draft_t1' and backend = 'cli'`;
      expect(opus!.model).toBe('claude-opus-4-8');
    } finally {
      await sql.end();
    }
  });
});
