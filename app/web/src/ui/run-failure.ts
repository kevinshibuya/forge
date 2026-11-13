import type { RunDto } from '../api/client';

export interface FailureMessage { label: string; tone: 'ink' | 'salmon'; lines: string[] }

/** The first three non-empty lines of a run's raw output, for the operator to see what came back. */
const head = (output: string | null): string[] =>
  (output ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);

const stripErrorPrefix = (error: string | null): string => (error ?? '').replace(/^Error:\s*/, '');

/**
 * What a failed run says where the operator is. A decline is the engine honouring the contract,
 * so it reads in the ink tone with the reason and then the question. An invalid_output is a
 * broken contract, a bug to file, so it says so and quotes the raw output. Everything else quotes
 * the error and the raw output.
 */
export function failureMessage(run: Pick<RunDto, 'failureKind' | 'error' | 'output' | 'declined'>): FailureMessage {
  const label = (run.failureKind ?? 'failed').replace('_', ' ');
  if (run.failureKind === 'declined') {
    const reason = run.declined?.reason ?? stripErrorPrefix(run.error);
    const question = run.declined?.question;
    return { label, tone: 'ink', lines: question ? [reason, question] : [reason] };
  }
  if (run.failureKind === 'invalid_output') {
    return { label, tone: 'salmon', lines: ['the engine broke its contract', ...head(run.output)] };
  }
  return { label, tone: 'salmon', lines: [stripErrorPrefix(run.error), ...head(run.output)].filter(Boolean) };
}

/** The newest run among `kinds`, by startedAt desc then id desc, the same order RunsService uses.
 *  Null when no run of those kinds exists. */
export function newestRunOfKinds(runs: RunDto[], kinds: string[]): RunDto | null {
  let newest: RunDto | null = null;
  for (const run of runs) {
    if (!kinds.includes(run.kind)) continue;
    if (newest === null) { newest = run; continue; }
    const byStart = run.startedAt.localeCompare(newest.startedAt);
    if (byStart > 0 || (byStart === 0 && run.id > newest.id)) newest = run;
  }
  return newest;
}
