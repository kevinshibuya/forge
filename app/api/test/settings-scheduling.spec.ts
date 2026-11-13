import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb, type ForgeDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { SettingsService } from '../src/settings/settings.service';
import { settings } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('settings.scheduling', () => {
  let service: SettingsService;
  let db: ForgeDb;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule] }).compile();
    service = mod.get(SettingsService);
    db = createDb(url);
    await db.delete(settings).where(eq(settings.id, 1)); // fresh defaults per run
  });

  it('defaults: São Paulo, no goal', async () => {
    const s = await service.get();
    expect(s.scheduling.timezone).toBe('America/Sao_Paulo');
    expect(s.scheduling.weeklyGoal).toBeNull();
  });

  it('lifts a stored cadence timezone into scheduling, once, persistently', async () => {
    await db.update(settings).set({
      data: { cadence: { postsPerWeek: 3, weekdays: ['mon'], publishWindow: '10:30-11:30', timezone: 'America/Bahia' } },
    }).where(eq(settings.id, 1));
    const s = await service.get();
    expect(s.scheduling.timezone).toBe('America/Bahia');
    const [raw] = await db.select().from(settings).where(eq(settings.id, 1));
    expect((raw!.data as { scheduling?: { timezone?: string } }).scheduling?.timezone).toBe('America/Bahia');
  });

  it('rejects invalid zones and out-of-range goals', async () => {
    await expect(service.update({ scheduling: { timezone: 'Not/AZone', weeklyGoal: null } })).rejects.toThrow();
    await expect(service.update({ scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: 0 } })).rejects.toThrow();
    await expect(service.update({ scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: 8 } })).rejects.toThrow();
    const ok = await service.update({ scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: 3 } });
    expect(ok.scheduling.weeklyGoal).toBe(3);
    const back = await service.update({ scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: null } });
    expect(back.scheduling.weeklyGoal).toBeNull();
  });
});
