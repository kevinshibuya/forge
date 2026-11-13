import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { migrateDb } from '../src/db/migrate';
import { migrateUpTo, recreateDatabase } from './helpers/migrate-partial';
import { LEGACY_PERSONA_DOC, LEGACY_UNSLOP_BODY, PERSONA_DOC, SEED_RULES, STYLE_DOCS } from '../src/seed/seed-content';

const ADMIN = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const SCRATCH_DB = 'forge_style_docs_test';
const SCRATCH = ADMIN.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);

/** A settings blob shaped like the live row: a persona, a goal, and a weekly goal that must survive. */
function settingsData(personaDoc: string) {
  return {
    scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: 3 },
    models: {
      draft_t1: 'claude-opus-4-8', draft_t2: 'claude-opus-4-8', draft_t3: 'claude-sonnet-5',
      triage: 'claude-sonnet-5', image_html: 'claude-opus-4-8', image_gen: 'gpt-image-2',
      image_review: 'claude-opus-4-8', retro: 'claude-opus-4-8',
    },
    pricing: { perModel: {}, imagePerUnit: 0.25 },
    runTimeoutMs: 600_000, retrievalK: 5, imageCandidateBatch: 4,
    embeddingModel: 'text-embedding-3-small',
    personaDoc, goalDoc: 'fix problems faster', designLanguageDoc: 'the design language',
    retroEveryMeasured: 3,
  };
}

/** Stands up the pre-0012 schema on the scratch database and seeds the fixtures. */
async function seedScratch(personaDoc: string): Promise<postgres.Sql> {
  await recreateDatabase(ADMIN, SCRATCH_DB);
  await migrateUpTo(SCRATCH, '0011_runs_tells');

  const sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });
  for (let i = 0; i < 13; i += 1) {
    await sql`
      insert into playbook_rules (category, rule, rationale, provenance, status)
      values ('voice', ${`old seed rule ${i}`}, 'because', 'seed', 'active')`;
  }
  await sql`
    insert into playbook_rules (category, rule, rationale, provenance, status)
    values ('visual', 'a rule kevin wrote by hand', 'mine', 'manual', 'active')`;
  await sql`insert into settings (id, data) values (1, ${sql.json(settingsData(personaDoc))})`;
  return sql;
}

describe('migration 0012 style docs and rule rewrite', () => {
  it('retires the old seed rules, inserts the new set, swaps the persona, adds the doc', async () => {
    const sql = await seedScratch(LEGACY_PERSONA_DOC);
    try {
      await migrateDb(SCRATCH);

      const [retired] = await sql`select count(*)::int as n from playbook_rules where status = 'retired'`;
      expect(retired!.n).toBe(13);

      const active = await sql`select rule, rationale, provenance from playbook_rules where status = 'active' order by id`;
      expect(active.filter((r) => r.provenance === 'seed')).toHaveLength(SEED_RULES.length);
      expect(active.map((r) => r.rule)).toContain('a rule kevin wrote by hand');   // the manual rule survives
      for (const seeded of SEED_RULES) {
        const row = active.find((r) => r.rule === seeded.rule);
        expect(row, `missing rule: ${seeded.rule}`).toBeDefined();
        expect(row!.rationale).toBe(seeded.rationale);
      }

      const [row] = await sql`select data from settings where id = 1`;
      const data = row!.data as Record<string, unknown>;
      expect(data.personaDoc).toBe(PERSONA_DOC);
      expect(data.styleDocs).toEqual(STYLE_DOCS);
      // The migration never writes scheduling.
      expect((data.scheduling as { weeklyGoal: number }).weeklyGoal).toBe(3);
      expect(data.goalDoc).toBe('fix problems faster');
    } finally {
      await sql.end();
    }
  });

  it('leaves a hand-edited persona alone', async () => {
    const edited = `${LEGACY_PERSONA_DOC}\n\nkevin added this line himself.`;
    const sql = await seedScratch(edited);
    try {
      await migrateDb(SCRATCH);
      const [row] = await sql`select data from settings where id = 1`;
      const data = row!.data as Record<string, unknown>;
      expect(data.personaDoc).toBe(edited);          // untouched
      expect(data.styleDocs).toEqual(STYLE_DOCS);    // the doc still lands
    } finally {
      await sql.end();
    }
  });

  it('re-running the guarded statements changes nothing', async () => {
    const sql = await seedScratch(LEGACY_PERSONA_DOC);
    try {
      // Stop AT 0012, not at the head of the chain. 0012's guards are written against the text
      // 0012 itself inserts, and 0015 later rewrites three of those rules, so re-running 0012's
      // inserts on a post-0015 database legitimately re-adds the three superseded rules. Drizzle
      // never re-runs a journalled migration, so that can only ever happen here. The property
      // worth pinning is the one 0012 actually claims: idempotent against its own output.
      await migrateUpTo(SCRATCH, '0012_style_docs_and_rule_rewrite');
      const before = await snapshot(sql);

      // Statements 2, 3 and 4 only. Statement 1 is deliberately NOT re-run: it would retire
      // the rules this migration just inserted.
      const file = await import('node:fs/promises');
      const sqlText = await file.readFile('src/db/migrations/0012_style_docs_and_rule_rewrite.sql', 'utf8');
      const statements = sqlText.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
      expect(statements).toHaveLength(SEED_RULES.length + 3);
      for (const statement of statements.slice(1)) await sql.unsafe(statement);

      expect(await snapshot(sql)).toEqual(before);
    } finally {
      await sql.end();
    }
  });
});

