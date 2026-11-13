import { afterAll, describe, expect, it } from 'vitest';
import { testDb } from './helpers/db';

describe('database', () => {
  const sql = testDb();
  afterAll(() => sql.end());

  it('connects and has pgvector available', async () => {
    const rows = await sql`SELECT 1 AS one`;
    expect(rows[0]?.one).toBe(1);
    const exts = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(exts).toHaveLength(1);
  });
});
