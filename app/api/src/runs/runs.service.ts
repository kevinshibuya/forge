import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Decline, EngineName, FailureKind, RunKind, RunStatus, RunTell } from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { runSteps, runs } from '../db/schema';

/** A run as the services and the http layer see it: `costUsd` is a number, never drizzle's
 *  numeric string. */
export type RunRow = Omit<typeof runs.$inferSelect, 'costUsd'> & { costUsd: number | null };
/** One persisted engine sub-call of a managed run, with its cost as a number. */
export type RunStepRow = Omit<typeof runSteps.$inferSelect, 'costUsd'> & { costUsd: number | null };

const toCost = (v: string | null): number | null => (v === null ? null : Number(v));
const toRunRow = (r: typeof runs.$inferSelect): RunRow => ({ ...r, costUsd: toCost(r.costUsd) });
/** Exported for the one reader that selects steps itself (the asset breakdown). */
export const toStepRow = (r: typeof runSteps.$inferSelect): RunStepRow => ({ ...r, costUsd: toCost(r.costUsd) });

/** The usage columns a run and a step share. Omitted fields stay NULL ("not recorded"). */
export interface UsageColumns {
  tokensInput?: number; tokensCacheWrite?: number; tokensCacheRead?: number; tokensOutput?: number;
  imagesGenerated?: number; costUsd?: number;
}

/** Only the fields actually passed, with the cost as the numeric column's string. */
function usagePatch(u: UsageColumns) {
  return {
    ...(u.tokensInput !== undefined ? { tokensInput: u.tokensInput } : {}),
    ...(u.tokensCacheWrite !== undefined ? { tokensCacheWrite: u.tokensCacheWrite } : {}),
    ...(u.tokensCacheRead !== undefined ? { tokensCacheRead: u.tokensCacheRead } : {}),
    ...(u.tokensOutput !== undefined ? { tokensOutput: u.tokensOutput } : {}),
    ...(u.imagesGenerated !== undefined ? { imagesGenerated: u.imagesGenerated } : {}),
    ...(u.costUsd !== undefined ? { costUsd: String(u.costUsd) } : {}),
  };
}

export class IllegalRunTransition extends Error {
  constructor(id: number) { super(`IllegalRunTransition: run ${id} is not running`); }
}

@Injectable()
export class RunsService {
  constructor(@Inject(DB) private readonly db: ForgeDb) {}

  async start(input: {
    engine: EngineName; kind: RunKind; model: string; prompt: string; postId?: number;
  }): Promise<number> {
    const [row] = await this.db.insert(runs).values(input).returning({ id: runs.id });
    return row!.id;
  }

  /** `tells` undefined means the run was never linted; the column stays NULL. */
  async succeed(id: number, output: string, parsedOk: boolean, tells?: RunTell[]): Promise<void> {
    const updated = await this.db.update(runs)
      .set({ status: 'succeeded', output, parsedOk, tells: tells ?? null, finishedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.status, 'running')))
      .returning({ id: runs.id });
    if (updated.length === 0) throw new IllegalRunTransition(id);
  }

  /** A decline is a failure that honoured the contract: the envelope is kept, its tells are
   *  linted like a payload's, and `parsedOk` is true. Every other failure leaves `parsedOk` as is. */
  async fail(id: number, failure: {
    kind: FailureKind; error: string; output?: string; declined?: Decline; tells?: RunTell[];
  }): Promise<void> {
    const status = failure.kind === 'timeout' ? 'timeout' as const : 'failed' as const;
    const updated = await this.db.update(runs)
      .set({
        status, failureKind: failure.kind, error: failure.error,
        output: failure.output, finishedAt: new Date(),
        declined: failure.declined ?? null, tells: failure.tells ?? null,
        ...(failure.declined !== undefined ? { parsedOk: true } : {}),
      })
      .where(and(eq(runs.id, id), eq(runs.status, 'running')))
      .returning({ id: runs.id });
    if (updated.length === 0) throw new IllegalRunTransition(id);
  }

  /** Persist one engine sub-call of a managed run. Omitted usage fields stay NULL ("not recorded"). */
  async addStep(input: UsageColumns & {
    runId: number; seq: number; kind: string; engine: EngineName; model: string;
    prompt: string; output?: string; failureKind?: FailureKind; startedAt: Date; finishedAt: Date;
  }): Promise<void> {
    const { tokensInput, tokensCacheWrite, tokensCacheRead, tokensOutput, imagesGenerated, costUsd, ...step } = input;
    await this.db.insert(runSteps).values({
      ...step, ...usagePatch({ tokensInput, tokensCacheWrite, tokensCacheRead, tokensOutput, imagesGenerated, costUsd }),
    });
  }

  async stepsFor(runId: number): Promise<RunStepRow[]> {
    const rows = await this.db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.seq));
    return rows.map(toStepRow);
  }

  /**
   * Patch usage counters onto a run row. Only the fields actually passed are written, so
   * independent contributors (engine tokens vs ingested image count) never clobber each other,
   * and an all-undefined call is a no-op leaving the columns NULL ("not recorded").
   * Deliberately NOT status-guarded: usage is bookkeeping, not a lifecycle transition.
   */
  async recordUsage(id: number, u: UsageColumns): Promise<void> {
    const patch = usagePatch(u);
    if (Object.keys(patch).length === 0) return;
    await this.db.update(runs).set(patch).where(eq(runs.id, id));
  }

  /** A missing run is a 404 here, like `PostsService.get`, so no caller classifies the error by
   *  its message. Callers used to match on the suffix or catch everything, which turned a
   *  connection error into "the operator asked for something that is not there". A caller that
   *  owes another status narrows on `NotFoundException`. */
  async get(id: number): Promise<RunRow> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id));
    if (!row) throw new NotFoundException(`run ${id} not found`);
    return toRunRow(row);
  }

  async latestForPost(postId: number, kind: RunKind): Promise<RunRow | null> {
    const [row] = await this.db.select().from(runs)
      .where(and(eq(runs.postId, postId), eq(runs.kind, kind)))
      .orderBy(desc(runs.startedAt))
      .limit(1);
    return row ? toRunRow(row) : null;
  }

  async list(filter: { kind?: RunKind; status?: RunStatus; postId?: number; limit?: number } = {}): Promise<RunRow[]> {
    const conds = [
      filter.kind !== undefined ? eq(runs.kind, filter.kind) : undefined,
      filter.status !== undefined ? eq(runs.status, filter.status) : undefined,
      filter.postId !== undefined ? eq(runs.postId, filter.postId) : undefined,
    ].filter((c) => c !== undefined);
    const rows = await this.db.select().from(runs)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(runs.startedAt))
      .limit(Math.min(filter.limit ?? 50, 200));
    return rows.map(toRunRow);
  }
}