describe('migration 0013 unslop doc closing section', () => {
  /** 0012 only UPDATEs, so a scratch database has no settings row until one is inserted. This
   *  seeds the exact shape 0012 left on the live database: the unslop doc with the truncated body. */
  async function seedTruncatedDoc(body: string): Promise<postgres.Sql> {
    await recreateDatabase(ADMIN, SCRATCH_DB);
    await migrateUpTo(SCRATCH, '0012_style_docs_and_rule_rewrite');
    const sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });
    const data = { ...settingsData(PERSONA_DOC), styleDocs: [{ ...STYLE_DOCS[0]!, body }] };
    await sql`insert into settings (id, data) values (1, ${sql.json(data)})`;
    return sql;
  }

  it('repairs a doc that still carries the pre-repair body', async () => {
    const sql = await seedTruncatedDoc(LEGACY_UNSLOP_BODY);
    try {
      await migrateDb(SCRATCH);

      const [row] = await sql`select data from settings where id = 1`;
      const docs = (row!.data as { styleDocs: { id: string; body: string }[] }).styleDocs;
      expect(docs).toHaveLength(1);
      expect(docs[0]!.body).toBe(STYLE_DOCS[0]!.body);
      expect(docs[0]!.body).toContain('## before answering');
    } finally {
      await sql.end();
    }
  });

  it('leaves an operator-edited doc body alone', async () => {
    const edited = `${LEGACY_UNSLOP_BODY}\n\n- kevin added this line himself.`;
    const sql = await seedTruncatedDoc(edited);
    try {
      await migrateDb(SCRATCH);

      const [row] = await sql`select data from settings where id = 1`;
      const docs = (row!.data as { styleDocs: { body: string }[] }).styleDocs;
      expect(docs[0]!.body).toBe(edited);
    } finally {
      await sql.end();
    }
  });

  it('is a no-op on a database migrated from scratch', async () => {
    await recreateDatabase(ADMIN, SCRATCH_DB);
    const sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });
    try {
      await migrateDb(SCRATCH);   // 0012 seeds nothing: no settings row exists yet
      const rows = await sql`select data from settings where id = 1`;
      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});

async function snapshot(sql: postgres.Sql): Promise<unknown> {
  const rules = await sql`select rule, status, provenance from playbook_rules order by id`;
  const [settings] = await sql`select data from settings where id = 1`;
  return { rules: rules.map((r) => ({ ...r })), data: settings!.data };
}