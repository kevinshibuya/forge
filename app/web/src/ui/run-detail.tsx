import { DraftOutputSchema, RefineSelectionOutputSchema, extractJson, type Source } from '@forge/shared';
import type { RunDetailDto, RunStepDto } from '../api/client';
import { useRunDetail } from '../api/hooks';
import { durationS, elideDataUris, fmtDateTime, fmtNum, fmtUsd } from '../lib/format';
import { RUN_DOT } from '../lib/run-status';
import { Overlay } from './lightbox';
import { ErrorNote, Pill, Spinner } from './primitives';

const NOT_RECORDED = 'not recorded';

/**
 * The Sources the run itself returned, as opposed to the ones the post now owns: after this
 * change the workspace shows the post's list, so a run's would otherwise be visible nowhere.
 * Read-only, and silent whenever the output does not yield one.
 */
function runSources(run: RunDetailDto): Source[] {
  if (!run.output || run.status !== 'succeeded') return [];
  const schema = run.kind === 'draft' ? DraftOutputSchema
    : run.kind === 'refine_selection' ? RefineSelectionOutputSchema
      : null;
  if (!schema) return [];
  try { return schema.parse(extractJson(run.output)).sources ?? []; } catch { return []; }
}


/**
 * Kinds whose engine work fans out into sub-calls (`runner.executeManaged` on the api side).
 * Every other kind is a single call and records no steps by design — so an empty `steps` means
 * something different for each group, and only these get the "not recorded" reading.
 */
const MANAGED_KINDS = new Set(['image_hybrid', 'image_refine']);

/**
 * Claude reports input and output tokens separately; codex reports ONE total, which the runner
 * stores in `tokensOutput`. Rendering that as "0 in / N out" would be a fabrication, so a codex
 * row shows the single number it actually has. Null both ways → the caller says "not recorded".
 *
 * `splitIsHonest` is how a managed run opts out: its row totals are summed across steps, so a
 * hybrid mixing claude and codex has a codex grand total folded into `tokensOutput`. Presenting
 * that as an output count would fabricate a split the data never had.
 *
 * Once the provider reports cache fields, the read count shows as `cached` between input and
 * output, and a cache write shows only when there was one.
 *
 * The total is every token the run's steps reported: input, cache write, cache read and output.
 */
function tokenSummary(
  u: {
    engine: string; tokensInput: number | null; tokensOutput: number | null;
    tokensCacheWrite: number | null; tokensCacheRead: number | null;
  },
  splitIsHonest = true,
): string | null {
  if (u.tokensInput === null && u.tokensOutput === null) return null;
  if (u.engine === 'codex' || !splitIsHonest) {
    const total = (u.tokensInput ?? 0) + (u.tokensCacheWrite ?? 0) + (u.tokensCacheRead ?? 0) + (u.tokensOutput ?? 0);
    return `${fmtNum(total)} total`;
  }
  if (u.tokensCacheWrite === null && u.tokensCacheRead === null) {
    return `${fmtNum(u.tokensInput ?? 0)} in / ${fmtNum(u.tokensOutput ?? 0)} out`;
  }
  return [
    `${fmtNum(u.tokensInput ?? 0)} in`,
    `${fmtNum(u.tokensCacheRead ?? 0)} cached`,
    ...(u.tokensCacheWrite ? [`+${fmtNum(u.tokensCacheWrite)} cache write`] : []),
    `${fmtNum(u.tokensOutput ?? 0)} out`,
  ].join(' · ');
}

/** Prompt/output pane, collapsed by default and elided — a hybrid background would otherwise
 *  drop megabytes of base64 into the DOM. */
function Collapsible({ label, text }: { label: string; text: string | null }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.15em] lowercase text-soft hover:text-ink">
        {label}
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-card border border-hairline bg-bone p-2 font-mono text-[11px] leading-relaxed text-soft">
        {text ? elideDataUris(text) : '(none)'}
      </pre>
    </details>
  );
}

/** One engine sub-call. Shared with the image breakdown panel, which lists the same rows. */
export function StepRow({ step }: { step: RunStepDto }) {
  const tokens = tokenSummary(step);
  const usage = [
    tokens,
    step.imagesGenerated !== null ? `${fmtNum(step.imagesGenerated)} img` : null,
    step.costUsd !== null ? fmtUsd(step.costUsd) : null,
  ].filter((part): part is string => part !== null);
  return (
    <li className="rounded-card border border-hairline bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] tabular-nums text-soft">{step.seq}</span>
        <Pill className="bg-bone">{step.kind.replace('_', ' ')}</Pill>
        <span className="text-[12px] lowercase text-soft">{step.engine} · {step.model}</span>
        <span className="ml-auto text-[12px] tabular-nums text-soft">{durationS(step.startedAt, step.finishedAt)}</span>
      </div>
      <div className="mt-1 text-[11px] lowercase text-soft">
        {usage.length > 0 ? usage.join(' · ') : 'tokens not recorded'}
        {step.failureKind && <span className="ml-2 text-salmon">· failed: {step.failureKind}</span>}
      </div>
      <Collapsible label="prompt" text={step.prompt} />
      <Collapsible label="output" text={step.output} />
    </li>
  );
}

