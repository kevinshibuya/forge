import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type RunDto } from '../api/client';
import { useRunStream } from '../api/hooks';
import { Button, Pill, Spinner } from './primitives';
import { RunWatcherContext, type RunWatcherValue } from './run-watcher';
import { failureMessage } from './run-failure';

const TIGHT_MS = 2_000;   // while runs are live or one was just launched
const IDLE_MS = 10_000;   // relaxed background poll
const LAUNCH_GRACE_MS = 15_000;
const FLASH_MS = 4_000;

export function RunWatcherProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [lastLaunchAt, setLastLaunchAt] = useState(0);
  const [failures, setFailures] = useState<RunDto[]>([]);
  const [flash, setFlash] = useState<RunDto | null>(null);
  // Launches announced via notifyLaunched but not yet seen in the running list.
  // State (not a ref) so isPostBusy consumers re-render the moment a launch registers.
  const [pending, setPending] = useState<ReadonlyMap<number, number | null>>(new Map());
  const watchedIds = useRef<Set<number>>(new Set());
  const probing = useRef<Set<number>>(new Set()); // row-fetch dedupe: one in-flight probe per run

  const running = useQuery({
    queryKey: ['runs', 'running'],
    queryFn: () => api.get<RunDto[]>('/runs?status=running'),
    refetchInterval: (query) => {
      const live = (query.state.data?.length ?? 0) > 0;
      const justLaunched = Date.now() - lastLaunchAt < LAUNCH_GRACE_MS;
      return live || justLaunched ? TIGHT_MS : IDLE_MS;
    },
  });
  const runningRuns = useMemo(() => running.data ?? [], [running.data]);

  const finalize = useCallback((run: RunDto) => {
    void qc.invalidateQueries({ queryKey: ['runs'] });
    void qc.invalidateQueries({ queryKey: ['posts'] });
    if (run.postId !== null) {
      void qc.invalidateQueries({ queryKey: ['post', run.postId] });
      void qc.invalidateQueries({ queryKey: ['images', run.postId] });
    }
    if (run.status === 'succeeded') {
      setFlash(run);
      setTimeout(() => setFlash((f) => (f?.id === run.id ? null : f)), FLASH_MS);
    } else {
      setFailures((prev) => (prev.some((f) => f.id === run.id) ? prev : [...prev, run]));
    }
  }, [qc]);

  /** Probe one run row for terminal truth; onStillRunning decides what "still running" means per caller. */
  const probeRun = useCallback((id: number, onStillRunning: () => void, onTerminal: (run: RunDto) => void) => {
    if (probing.current.has(id)) return;
    probing.current.add(id);
    void api.get<RunDto>(`/runs/${id}`)
      .then((run) => { if (run.status === 'running') onStillRunning(); else onTerminal(run); })
      .finally(() => { probing.current.delete(id); });
  }, []);

  // Keyed on dataUpdatedAt, NOT running.data: TanStack's structural sharing keeps the array
  // referentially identical across polls with equal content ([] → [] especially), which would
  // suppress a data-keyed effect — a fast run could then finish without ever being finalized.
  // dataUpdatedAt changes on every poll settle, so pending/watched ids are always re-examined.
  useEffect(() => {
    if (running.data === undefined) return;
    const current = new Set(running.data.map((r) => r.id));

    // Pending launches: promote once visible in the list; until then, row-fetch for terminal
    // truth (the run-row is the source of completion truth — a sub-poll-interval run never
    // appears in the running list at all).
    for (const [id] of pending) {
      if (current.has(id)) {
        watchedIds.current.add(id);
        setPending((prev) => { const next = new Map(prev); next.delete(id); return next; });
      } else {
        probeRun(id,
          () => { /* launched but not yet visible — stays pending, post stays busy */ },
          (run) => {
            setPending((prev) => { const next = new Map(prev); next.delete(id); return next; });
            finalize(run);
          });
      }
    }

    // Watched runs that vanished from the list: confirm terminal via the row before reporting.
    const finished = [...watchedIds.current].filter((id) => !current.has(id));
    watchedIds.current = current;
    for (const id of finished) {
      probeRun(id,
        () => { watchedIds.current.add(id); }, // stale poll — keep watching
        (run) => { finalize(run); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on dataUpdatedAt by design (see comment)
  }, [running.dataUpdatedAt, pending, probeRun, finalize]);

  const notifyLaunched = useCallback((runId: number, postId: number | null) => {
    setLastLaunchAt(Date.now());
    setPending((prev) => { const next = new Map(prev); next.set(runId, postId); return next; });
    void qc.invalidateQueries({ queryKey: ['runs', 'running'] });
  }, [qc]);

  const isPostBusy = useCallback(
    (postId: number) =>
      runningRuns.some((r) => r.postId === postId)
      || [...pending.values()].includes(postId),
    [runningRuns, pending],
  );

  const value: RunWatcherValue = useMemo(
    () => ({ notifyLaunched, runningRuns, isPostBusy }),
    [notifyLaunched, runningRuns, isPostBusy],
  );

  return (
    <RunWatcherContext.Provider value={value}>
      {children}
      <FloatingRunConsole runningRuns={runningRuns} failures={failures} flash={flash}
        onDismissFailure={(id) => setFailures((prev) => prev.filter((f) => f.id !== id))} />
    </RunWatcherContext.Provider>
  );
}

function RunStreamBlock({ run }: { run: RunDto }) {
  const { lines } = useRunStream(run.id);
  const preRef = useRef<HTMLPreElement | null>(null);
  // Terminal-style follow: stick to the bottom as output streams in, unless the
  // user has scrolled up to read something — then leave their position alone.
  const stickRef = useRef(true);
  useEffect(() => {
    const el = preRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    // Dark in BOTH themes: `bg-hero` + the phase-3 dark-surface scope (§2); inside it
    // --ink is the light constant, so the log chrome reads `text-ink`.
    <div data-surface="dark" className="rounded-card bg-hero p-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-ink">
        <span className="flex items-center gap-2">{run.kind.replace('_', ' ')} <Spinner /> · run #{run.id}</span>
        {run.postId !== null && (
          <Link to={`/posts/${run.postId}`} className="text-ink hover:text-salmon">post #{run.postId} →</Link>
        )}
      </div>
      <pre ref={preRef}
        onScroll={() => {
          const el = preRef.current;
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink">
        {lines.join('') || 'waiting for the engine…'}
      </pre>
    </div>
  );
}

/** One failed run in the console. Exported for its spec; the provider renders it. */
export function FailureCard({ run, onDismiss }: { run: RunDto; onDismiss: () => void }) {
  const f = failureMessage(run);
  const declined = run.failureKind === 'declined';
  const border = f.tone === 'ink' ? 'border-ink' : 'border-salmon';
  const pill = f.tone === 'ink' ? 'border-ink text-ink' : 'border-salmon text-salmon';
  return (
    <div className={`rounded-card border ${border} bg-paper px-3 py-2 text-[12px] text-soft`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 lowercase">
          <Pill className={pill}>{f.label}</Pill>
          <span className="font-semibold">{run.kind.replace('_', ' ')} · run #{run.id}</span>
        </span>
        <Button variant="subtle" onClick={onDismiss}>dismiss</Button>
      </div>
      {f.lines.map((line, i) => (
        // The second line of a decline is the question: the one line the operator can act on.
        <p key={i} className={`mt-1 ${declined && i === 1 ? 'text-ink' : ''}`}>{line}</p>
      ))}
      <div className="mt-1 flex gap-3">
        {/* hover, so it reads as a link rather than ink-colored dead text (same treatment as the
            live block's post link above). */}
        {run.postId !== null && (
          <Link className="text-ink hover:text-salmon" to={`/posts/${run.postId}`}>open post #{run.postId} →</Link>
        )}
        <Link className="text-ink hover:text-salmon" to={`/runs?run=${run.id}`}>open run →</Link>
      </div>
    </div>
  );
}

function FloatingRunConsole({ runningRuns, failures, flash, onDismissFailure }: {
  runningRuns: RunDto[]; failures: RunDto[]; flash: RunDto | null; onDismissFailure: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = runningRuns.length;
  if (count === 0 && failures.length === 0 && flash === null) return null;

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-hairline bg-ink px-4 py-2 text-[12px] font-semibold lowercase text-bone">
        {count > 0 ? (
          <>
            <Spinner />
            {runningRuns[0]!.kind.replace('_', ' ')} · run #{runningRuns[0]!.id}
            {count > 1 && <span className="rounded-full bg-bone px-1.5 text-[10px] tabular-nums text-ink">{count}</span>}
          </>
        ) : failures.length > 0 ? (
          <><span className="size-2 rounded-full bg-salmon" />{failures.length} run{failures.length > 1 ? 's' : ''} failed</>
        ) : (
          <><span className="size-2 rounded-full bg-mint" />{flash!.kind.replace('_', ' ')} finished ✓</>
        )}
      </button>
    );
  }

  return (
    <section className="fixed bottom-5 right-5 z-50 flex w-[420px] max-w-[calc(100vw-2.5rem)] flex-col gap-2 rounded-card border border-hairline bg-paper p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">run console</span>
        <Button variant="subtle" onClick={() => setExpanded(false)}>collapse</Button>
      </div>
      {runningRuns.map((r) => <RunStreamBlock key={r.id} run={r} />)}
      {runningRuns.length === 0 && failures.length === 0 && (
        <p className="rounded-card border border-dashed border-hairline-soft px-3 py-2 text-[13px] lowercase text-soft">
          nothing running.
        </p>
      )}
      {failures.map((f) => <FailureCard key={f.id} run={f} onDismiss={() => onDismissFailure(f.id)} />)}
    </section>
  );
}
