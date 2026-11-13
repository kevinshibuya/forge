import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Same cwd coupling as src/db/migrate.ts: these run with cwd = app/api.
const MIGRATIONS_FOLDER = 'src/db/migrations';

interface Journal {
  entries: { tag: string }[];
}

/**
 * Migrates `url` up to (and including) `lastTag`, leaving later migrations unapplied —
 * the only way to stand up an OLD schema so a backfill migration can be tested against
 * real legacy rows. Works on a throwaway copy of the migrations folder with a truncated
 * journal; the tracked migrations are never touched.
 *
 * Migrations are applied ONE AT A TIME, each in its own transaction, because the history
 * is not batch-safe: `0002` adds a `run_kind` enum value that `0003` then references, and
 * Postgres refuses to use a new enum value inside the transaction that created it. A
 * long-lived database never hits this (it applied them incrementally); a freshly created
 * one migrated in a single batch does.
 */
export async function migrateUpTo(url: string, lastTag: string): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'forge-migrations-'));
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal;
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut === -1) throw new Error(`migrateUpTo: no migration tagged "${lastTag}"`);
  const wanted = journal.entries.slice(0, cut + 1);

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client);
    for (let i = 0; i < wanted.length; i += 1) {
      await writeFile(journalPath, JSON.stringify({ ...journal, entries: wanted.slice(0, i + 1) }, null, 2));
      await migrate(db, { migrationsFolder: folder });
    }
  } finally {
    await client.end();
  }
}

/**
 * Drops and recreates `dbName` through the admin connection's database. FORCE
 * terminates any leftover session from a previous run so the drop cannot hang.
 */
export async function recreateDatabase(adminUrl: string, dbName: string): Promise<void> {
  const client = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}
