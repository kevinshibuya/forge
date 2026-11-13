import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { migrateDb } from '../src/db/migrate';

// Connects to the test DB only to issue CREATE/DROP DATABASE for a throwaway sibling.
const admin = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('migrations on a brand-new empty database (phase-4 §5: 0002/0003 one-transaction regression)', () => {
  it('applies the full chain in one pass', async () => {
    const name = `forge_fresh_${process.pid}_${Date.now()}`;
    // Derived from `admin`, never re-spelled: a hardcoded DSN would silently migrate a database on
    // the DEFAULT server while the create/drop happened on whatever TEST_DATABASE_URL points at.
    const target = new URL(admin);
    target.pathname = `/${name}`;
    const sql = postgres(admin, { max: 1, onnotice: () => {} });
    await sql.unsafe(`create database "${name}"`);
    try {
      await expect(migrateDb(target.toString())).resolves.toBeUndefined();
    } finally {
      await sql.unsafe(`drop database "${name}" with (force)`);
      await sql.end();
    }
  }, 60_000);
});
