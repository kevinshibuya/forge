import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}
export type ForgeDb = ReturnType<typeof createDb>;
export const DB = Symbol('DB');
