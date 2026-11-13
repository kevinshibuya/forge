import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../env';

// Resolved relative to process cwd — this module must be invoked with cwd = app/api
// (true for both `vitest run` and `npm run db:migrate -w @forge/api`).
const MIGRATIONS_FOLDER = 'src/db/migrations';

export async function migrateDb(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  await client.end();
}

const invokedDirectly = process.argv[1]?.endsWith('migrate.ts');
if (invokedDirectly) {
  loadEnv(); // honor a custom DATABASE_URL from app/api/.env when run as a script
  const url = process.env.DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge';
  migrateDb(url).then(() => console.log('migrated')).catch((err: unknown) => {
    console.error('migration failed:', err);
    process.exitCode = 1;
  });
}
