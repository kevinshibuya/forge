import postgres from 'postgres';

export function testDb() {
  const url = process.env.TEST_DATABASE_URL
    ?? 'postgres://forge:forge@localhost:5433/forge_test';
  return postgres(url, { max: 2, onnotice: () => {} });
}
