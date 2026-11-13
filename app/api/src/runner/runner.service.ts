import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ZodType, ZodTypeAny } from 'zod';
import {
  costUsd, enforcedJsonSchema, renderPrompt, taskForKind, unwrapResult,
  type Decline, type EngineBackend, type EngineName, type EngineUsage, type FailureKind, type PostTier,
  type RunKind, type RunTell, type Settings, type SystemBlock,
} from '@forge/shared';
import {
  ENGINE_BACKEND, ENGINES, type Engine, type EngineEvent, type EngineRequest, type EngineResult,
} from '../engines/engine.interface';
import { extractJson } from '@forge/shared';
import { API_ENGINE_KEYS } from '../engines/api/keys';
import { LedgerService, type LedgerCategory, type LedgerExit } from '../ledger/ledger.service';
import { ModelRegistryService, type ModelRow } from '../registry/model-registry.service';
import { RunsService, type RunStepRow, type UsageColumns } from '../runs/runs.service';
import { SettingsService } from '../settings/settings.service';
import { RunEventsHub } from './run-events.hub';
import { collectTells } from './tell-fields';

// Defined in @forge/shared so the web parses model output the same way. Re-exported
// because five call sites and runner.spec.ts already import it from here.
export { extractJson };

export type ExecuteResult<T> =
  | { runId: number; ok: true; data: T }
  /** `declined` is set only for `failureKind: 'declined'`, so a launcher can carry the envelope on. */
  | { runId: number; ok: false; failureKind: FailureKind; error: string; rawOutput: string; declined?: Decline };

/** Thrown before any run row exists: the registry has no row for the task on this backend, or the
 *  row names an engine this process did not install. */
export class RunRefused extends ConflictException {}

/** The fields of a decline that hold prose, linted like a payload's. */
const DECLINE_TELL_FIELDS = ['reason', 'question'];

/** The longest a recorded retry waits, whatever the provider's retry-after says. */
const MAX_RETRY_WAIT_MS = 30_000;

/** One engine sub-call of a managed run. The registry row for its kind (and tier) picks the
 *  engine and the model. */
export interface ManagedCallRequest {
  system: SystemBlock[]; user: string;
  images?: string[]; cwd?: string;
  /** The kind's zod schema; when set the engine enforces the output contract for this call. */
  schema?: ZodTypeAny;
  tier?: PostTier;
}

const categoryFor = (kind: RunKind): LedgerCategory => (kind === 'image_gen' || kind === 'image_refine' ? 'image' : 'text');

/** The run and step columns for one call's usage and cost. */
const usageColumns = (u: EngineUsage, cost: number | null): UsageColumns => ({
  tokensInput: u.inputTokens, tokensCacheWrite: u.cacheWriteTokens, tokensCacheRead: u.cacheReadTokens,
  tokensOutput: u.outputTokens, imagesGenerated: u.images, costUsd: cost ?? undefined,
});

@Injectable()
export class RunnerService {
  private readonly log = new Logger(RunnerService.name);

  constructor(
    @Inject(ENGINES) private readonly engines: Partial<Record<EngineName, Engine>>,
    @Inject(ENGINE_BACKEND) private readonly backend: EngineBackend,
    private readonly runs: RunsService,
    private readonly settings: SettingsService,
    private readonly events: RunEventsHub,
    private readonly registry: ModelRegistryService,
    private readonly ledger: LedgerService,
  ) {}

