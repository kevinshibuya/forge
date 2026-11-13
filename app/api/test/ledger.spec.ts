import { beforeAll, describe, expect, it } from 'vitest';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { ledger, runs } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { LedgerService } from '../src/ledger/ledger.service';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('LedgerService', () => {
  const db = createDb(url);
  const svc = new LedgerService(db);
  let runId: number;

  beforeAll(async () => {
    await migrateDb(url);
    const [run] = await db.insert(runs).values({ engine: 'claude', kind: 'draft', model: 'claude-sonnet-5', prompt: 'ledger' }).returning();
    runId = run!.id;
  });

  it('records one row per attempt and reads them back in order, with numbers', async () => {
    const base = { runId, backend: 'api', engine: 'anthropic', model: 'claude-sonnet-5', category: 'text' } as const;
    await svc.record({ ...base, attempt: 1, exit: 'quota', usage: {}, costUsd: null });
    await svc.record({
      ...base, attempt: 2, exit: 'succeeded', providerRequestId: 'req_1',
      usage: { inputTokens: 10_000, cacheReadTokens: 40_000, outputTokens: 1_000 }, costUsd: 0.038,
    });
    const rows = await svc.forRun(runId);
    expect(rows.map((r) => [r.attempt, r.exit, r.costUsd])).toEqual([[1, 'quota', null], [2, 'succeeded', 0.038]]);
    expect(rows[1]).toMatchObject({ tokensInput: 10_000, tokensCacheWrite: null, tokensCacheRead: 40_000, tokensOutput: 1_000, providerRequestId: 'req_1' });
  });

  it('swallows a failed write instead of throwing into the run', async () => {
    await expect(svc.record({
      runId: 2_000_000_000, attempt: 1, backend: 'cli', engine: 'claude', model: 'm', category: 'text',
      exit: 'succeeded', usage: {}, costUsd: null,
    })).resolves.toBeUndefined();
    expect(await db.select().from(ledger).where(eq(ledger.runId, 2_000_000_000))).toHaveLength(0);
  });
});
