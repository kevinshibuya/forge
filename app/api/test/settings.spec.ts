import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { DEFAULT_SETTINGS } from '@forge/shared';
import { migrateDb } from '../src/db/migrate';
import { createDb, ForgeDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { SettingsService } from '../src/settings/settings.service';
import { settings } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('SettingsService', () => {
  let service: SettingsService;
  let db: ForgeDb;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule] }).compile();
    service = mod.get(SettingsService);
    db = createDb(url);
    // forge_test is shared across spec files (fileParallelism serializes files, it does not isolate
    // state) and three of them write scheduling.weeklyGoal. Drop the row so 'seeds defaults on first
    // read' actually tests seeding, instead of whatever the previously-run file left behind.
    await db.delete(settings).where(eq(settings.id, 1));
  });

  it('seeds defaults on first read', async () => {
    const s = await service.get();
    expect(s.scheduling.weeklyGoal).toBe(null);
    expect(s.retrievalK).toBe(5);
  });

  it('validates and persists updates', async () => {
    const s = await service.update({ retrievalK: 8 });
    expect(s.retrievalK).toBe(8);
    await expect(service.update({ retrievalK: 999 } )).rejects.toThrow();
    expect((await service.get()).retrievalK).toBe(8);
  });

  it('fills missing top-level keys from defaults (forward-compat)', async () => {
    const { retrievalK: _omit, ...partial } = DEFAULT_SETTINGS;
    await db.update(settings).set({ data: partial }).where(eq(settings.id, 1));
    const s = await service.get();
    expect(s.retrievalK).toBe(DEFAULT_SETTINGS.retrievalK);
    // Reset the shared row back to defaults for other serial specs.
    await db.update(settings).set({ data: DEFAULT_SETTINGS }).where(eq(settings.id, 1));
  });
});
