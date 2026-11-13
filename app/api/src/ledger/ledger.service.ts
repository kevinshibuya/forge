import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EngineBackend, EngineName, EngineUsage, FailureKind } from '@forge/shared';
import { asc, eq } from 'drizzle-orm';
import { DB, ForgeDb } from '../db/client';
import { ledger } from '../db/schema';

export type LedgerCategory = 'text' | 'image';
export type LedgerExit = 'succeeded' | FailureKind;

/** One model call, one attempt, as the runner reports it. */
export interface LedgerInsert {
  runId: number;
  stepSeq?: number;
  attempt: number;
  backend: EngineBackend;
  engine: EngineName;
  model: string;
  category: LedgerCategory;
  exit: LedgerExit;
  usage: EngineUsage;
  costUsd: number | null;
  providerRequestId?: string;
}

export interface LedgerRow {
  id: number;
  runId: number | null;
  stepSeq: number | null;
  attempt: number;
  backend: EngineBackend;
  engine: EngineName;
  model: string;
  category: LedgerCategory;
  exit: LedgerExit;
  tokensInput: number | null;
  tokensCacheWrite: number | null;
  tokensCacheRead: number | null;
  tokensOutput: number | null;
  images: number | null;
  costUsd: number | null;
  providerRequestId: string | null;
  createdAt: Date;
}

/** The ledger (ADR 0026): the accounting record of every model call. */
@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name);

  constructor(@Inject(DB) private readonly db: ForgeDb) {}

  /** Fail-open: a bookkeeping write never fails the run it describes. */
  async record(row: LedgerInsert): Promise<void> {
    try {
      await this.db.insert(ledger).values({
        runId: row.runId,
        stepSeq: row.stepSeq ?? null,
        attempt: row.attempt,
        backend: row.backend,
        engine: row.engine,
        model: row.model,
        category: row.category,
        exit: row.exit,
        tokensInput: row.usage.inputTokens ?? null,
        tokensCacheWrite: row.usage.cacheWriteTokens ?? null,
        tokensCacheRead: row.usage.cacheReadTokens ?? null,
        tokensOutput: row.usage.outputTokens ?? null,
        images: row.usage.images ?? null,
        costUsd: row.costUsd === null ? null : String(row.costUsd),
        providerRequestId: row.providerRequestId ?? null,
      });
    } catch (err) {
      this.log.error(`ledger write failed for run ${row.runId} attempt ${row.attempt}: ${(err as Error).message}`);
    }
  }

  async forRun(runId: number): Promise<LedgerRow[]> {
    const rows = await this.db.select().from(ledger).where(eq(ledger.runId, runId)).orderBy(asc(ledger.id));
    return rows.map((r) => ({
      ...r,
      backend: r.backend as EngineBackend,
      engine: r.engine as EngineName,
      category: r.category as LedgerCategory,
      exit: r.exit as LedgerExit,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
    }));
  }
}
