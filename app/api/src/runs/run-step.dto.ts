import { type RunStepRow } from './runs.service';

/** One engine sub-call of a run, as shown in the asset breakdown panel and the run detail. */
export interface RunStepDto {
  seq: number; kind: string; engine: string; model: string;
  prompt: string; output: string | null;
  tokensInput: number | null; tokensCacheWrite: number | null; tokensCacheRead: number | null;
  tokensOutput: number | null; imagesGenerated: number | null;
  /** Recorded at call time from the registry row. */
  costUsd: number | null;
  failureKind: RunStepRow['failureKind'];
  startedAt: string; finishedAt: string;
}

export function toRunStepDto(row: RunStepRow): RunStepDto {
  return {
    seq: row.seq, kind: row.kind, engine: row.engine, model: row.model,
    prompt: row.prompt, output: row.output,
    tokensInput: row.tokensInput, tokensCacheWrite: row.tokensCacheWrite, tokensCacheRead: row.tokensCacheRead,
    tokensOutput: row.tokensOutput, imagesGenerated: row.imagesGenerated, costUsd: row.costUsd,
    failureKind: row.failureKind,
    startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt.toISOString(),
  };
}
