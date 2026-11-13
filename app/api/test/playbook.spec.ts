import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { PlaybookModule } from '../src/playbook/playbook.module';
import { PlaybookService } from '../src/playbook/playbook.service';
import { playbookRules } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('PlaybookService', () => {
  let svc: PlaybookService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, PlaybookModule] }).compile();
    svc = mod.get(PlaybookService);
    await createDb(url).delete(playbookRules);
  });

  it('adds, lists by status, retires exactly once', async () => {
    const a = await svc.addRule({ category: 'voice', rule: 'numbers as anchors', provenance: 'seed' });
    await svc.addRule({ category: 'timing', rule: 'publish 9:00-10:00' });
    expect(a.status).toBe('active');
    expect(a.provenance).toBe('seed');

    const retired = await svc.retireRule(a.id);
    expect(retired.status).toBe('retired');
    expect(retired.retiredAt).not.toBeNull();
    await expect(svc.retireRule(a.id)).rejects.toThrow();

    expect((await svc.listRules({ status: ['active'] }))).toHaveLength(1);
    expect((await svc.activeRules())[0]!.provenance).toBe('manual');
  });

  it('activeRulesAt reconstructs history from created/retired timestamps', async () => {
    const rules = await svc.listRules();
    const retiredRule = rules.find((r) => r.status === 'retired')!;
    // A point strictly between createdAt and retiredAt — not an arbitrary fixed
    // offset, since create+retire happen back-to-back in this test (sub-second gap).
    const beforeRetirement = new Date(
      (retiredRule.createdAt.getTime() + retiredRule.retiredAt!.getTime()) / 2,
    );
    const then = await svc.activeRulesAt(beforeRetirement);
    expect(then.some((r) => r.id === retiredRule.id)).toBe(true);
    const now = await svc.activeRulesAt(new Date());
    expect(now.some((r) => r.id === retiredRule.id)).toBe(false);
  });
});