/** The measurement outranks its label, so a real value inks. `null` is "nothing was measured" and
 *  stays recessed — absence must never carry more weight on the page than a figure. */
const Metric = ({ label, value }: { label: string; value: string | null }) => (
  <span className="text-[12px] lowercase text-soft">
    {label} · <span className={`tabular-nums ${value === null ? 'text-soft' : 'text-ink'}`}>{value ?? NOT_RECORDED}</span>
  </span>
);

/**
 * Everything one run recorded: its shape, what it spent, its sub-calls, and its own prompt/output.
 * Rendered bare — the runs log wraps it in a row expansion, the workspace in a modal.
 *
 * Nothing here is derived from anything but the response: cost, tokens and steps that were never
 * recorded say so, because a fabricated zero is indistinguishable from a measured one.
 */
export function RunDetail({ run }: { run: RunDetailDto }) {
  const managed = MANAGED_KINDS.has(run.kind);
  const cited = runSources(run);
  // A managed run's totals are summed across steps that may span engines — see `tokenSummary`.
  const tokens = tokenSummary(run, !managed || run.steps.every((s) => s.engine === run.engine));

  /**
   * An empty `steps` on a managed run means one of three things, and only one of them is
   * "the run is old". Steps persist AFTER each sub-call returns, so a run still working on its
   * first one has none yet, and a run that failed before reaching one never will.
   */
  const stepless = managed && run.steps.length === 0
    ? run.status === 'running' ? 'pending' : run.status === 'succeeded' ? 'legacy' : 'aborted'
    : null;
  const stepsValue = run.steps.length > 0 ? String(run.steps.length)
    : stepless === 'legacy' ? null : '0';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill className="bg-bone">
          <span className={`size-1.5 rounded-full ${RUN_DOT[run.status] ?? 'bg-soft'}`} />
          {run.status}{run.failureKind && ` · ${run.failureKind}`}
        </Pill>
        {/* Titled wrapper rather than a title prop, the way the tells metric below does it: Pill is
            shared chrome and widening it for one caller is the wrong trade. */}
        {run.research && (
          <span title="this run could read the staged harness snapshot and search the web">
            <Pill className="bg-bone">research</Pill>
          </span>
        )}
        {run.stagedInputs !== null && run.stagedInputs.length > 0 && (
          <span title={`this run could read ${run.stagedInputs.length} attached inputs`}>
            <Pill className="bg-bone">inputs · {run.stagedInputs.length}</Pill>
          </span>
        )}
        <span className="text-[12px] lowercase text-soft">
          {run.kind.replace('_', ' ')} · {run.engine} · {run.model}
        </span>
        <span className="ml-auto text-[12px] tabular-nums text-soft">{durationS(run.startedAt, run.finishedAt)}</span>
        <span className="text-[12px] tabular-nums text-soft">{fmtDateTime(run.startedAt)}</span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <Metric label="tokens" value={tokens} />
        <Metric label="cost" value={run.costUsd !== null ? fmtUsd(run.costUsd) : null} />
        {/* Only managed kinds fan out into sub-calls, so `steps · 0` is a fact about them and noise
            about the other nine kinds — the steps section below already draws that same line. */}
        {(managed || run.steps.length > 0) && <Metric label="steps" value={stepsValue} />}
        {run.imagesGenerated !== null && <Metric label="images" value={fmtNum(run.imagesGenerated)} />}
        {/* Omitted when null (never linted) or empty (linted clean): a "0 tells" badge would read
            as a score on a run whose text nobody checked. The hits themselves live in the title. */}
        {run.tells !== null && run.tells.length > 0 && (
          <span title={run.tells.map((t) => `${t.field}: ${t.label}`).join('\n')}>
            <Metric label="tells" value={String(run.tells.length)} />
          </span>
        )}
      </div>

      {run.error && (
        <ErrorNote label="error">{run.error}</ErrorNote>
      )}

      {(run.steps.length > 0 || managed) && (
        <div>
          <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">steps</div>
          {run.steps.length > 0
            ? <ul className="mt-1.5 flex flex-col gap-2">{run.steps.map((s) => <StepRow key={s.seq} step={s} />)}</ul>
            : <p className="mt-1.5 rounded-card border border-dashed border-hairline-soft px-3 py-2 text-[13px] lowercase text-soft">
                {stepless === 'pending' ? 'no sub-calls finished yet — the first one is still running.'
                  : stepless === 'aborted' ? 'no sub-calls recorded — this run ended before the first one finished.'
                  : 'steps not recorded — this run predates step recording.'}
              </p>}
        </div>
      )}

      {run.toolCalls !== null && run.toolCalls.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">tool calls</div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {run.toolCalls.map((call, i) => (
              <li key={`${call.tool}-${i}`}
                className="flex flex-wrap items-baseline gap-x-1.5 rounded-card border border-hairline bg-paper px-3 py-1.5"
                title={call.outsideRoot ? 'read outside the staged root' : undefined}>
                <span className="text-[12px] lowercase text-soft">{call.tool}</span>
                <span className="text-line">·</span>
                {/* The ref stays in ink: salmon is a ~2.3:1 accent, unreadable as body copy, so the
                    warning below carries the hue and the path stays legible. */}
                <span className="font-mono text-[11px] break-all text-ink">{call.ref}</span>
                {!call.ok && <span className="text-[11px] lowercase text-soft">· denied</span>}
                {/* The two cases read very differently and must not look alike. `outsideRoot` with
                    ok:false is the fence DOING ITS JOB; with ok:true it is a read that escaped and
                    succeeded, which is the row that should shout. */}
                {call.outsideRoot && (
                  <span className="text-[11px] font-semibold lowercase text-salmon">
                    {call.ok ? '· escaped the staged root' : '· outside root, blocked'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.stagedManifest !== null && run.stagedManifest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.15em] lowercase text-soft hover:text-ink">
            staged files · {run.stagedManifest.length}
          </summary>
          {/* Kept after the directory is deleted: this is the per-run answer to what the model
              could see, and it has to outlive the snapshot to be worth anything. */}
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {run.stagedManifest.map((entry) => (
              <li key={entry.path} className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-soft">
                <span className="break-all">{entry.path}</span>
                <span className="shrink-0 tabular-nums">{fmtNum(entry.bytes)} b</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {run.stagedInputs !== null && run.stagedInputs.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.15em] lowercase text-soft hover:text-ink">
            staged inputs · {run.stagedInputs.length}
          </summary>
          {/* One block per input, so the page tells the harness snapshot and what the operator
              attached apart rather than merging them into one list. */}
          <div className="mt-1.5 flex flex-col gap-2">
            {run.stagedInputs.map((input) => (
              <div key={input.inputId}>
                <div className="flex items-baseline gap-2">
                  <Pill>{input.kind}</Pill>
                  <span className="min-w-0 break-all font-mono text-[11px] text-ink">{input.ref}</span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                  {input.files.map((file) => (
                    <li key={file.path} className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-soft">
                      <span className="break-all">{file.path}</span>
                      <span className="shrink-0 tabular-nums">{fmtNum(file.bytes)} b</span>
                    </li>
                  ))}
                  {input.skipped > 0 && (
                    <li className="text-[11px] lowercase text-soft">skipped {input.skipped}</li>
                  )}
                  {input.refused.map((entry) => (
                    <li key={entry} className="break-all font-mono text-[11px] text-salmon">{entry}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {cited.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">
            sources · {cited.length}
          </div>
          <ul className="flex flex-col gap-0.5">
            {cited.map((source, i) => (
              <li key={`${source.ref}-${i}`} className="text-[13px] text-soft">
                <span className="lowercase">{source.kind}</span>
                <span className="mx-1.5 text-line">·</span>
                <span className="font-mono text-[11px] break-all">{source.ref}</span>
                {source.note && (
                  <>
                    <span className="mx-1.5 text-line">·</span>
                    {source.note}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">prompt</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-card border border-hairline bg-paper p-3 font-mono text-[11px] leading-relaxed text-soft">{elideDataUris(run.prompt)}</pre>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">
            output {run.parsedOk === false && '· failed to parse'}
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-card border border-hairline bg-paper p-3 font-mono text-[11px] leading-relaxed text-soft">{run.output ? elideDataUris(run.output) : '(none)'}</pre>
        </div>
      </div>
    </div>
  );
}

/** The same detail over the app's overlay — how the workspace history tab opens a run row. */
export function RunDetailModal({ runId, onClose }: { runId: number; onClose: () => void }) {
  const run = useRunDetail(runId);
  return (
    <Overlay onClose={onClose}
      className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-y-auto rounded-card border border-hairline bg-paper p-4">
      <div className="mb-3 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">run #{runId}</div>
      {run.isLoading && <Spinner />}
      {run.isError && (
        <ErrorNote label={`could not load run #${runId}`}>{run.error.message}</ErrorNote>
      )}
      {run.data && <RunDetail run={run.data} />}
    </Overlay>
  );
}
