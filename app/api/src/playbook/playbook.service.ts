import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import type { RuleCategory, RuleStatus } from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { playbookRules } from '../db/schema';

export type RuleRow = typeof playbookRules.$inferSelect;

@Injectable()
export class PlaybookService {
  constructor(@Inject(DB) private readonly db: ForgeDb) {}

  async listRules(filter: { status?: RuleStatus[] } = {}): Promise<RuleRow[]> {
    return this.db.select().from(playbookRules)
      .where(filter.status && filter.status.length > 0 ? inArray(playbookRules.status, filter.status) : undefined)
      .orderBy(asc(playbookRules.category), asc(playbookRules.createdAt));
  }

  async getRule(id: number): Promise<RuleRow> {
    const [row] = await this.db.select().from(playbookRules).where(eq(playbookRules.id, id));
    if (!row) throw new NotFoundException(`playbook rule ${id} not found`);
    return row;
  }

  async addRule(input: { category: RuleCategory; rule: string; rationale?: string; provenance?: string }): Promise<RuleRow> {
    const [row] = await this.db.insert(playbookRules).values({
      category: input.category, rule: input.rule,
      rationale: input.rationale, provenance: input.provenance ?? 'manual',
    }).returning();
    return row!;
  }

  async retireRule(id: number): Promise<RuleRow> {
    const [row] = await this.db.update(playbookRules)
      .set({ status: 'retired', retiredAt: new Date() })
      .where(and(eq(playbookRules.id, id), eq(playbookRules.status, 'active')))
      .returning();
    if (!row) {
      await this.getRule(id);
      throw new ConflictException(`rule ${id} is already retired`);
    }
    return row;
  }

  async activeRules(): Promise<RuleRow[]> {
    return this.listRules({ status: ['active'] });
  }

  async activeRulesAt(t: Date): Promise<RuleRow[]> {
    return this.db.select().from(playbookRules)
      .where(and(
        lte(playbookRules.createdAt, t),
        or(isNull(playbookRules.retiredAt), gt(playbookRules.retiredAt, t)),
      ))
      .orderBy(asc(playbookRules.category), asc(playbookRules.createdAt));
  }
}
