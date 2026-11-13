import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { migrateDb } from '../src/db/migrate';
import { migrateUpTo, recreateDatabase } from './helpers/migrate-partial';

const ADMIN = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const SCRATCH_DB = 'forge_backfill_test';
const SCRATCH = ADMIN.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);
const SHARE_URL = 'https://www.linkedin.com/posts/user-example_synthetic-twin-post-share-9990000000000000101-AAAA';

describe('migration 0010 backfill', () => {
  it('moves legacy snapshots into canonical tables and drops the old table', async () => {
    await recreateDatabase(ADMIN, SCRATCH_DB);
    await migrateUpTo(SCRATCH, '0009_clear_schedule_on_published');

    const sql = postgres(SCRATCH, { max: 1, onnotice: () => {} });
    const [post] = await sql`
      insert into posts (tier, status, linkedin_url, published_at)
      values ('T1', 'measured', ${SHARE_URL}, '2026-07-02T14:00:00Z') returning id`;
    await sql`
      insert into analytics_snapshots
        (post_id, captured_at, impressions, reactions, comments, shares, saves, members_reached, demographics, created_at)
      values
        (${post!.id}, '2026-07-10T13:00:00Z', 1200, 22, 7, 0, 0, 700,
         ${sql.json({ jobTitles: [{ value: 'Engenheiro de software', percent: 3 }], locations: [], seniority: [], companies: [], industries: [], companySizes: [] })},
         '2026-07-10T13:00:01Z'),
        (${post!.id}, '2026-07-10T21:00:00Z', 1205, 23, 7, 0, 0, 702, null, '2026-07-10T21:00:01Z')`;

    await migrateDb(SCRATCH);

    const [dp] = await sql`select * from dim_post`;
    expect(dp!.post_urn).toBe('urn:li:share:9990000000000000101');
    expect(dp!.share_urn).toBe('urn:li:share:9990000000000000101');
    expect(dp!.post_id).toBe(post!.id);

    const [imp] = await sql`select value from fact_post_lifetime where metric = 'impressions'`;
    expect(Number(imp!.value)).toBe(1205); // later captured_at wins

    const audience = await sql`select * from fact_audience_segment`;
    expect(audience).toHaveLength(1);
    expect(audience[0]!.dimension).toBe('job_title');

    const files = await sql`select * from source_files order by imported_at`;
    expect(files).toHaveLength(2);
    expect(files[0]!.sha256).toMatch(/^legacy:/);

    const gone = await sql`select 1 from information_schema.tables where table_name = 'analytics_snapshots'`;
    expect(gone).toHaveLength(0);
    await sql.end();
  });
});
