import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { posts, runs } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('schema migrations', () => {
  beforeAll(async () => { await migrateDb(url); });

  it('creates all tables and accepts a basic insert', async () => {
    const db = createDb(url);
    const [post] = await db.insert(posts).values({ tier: 'T1' }).returning();
    expect(post!.status).toBe('queued');
    const [run] = await db.insert(runs).values({
      engine: 'claude', kind: 'draft', model: 'claude-opus-4-8', prompt: 'x', postId: post!.id,
    }).returning();
    expect(run!.status).toBe('running');
  });

  it('v2 columns are gone, image_prompt exists, run_kind lacks image_brief', async () => {
    const db = createDb(url);
    const briefCol = await db.execute(sql`select 1 from information_schema.columns where table_name = 'posts' and column_name = 'image_brief'`);
    expect(briefCol.length).toBe(0);
    const verCol = await db.execute(sql`select 1 from information_schema.columns where table_name = 'assets' and column_name = 'verification'`);
    expect(verCol.length).toBe(0);
    const promptCol = await db.execute(sql`select data_type from information_schema.columns where table_name = 'posts' and column_name = 'image_prompt'`);
    expect(promptCol.length).toBe(1);
    expect((promptCol[0] as { data_type: string }).data_type).toBe('text');
    const kinds = await db.execute(sql`select unnest(enum_range(null::run_kind))::text as k`);
    expect(kinds.map((r) => (r as { k: string }).k)).not.toContain('image_brief');
  });

  it('posts.reference_asset_id exists, nullable, FK set-null to assets', async () => {
    const db = createDb(url);
    const cols = await db.execute(sql`
      select is_nullable from information_schema.columns
      where table_name = 'posts' and column_name = 'reference_asset_id'`);
    expect(cols.length).toBe(1);
    expect((cols[0] as { is_nullable: string }).is_nullable).toBe('YES');
    const fk = await db.execute(sql`
      select rc.delete_rule from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
      where kcu.table_name = 'posts' and kcu.column_name = 'reference_asset_id'`);
    expect(fk.length).toBe(1);
    expect((fk[0] as { delete_rule: string }).delete_rule).toBe('SET NULL');
  });

  it('what a post owns cascades, what records it keeps its row and loses the pointer', async () => {
    const db = createDb(url);
    const rows = await db.execute(sql`
      select tc.constraint_name, rc.delete_rule from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
        and tc.table_name in ('post_revisions', 'post_inputs', 'assets', 'runs', 'ideas', 'dim_post')`);
    const rules = new Map(rows.map((r) => {
      const { constraint_name, delete_rule } = r as { constraint_name: string; delete_rule: string };
      return [constraint_name, delete_rule];
    }));
    // Presence per pair, not equality on the whole result: dim_post carries a second FK.
    expect(rules.get('post_revisions_post_id_posts_id_fk')).toBe('CASCADE');
    expect(rules.get('post_inputs_post_id_posts_id_fk')).toBe('CASCADE');
    expect(rules.get('assets_post_id_posts_id_fk')).toBe('CASCADE');
    expect(rules.get('runs_post_id_posts_id_fk')).toBe('SET NULL');
    expect(rules.get('ideas_promoted_post_id_posts_id_fk')).toBe('SET NULL');
    // Pinned on purpose: D2 keeps the analytics dimension's pointer as it is.
    expect(rules.get('dim_post_post_id_posts_id_fk')).toBe('SET NULL');
    expect(rules.has('post_inputs_post_id_fkey')).toBe(false);
  });

  it('runs.engine is text, run_engine is gone, the registry holds 8 cli rows and 5 api rows', async () => {
    const db = createDb(url);
    const types = await db.execute(sql`
      select table_name, data_type from information_schema.columns
      where table_name in ('runs', 'run_steps') and column_name = 'engine' order by table_name`);
    expect(types.map((r) => (r as { data_type: string }).data_type)).toEqual(['text', 'text']);
    const enumType = await db.execute(sql`select 1 from pg_type where typname = 'run_engine'`);
    expect(enumType.length).toBe(0);
    const rows = await db.execute(sql`select backend, count(*)::int as n from model_registry group by 1 order by 1`);
    expect(rows.map((r) => r as { backend: string; n: number })).toEqual([
      { backend: 'api', n: 5 }, { backend: 'cli', n: 8 },
    ]);
  });
});