  async execute<T = string>(input: {
    kind: RunKind; tier?: PostTier; postId?: number;
    system: SystemBlock[]; user: string;
    images?: string[]; cwd?: string;
    schema?: ZodType<T>;
    /** Field paths of the parsed output that hold prose, linted for style tells. */
    tellFields?: string[];
    onStart?: (runId: number) => void;
    /** Post-processing (render/ingest/score) run BEFORE the run is marked succeeded and the stream
     *  closes. Throw to fail the run. May report what the call produced beyond tokens (the raster
     *  lane's image count). */
    finalize?: (data: T) => Promise<void | { images?: number }>;
  }): Promise<ExecuteResult<T>> {
    const settings = await this.settings.get();
    const { row, engine } = await this.resolve(input.kind, input.tier);
    const { system, user } = input;
    const runId = await this.runs.start({
      engine: row.engine, kind: input.kind, model: row.model, prompt: renderPrompt({ system, user }), postId: input.postId,
    });
    input.onStart?.(runId);
    // Open the event stream immediately so a client subscribing between run creation
    // and the first engine event still receives the full replay.
    this.events.open(runId);

    // One ledger row and one usage write per final attempt, before the run row goes terminal: the
    // SSE `complete` after the terminal write makes the web refetch, and the refetch must see the
    // cost. The flag keeps the outer catch from writing a second row.
    const attempt = { n: 1 };
    let settled = false;
    const settle = async (exit: LedgerExit, result?: EngineResult, extra: EngineUsage = {}) => {
      if (settled) return;
      settled = true;
      const usage = { ...(result?.usage ?? {}), ...extra };
      const cost = costUsd(usage, row.prices);
      await this.ledger.record({
        runId, attempt: attempt.n, backend: this.backend, engine: row.engine, model: row.model,
        category: categoryFor(input.kind), exit, usage, costUsd: cost,
        ...(result?.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
      });
      await this.recordUsageSafe(runId, usageColumns(usage, cost));
    };

    // Complete the stream ONLY after the run row reaches a terminal state (succeed/fail).
    // The UI treats stream-close as "refetch now"; closing before persistence would let a
    // fast refetch read a still-running run with no further event to recover from.
    try {
     try {
      const result = await this.attempts(runId, row, engine, {
        kind: input.kind, model: row.model, effort: row.effort, maxOutputTokens: row.maxOutputTokens,
        system, user, images: input.images, cwd: input.cwd, timeoutMs: settings.runTimeoutMs,
        // The output contract: the engine enforces the kind's shape, or the decline envelope.
        ...(input.schema ? { outputSchema: enforcedJsonSchema(input.schema) } : {}),
      }, attempt);

      // The call completed and declined: usage and tells are recorded like a payload's, the envelope
      // is kept, and the run is failed as declined. No finalize.
      const declineRun = async (decline: Decline): Promise<ExecuteResult<T>> => {
        await settle('declined', result);
        const tells = this.lintSafe(runId, decline, DECLINE_TELL_FIELDS);
        await this.runs.fail(runId, {
          kind: 'declined', error: decline.reason, output: result.output, declined: decline, tells,
        });
        return { runId, ok: false, failureKind: 'declined', error: decline.reason, rawOutput: result.output, declined: decline };
      };

      // A provider refusal (C2, C3) arrives as `declined` with the envelope the api engine built. It is
      // a decline like an in-schema one, schema or not; a `declined` without an envelope fails as
      // declined with its reason, below.
      const refusal = result.failureKind === 'declined' && result.structured !== undefined
        ? unwrapResult(result.structured) : undefined;
      if (refusal?.kind === 'declined') return await declineRun(refusal.decline);

      if (result.failureKind) {
        await settle(result.failureKind, result);
        await this.runs.fail(runId, {
          kind: result.failureKind, error: result.errorDetail ?? 'engine failure', output: result.output,
        });
        return { runId, ok: false, failureKind: result.failureKind, error: result.errorDetail ?? 'engine failure', rawOutput: result.output };
      }

      let data: T;
      // The stored output: the bare payload for a schema-bearing run (never the engine's wrapper,
      // so every reader of run.output keeps parsing a payload), the raw output otherwise.
      let stored = result.output;
      if (input.schema) {
        // A schema was requested, so the engine's structured result is REQUIRED. There is no
        // fallback to parsing the prose: a success line without one means the contract was not
        // honoured (observed on 2.1.261 when the model was talked out of the schema). The call
        // itself completed, so its ledger row says succeeded.
        const invalid = async (error: string): Promise<ExecuteResult<T>> => {
          await settle('succeeded', result);
          await this.runs.fail(runId, { kind: 'invalid_output', error, output: result.output });
          return { runId, ok: false, failureKind: 'invalid_output', error, rawOutput: result.output };
        };
        if (result.structured === undefined) return await invalid('engine returned no structured result');
        const unwrapped = unwrapResult(result.structured);
        if (unwrapped.kind === 'malformed') return await invalid(unwrapped.reason);
        if (unwrapped.kind === 'declined') return await declineRun(unwrapped.decline);
        // A zod failure here is still a broken contract: a refinement the JSON Schema cannot carry.
        try { data = input.schema.parse(unwrapped.value); }
        catch (err) { return await invalid(String(err)); }
        stored = JSON.stringify(data);
      } else {
        data = result.output as unknown as T;
      }

      // Render/ingest/score BEFORE the run is marked succeeded and the stream closes, so an
      // SSE `done` means "candidates ready" and a finalize failure marks the run failed, not
      // falsely succeeded. The ledger row waits for finalize, which may report images.
      let produced: EngineUsage = {};
      if (input.finalize) {
        try {
          const report = await input.finalize(data);
          if (report && report.images !== undefined) produced = { images: report.images };
        } catch (err) {
          await settle('succeeded', result);
          await this.runs.fail(runId, { kind: 'other', error: String(err), output: result.output });
          return { runId, ok: false, failureKind: 'other', error: String(err), rawOutput: result.output };
        }
      }

      await settle('succeeded', result, produced);
      await this.runs.succeed(runId, stored, true, this.lintSafe(runId, data, input.tellFields));
      return { runId, ok: true, data };
     } catch (err) {
      // Defensive outer-catch for UNEXPECTED throws only — engine.run() rejecting, an event callback
      // throwing, or runs.succeed()/fail() itself throwing. Without this, control would jump straight
      // to `finally` (SSE complete) leaving the run row non-terminal, so the client sees "done" on a
      // stuck-running run. Best-effort mark it failed BEFORE complete; swallow a secondary
      // IllegalRunTransition if an expected path already made the row terminal.
      try { await settle('other'); } catch { /* the ledger write is fail-open already */ }
      try { await this.runs.fail(runId, { kind: 'other', error: String(err) }); }
      catch { /* row already terminal */ }
      return { runId, ok: false, failureKind: 'other', error: String(err), rawOutput: '' };
     }
    } finally {
      this.events.complete(runId);
    }
  }

  /**
   * A managed run lifecycle for orchestrations that make MORE THAN ONE engine call under a
   * single run row (e.g. the hybrid lane: plan -> background -> text -> composite). Unlike
   * `execute`, which is single-call-only, `run` receives a `call(...)` primitive it invokes
   * as many times as needed. `call` does NOT auto-throw on `failureKind` — the body inspects
   * the result and decides. Throwing from `run` fails the one run; a thrown error's
   * `.failureKind` becomes the run's failure kind (else `'other'`). The event stream opens
   * before the body runs and closes only after the run row is terminal.
   */
  async executeManaged(input: {
    kind: RunKind; prompt: string; postId?: number;
    onStart?: (runId: number) => void;
    run: (ctx: {
      runId: number; settings: Settings;
      /** `schema` asks the engine to enforce the kind's shape; the body reads `structured` back
       *  through `unwrapResult` and decides. `call` itself never parses. */
      call: (kind: RunKind, req: ManagedCallRequest) => Promise<EngineResult>;
      /** Managed runs lint their own parsed payloads: `call` returns raw output, not parsed data. */
      addTells: (tells: RunTell[]) => void;
    }) => Promise<string>; // resolved value stored as the run's final output
  }): Promise<{ runId: number; ok: boolean }> {
    const settings = await this.settings.get();
    // The run's own row decides its engine and model columns, and refuses the launch before any
    // step runs when the backend has no row for the kind.
    const { row: runRow } = await this.resolve(input.kind);
    const runId = await this.runs.start({
      engine: runRow.engine, kind: input.kind, model: runRow.model, prompt: input.prompt, postId: input.postId,
    });
    input.onStart?.(runId);
    this.events.open(runId);
    try {
      // seq is claimed BEFORE the engine call and never reused, so a step that fails to persist
      // leaves a gap rather than shifting every later step's number.
      let seq = 0;
      // Whether addTells was CALLED, not whether it found anything: a managed run that never
      // lints must record NULL, while one that lints and comes back clean records []. Every
      // managed caller other than the hybrid lane lints nothing today.
      let linted = false;
      const collected: RunTell[] = [];
      const addTells = (tells: RunTell[]) => { linted = true; collected.push(...tells); };
      const call = async (kind: RunKind, req: ManagedCallRequest): Promise<EngineResult> => {
        const { row, engine } = await this.resolve(kind, req.tier);
        const mySeq = ++seq;
        const { system, user } = req;
        const prompt = renderPrompt({ system, user });
        const startedAt = new Date();
        const attempt = { n: 1 };
        const step = { runId, seq: mySeq, kind, engine: row.engine, model: row.model, prompt };
        const record = (exit: LedgerExit, usage: EngineUsage, cost: number | null, providerRequestId?: string) =>
          this.ledger.record({
            runId, stepSeq: mySeq, attempt: attempt.n, backend: this.backend, engine: row.engine, model: row.model,
            category: categoryFor(kind), exit, usage, costUsd: cost, ...(providerRequestId ? { providerRequestId } : {}),
          });
        let result: EngineResult;
        try {
          result = await this.attempts(runId, row, engine, {
            kind, model: row.model, effort: row.effort, maxOutputTokens: row.maxOutputTokens,
            system, user, images: req.images, cwd: req.cwd, timeoutMs: settings.runTimeoutMs,
            ...(req.schema ? { outputSchema: enforcedJsonSchema(req.schema) } : {}),
          }, attempt, mySeq);
        } catch (err) {
          // An engine that THROWS (rather than returning a failureKind) still happened: record the
          // attempt, then let the original error propagate to the body untouched.
          await record('other', {}, null);
          await this.addStepSafe({ ...step, failureKind: 'other', startedAt, finishedAt: new Date() });
          throw err;
        }
        // Image-generating sub-calls produce exactly one image per successful call (the hybrid
        // background contract); a failed call produced none, which stays unset, not 0.
        const usage: EngineUsage = {
          ...(result.usage ?? {}),
          ...(categoryFor(kind) === 'image' && !result.failureKind ? { images: 1 } : {}),
        };
        const cost = costUsd(usage, row.prices);
        await record(result.failureKind ?? 'succeeded', usage, cost, result.providerRequestId);
        await this.addStepSafe({
          ...step, output: result.output, ...usageColumns(usage, cost),
          failureKind: result.failureKind, startedAt, finishedAt: new Date(),
        });
        return result;
      };
      const output = await input.run({ runId, settings, call, addTells });
      await this.rollUpStepUsage(runId);
      await this.runs.succeed(runId, output, true, linted ? collected : undefined);
      return { runId, ok: true };
    } catch (err) {
      // A failed managed run still consumed whatever its completed sub-calls consumed.
      await this.rollUpStepUsage(runId);
      const { failureKind, declined } = err as { failureKind?: FailureKind; declined?: Decline };
      await this.runs.fail(runId, {
        kind: failureKind ?? 'other', error: err instanceof Error ? err.message : String(err),
        ...(declined !== undefined ? { declined } : {}),
      });
      return { runId, ok: false };
    } finally {
      this.events.complete(runId);
    }
  }

  /** The registry row for the kind (and tier) on this process's backend, and its installed engine. */
  private async resolve(kind: RunKind, tier?: PostTier): Promise<{ row: ModelRow; engine: Engine }> {
    const task = taskForKind(kind, tier);
    const row = await this.registry.resolve(task, this.backend);
    if (!row) throw new RunRefused(`no model_registry row for task ${task} on backend ${this.backend}`);
    const engine = this.engines[row.engine];
    if (!engine) {
      const key = this.backend === 'api' ? API_ENGINE_KEYS[row.engine] : undefined;
      throw new RunRefused(`engine ${row.engine} is not installed in this process (backend ${this.backend})${key ? `: ${key} is not set` : ''}`);
    }
    return { row, engine };
  }

  /**
   * The attempt loop every engine call goes through (narrowing 6). An engine reports a retryable
   * condition (a 429 with retry-after, a 529 or 503); the runner records attempt 1 on its own ledger
   * row, waits, and calls once more. Attempt 2's result is final whatever it says. `attempt.n` is
   * the caller's to read, so the row it writes for the final attempt carries the right number.
   */
  private async attempts(
    runId: number, row: ModelRow, engine: Engine, req: EngineRequest, attempt: { n: number }, stepSeq?: number,
  ): Promise<EngineResult> {
    const emit = (e: EngineEvent) => this.events.emit(runId, e);
    const first = await engine.run(req, emit);
    if (!first.retryable) return first;
    const usage = first.usage ?? {};
    await this.ledger.record({
      runId, ...(stepSeq !== undefined ? { stepSeq } : {}), attempt: 1, backend: this.backend, engine: row.engine,
      model: row.model, category: categoryFor(req.kind), exit: first.failureKind ?? 'other', usage,
      costUsd: costUsd(usage, row.prices), ...(first.providerRequestId ? { providerRequestId: first.providerRequestId } : {}),
    });
    await new Promise((r) => setTimeout(r, Math.min(first.retryable!.afterMs, MAX_RETRY_WAIT_MS)));
    attempt.n = 2;
    return engine.run(req, emit);
  }

  /** Linting is fail-open: a bad pattern must never fail a run that produced good output.
   *  Undefined (never linted) leaves the column NULL; an empty array records "linted, clean". */
  private lintSafe(runId: number, data: unknown, fields?: string[]): RunTell[] | undefined {
    if (!fields || fields.length === 0) return undefined;
    try { return collectTells(data, fields); }
    catch (err) {
      this.log.warn(`run ${runId}: tell lint failed, storing no tells: ${String(err)}`);
      return undefined;
    }
  }

  /** Step persistence is fail-open: losing a bookkeeping row must never fail the run it describes. */
  private async addStepSafe(step: Parameters<RunsService['addStep']>[0]): Promise<void> {
    try { await this.runs.addStep(step); }
    catch (err) { this.log.warn(`run ${step.runId}: failed to record step ${step.seq} (${step.kind}): ${String(err)}`); }
  }

  private async recordUsageSafe(runId: number, u: UsageColumns): Promise<void> {
    try { await this.runs.recordUsage(runId, u); }
    catch (err) { this.log.warn(`run ${runId}: failed to record usage: ${String(err)}`); }
  }

  /**
   * Fold the managed run's recorded steps into the run row's totals. Null-safe: a counter no step
   * reported stays undefined and is not written, so "not recorded" never renders as a real zero.
   */
  private async rollUpStepUsage(runId: number): Promise<void> {
    let steps: RunStepRow[];
    try { steps = await this.runs.stepsFor(runId); }
    catch (err) { this.log.warn(`run ${runId}: failed to read steps for usage roll-up: ${String(err)}`); return; }
    const total = (pick: (s: RunStepRow) => number | null): number | undefined => {
      let acc: number | undefined;
      for (const s of steps) { const v = pick(s); if (v !== null) acc = (acc ?? 0) + v; }
      return acc;
    };
    await this.recordUsageSafe(runId, {
      tokensInput: total((s) => s.tokensInput),
      tokensCacheWrite: total((s) => s.tokensCacheWrite),
      tokensCacheRead: total((s) => s.tokensCacheRead),
      tokensOutput: total((s) => s.tokensOutput),
      imagesGenerated: total((s) => s.imagesGenerated),
      costUsd: total((s) => s.costUsd),
    });
  }
}
