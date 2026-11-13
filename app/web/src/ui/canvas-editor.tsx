import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { fetchPatchedBg, useBgPatch, useCanvasEdit, useEditableHtml, useRun } from '../api/hooks';
import type { AssetDto } from '../api/client';
import {
  EDITOR_COMMAND, EDITOR_EVENT, injectRuntime,
  type EditorCommand, type EditorEvent, type LayerDir, type SelectionStyle, type StylePatch, type TextAlign,
} from './canvas-editor-runtime';
import { Button, ErrorNote, Field, Spinner, inputCls } from './primitives';
import { useRunWatcher } from './run-watcher';

/** The renderer's fixed canvas — the iframe is always laid out at this size and scaled to fit. */
const CANVAS_PX = 1200;
const FONT_STEP = 2;
const FONT_MIN = 6;
const FONT_MAX = 400;
const RADIUS_MAX = 400;
const WEIGHTS = [400, 500, 600, 700, 800];
const ALIGNS: TextAlign[] = ['left', 'center', 'right'];
/** Arrows are the stack, not the canvas: ↑ is "one step towards the viewer". */
const LAYERS: { dir: LayerDir; label: string; title: string }[] = [
  { dir: 'back', label: '⤓', title: 'send to back' },
  { dir: 'backward', label: '↓', title: 'send backward' },
  { dir: 'forward', label: '↑', title: 'bring forward' },
  { dir: 'front', label: '⤒', title: 'bring to front' },
];

/**
 * Disabled here matters more than anywhere else in the app: with nothing selected MOST of this
 * toolbar is dead, and `opacity-40` inside the dark scope left the labels at ≈2:1. Same rule as
 * `Button` (§4 check 4) — the control drops back to the editor's own ground with a soft hairline
 * and a `soft` label, which stays ≥7:1 against `--hero`.
 */
const TOOL_DISABLED = 'disabled:cursor-not-allowed disabled:border-hairline-soft disabled:bg-bone disabled:text-soft';
const toolCls = `rounded-card border border-hairline bg-paper px-2 py-1 text-[12px] text-ink ${TOOL_DISABLED}`;

function isEditorEvent(data: unknown): data is EditorEvent {
  if (typeof data !== 'object' || data === null) return false;
  return (data as { forge?: unknown }).forge === EDITOR_EVENT;
}

function ToolButton({ active = false, ...props }: { active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-card border px-2.5 py-1 text-[12px] lowercase transition-colors ${TOOL_DISABLED} ${
        active ? 'border-ink bg-paper text-ink' : 'border-hairline bg-paper text-soft hover:text-ink'}`}
    />
  );
}

/**
 * Background refine, from inside the edit session.
 *
 * The instruction is the whole input — the source background is attached server-side, and a
 * base64 data URI must never reach a prompt. The run produces a BACKGROUND, not a candidate: on
 * success its bytes are handed to the runtime, which swaps them under the live text layer and logs
 * one undo entry. Nothing lands until the editor saves, so a patch the user rejects costs a run and
 * nothing else.
 *
 * The canvas stays fully editable while the run is in flight (a minute of waiting that no edit
 * depends on), and closing the editor mid-run is allowed — the run finishes server-side and its
 * background is simply never fetched (spec §4e's accepted orphan).
 */
function RefinePanel({ asset, hidden, onPatched }: {
  asset: AssetDto; hidden: boolean; onPatched: (toUri: string, runId: number) => void;
}) {
  const { notifyLaunched } = useRunWatcher();
  const [instruction, setInstruction] = useState('');
  /** The run being followed. Non-null means exactly one patch is in flight. */
  const [runId, setRunId] = useState<number | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const launch = useBgPatch(asset.id);
  const run = useRun(runId, { pollWhileRunning: true });
  /** Runs already resolved one way or the other — the effect below re-fires on every poll tick. */
  const settled = useRef<Set<number>>(new Set());
  const field = useRef<HTMLTextAreaElement | null>(null);

  // Opening the panel puts the caret straight in it, so the toggle is one click to typing.
  // (`autoFocus` cannot do this: the panel is hidden when collapsed, not unmounted.)
  useEffect(() => { if (!hidden) field.current?.focus(); }, [hidden]);

  const runRow = run.data ?? null;
  const followError = run.isError ? run.error.message : null;
  useEffect(() => {
    if (runId === null || settled.current.has(runId)) return;
    if (followError !== null) {
      settled.current.add(runId);
      setRunId(null);
      setError(`could not follow the refine run: ${followError}`);
      return;
    }
    if (runRow === null || runRow.id !== runId || runRow.status === 'running') return;
    settled.current.add(runId);
    if (runRow.status !== 'succeeded') {
      setRunId(null);
      setError(`the refine ${runRow.status}: ${runRow.error ?? runRow.failureKind ?? 'no reason recorded'}`);
      return;
    }
    // Exactly one read per succeeded run, guarded above. Deliberately NOT cancelled on re-render:
    // a cleanup that dropped this promise would lose the only copy of the background.
    fetchPatchedBg(runId).then(
      (res) => { onPatched(res.bgDataUri, runId); setLanded(runId); setRunId(null); },
      (e: unknown) => {
        setRunId(null);
        // A 404 after a succeeded run means the file is gone or was never written — the refine is a
        // failure from here, whatever the run row says.
        setError(`background could not be read back${e instanceof Error && e.message !== '' ? `: ${e.message}` : ''}`);
      },
    );
  }, [runId, runRow, followError, onPatched]);

  const pending = launch.isPending || runId !== null;
  const submit = () => {
    setError(null);
    launch.reset();
    launch.mutate(instruction.trim(), {
      // Same as every other launch: the run console follows it, so progress is visible even from
      // behind the editor's overlay.
      onSuccess: (res) => { notifyLaunched(res.runId, asset.postId); setRunId(res.runId); },
    });
  };

  return (
    // Hidden rather than unmounted: collapsing the panel must not abandon a run in flight, nor
    // throw away a half-typed instruction.
    // `bg-paper`, matching the toolbar strip above it: inside the dark scope `bg-bone` IS the
    // editor's ground, so a bone panel had no figure/ground of its own (§4 check 2).
    <div className={hidden ? 'hidden' : 'mb-2 rounded-card border border-hairline bg-paper px-3 py-2'}>
      <Field label="what should change in the background?">
        <textarea ref={field} className={`${inputCls} min-h-16`} value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. remove the stray artifact top-left, calm the texture behind the headline" />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button disabled={instruction.trim() === '' || pending} onClick={submit}>
          {launch.isPending ? 'launching…' : runId !== null ? 'refining…' : 'refine background'}
        </Button>
        <span className="text-[11px] lowercase text-soft">
          {runId !== null
            ? `run #${runId} is patching the background — keep editing, it lands on the canvas when it is done`
            : landed !== null
              ? `run #${landed}'s background is on the canvas — ⌘Z reverts it, and saving commits it`
              : 'the text layer is untouched; the patched background joins this edit and saves as one candidate'}
        </span>
      </div>
      {launch.isError && <div className="mt-2"><ErrorNote label="refine failed">{launch.error.message}</ErrorNote></div>}
      {error !== null && <div className="mt-2"><ErrorNote label="error">{error}</ErrorNote></div>}
    </div>
  );
}

/**
 * Direct-manipulation editor for a hybrid candidate's text layer.
 *
 * The candidate's html is loaded with its background ALREADY inlined as a data URI (the server
 * hands the exact URI back alongside), rendered in a sandboxed iframe with an injected runtime
 * that owns every gesture. On save the iframe serializes itself, this side reverses the background
 * substitution back to `__HYBRID_BG__`, and the POST lands a new candidate synchronously — no run,
 * so there is nothing for the run watcher to observe and the images query is invalidated directly.
 *
 * Background refines happen HERE too (there is no standalone flow any more), and they contribute to
 * that same save: the runtime holds whichever background is applied, reports it back with the html,
 * and the reversal + the `bgRunId` on the payload both come from that one report.
 */
export function CanvasEditor({ asset, onClose }: { asset: AssetDto; onClose: () => void }) {
  const editable = useEditableHtml(asset.id);
  const save = useCanvasEdit(asset.id);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<SelectionStyle | null>(null);
  /** Mirrors the runtime's stacks — the only thing the undo/redo buttons' disabled state reads. */
  const [history, setHistory] = useState({ undoDepth: 0, redoDepth: 0 });
  /** Pin-all has run. Until it has, the runtime ignores add/layer, so the buttons stay dead too. */
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.5);
  /** The refine panel is a toggle on this toolbar — the editor is the only way in to a patch. */
  const [refineOpen, setRefineOpen] = useState(false);
  /** Set between "save" and the iframe answering with its html — the POST hasn't started yet. */
  const [serializing, setSerializing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const srcDoc = useMemo(
    () => (editable.data ? injectRuntime(editable.data.html) : null),
    [editable.data],
  );

  const send = useCallback((cmd: EditorCommand) => {
    iframeRef.current?.contentWindow?.postMessage(cmd, '*');
  }, []);

  // Hand the runtime its background identity on `load` rather than in reply to `ready`: `load` is
  // guaranteed to fire after this component's message-listener effect has registered, whereas
  // answering `ready` races that registration, and a lost init breaks the save reversal silently.
  const bgDataUri = editable.data?.bgDataUri;
  const initRuntime = useCallback(() => {
    // A fresh document means a fresh operation log; the runtime only reports depths once it pushes.
    setHistory({ undoDepth: 0, redoDepth: 0 });
    setSelection(null);
    setReady(false);
    if (bgDataUri === undefined) return;
    send({ forge: EDITOR_COMMAND, type: 'init', bgDataUri });
  }, [bgDataUri, send]);

  const busy = serializing || save.isPending;
  // Only an in-flight POST blocks the exit: serializing is local and abandoning it costs nothing,
  // and if the runtime ever failed to answer, a cancel gated on it would trap the user.
  const close = useCallback(() => { if (!save.isPending) onClose(); }, [save.isPending, onClose]);

  // Scale to fit whatever the stage measures — the iframe stays laid out at 1200×1200 so the
  // document renders at its true size, and only the visual box shrinks.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      setScale(Math.min(1, Math.max(0.1, Math.min(r.width, r.height) / CANVAS_PX)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // `mutate` is stable across renders; depending on the whole mutation object would resubscribe
  // the listener on every pending/error transition.
  const saveMutate = save.mutate;
  useEffect(() => {
    const onMessage = (e: MessageEvent<unknown>) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!isEditorEvent(e.data)) return;
      const msg = e.data;
      if (msg.type === 'ready') { setReady(true); return; }
      if (msg.type === 'selection') { setSelection(msg.style); return; }
      if (msg.type === 'history') { setHistory({ undoDepth: msg.undoDepth, redoDepth: msg.redoDepth }); return; }
      if (msg.type === 'escape') { close(); return; }
      if (msg.type !== 'html') return;
      setSerializing(false);
      // Reverse EXACTLY what the server substituted — using the URI the RUNTIME reports as applied,
      // never this side's memory of what it loaded. The api refuses a payload that still carries the
      // inlined background (its 422 message is shown verbatim below), so this is the one step that
      // must not drift.
      if (msg.bgDataUri === '') { setLocalError('the background reference was lost — reopen the editor'); return; }
      // `bgRunId` rides along from the same report: a refine that was undone comes back `null` here
      // and the hook then omits the field, so the save is a plain canvas edit over the source.
      saveMutate(
        { html: msg.html.split(msg.bgDataUri).join('__HYBRID_BG__'), bgRunId: msg.bgRunId },
        { onSuccess: () => onClose() },
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [close, onClose, saveMutate]);

  // Escape anywhere outside the iframe cancels; inside it the runtime forwards an `escape` event
  // (unless it is committing a text edit, which owns the key first). Cmd/Ctrl+Z is handled on
  // whichever side has focus — keydown does not cross the iframe boundary, so exactly one fires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const focused = document.activeElement;
      const inField = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
      if (e.key === 'Escape') {
        // From inside a field Escape means "leave the field", never "close the editor": losing a
        // half-typed refine instruction to a reflexive Escape is the trap. A second one closes.
        if (inField) { focused.blur(); return; }
        close();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || (e.key !== 'z' && e.key !== 'Z')) return;
      // In this side's own fields Cmd+Z means "undo my typing"; stealing it for the canvas would be
      // hostile, and the refine panel's instruction textarea is exactly where that would hurt.
      if (inField) return;
      if (focused instanceof HTMLElement && focused.isContentEditable) return;
      e.preventDefault();
      send({ forge: EDITOR_COMMAND, type: e.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, send]);

  // The runtime owns the background end to end: it is told what to swap TO, works out what to swap
  // FROM, and reports both back at serialize time. Stable, because the refine panel's effect depends
  // on it and must not re-fire on every poll tick.
  const applyPatchedBg = useCallback((toUri: string, runId: number) => {
    send({ forge: EDITOR_COMMAND, type: 'background', toUri, runId });
  }, [send]);

  const patch = (p: StylePatch) => send({ forge: EDITOR_COMMAND, type: 'style', patch: p });
  const stepFont = (delta: number) => {
    if (selection === null) return;
    patch({ fontSizePx: Math.min(FONT_MAX, Math.max(FONT_MIN, selection.fontSizePx + delta)) });
  };
  const startSave = () => {
    setLocalError(null);
    save.reset();
    setSerializing(true);
    send({ forge: EDITOR_COMMAND, type: 'serialize' });
  };

  const error = localError ?? (editable.isError ? `could not open the editor: ${editable.error.message}` : null)
    ?? (save.isError ? `save failed: ${save.error.message}` : null);
  const none = selection === null;
  // Text controls stay VISIBLE but dead for a box (spec §3b) — a toolbar that reshuffles on every
  // selection is harder to use than one whose controls simply grey out. The box controls are the
  // other way round: they only exist when there is a box, so text never carries dead fill/radius.
  const box = selection !== null && selection.kind === 'box';
  const noText = none || box;

  return (
    // Dark in BOTH themes: `bg-hero` + the phase-3 dark-surface scope (§2). Inside the
    // scope --ink is the light constant, so the chrome reads `text-ink` rather than `text-bone`.
    <div data-surface="dark" className="fixed inset-0 z-[70] flex flex-col bg-hero p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-ink">canvas edit · candidate #{asset.id}</div>
        <span className="text-[11px] lowercase text-ink/70">
          click to select · drag to move · double-click to edit text · corner knobs resize · ⌫ deletes · ⌘Z undoes
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="subtle" disabled={save.isPending} onClick={close}>cancel</Button>
          <Button disabled={busy || srcDoc === null} onClick={startSave}>
            {busy ? 'saving…' : 'save as new candidate'}
          </Button>
        </div>
      </div>

      {/* Inside the dark scope `bg-bone` collapses onto the hero ground, so the toolbar strip
          re-points to `bg-paper` (= hero-panel here) to keep one step of figure/ground. */}
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded-card border border-hairline bg-paper px-3 py-2">
        {/* Document-level, not selection-level: undo works with nothing selected. */}
        <div className="flex items-center gap-1">
          <ToolButton disabled={history.undoDepth === 0} title="undo (⌘Z)"
            onClick={() => send({ forge: EDITOR_COMMAND, type: 'undo' })}>undo</ToolButton>
          <ToolButton disabled={history.redoDepth === 0} title="redo (⇧⌘Z)"
            onClick={() => send({ forge: EDITOR_COMMAND, type: 'redo' })}>redo</ToolButton>
        </div>
        {/* Also document-level: adding needs no selection, it drops at the canvas centre. */}
        <div className="flex items-center gap-1">
          <ToolButton disabled={!ready} title="add a text block at the canvas centre"
            onClick={() => send({ forge: EDITOR_COMMAND, type: 'add', kind: 'text' })}>+ text</ToolButton>
          <ToolButton disabled={!ready} title="add a box at the canvas centre"
            onClick={() => send({ forge: EDITOR_COMMAND, type: 'add', kind: 'box' })}>+ box</ToolButton>
        </div>
        <ToolButton active={refineOpen} title="patch the background with an instruction, without leaving the editor"
          onClick={() => setRefineOpen((open) => !open)}>refine bg</ToolButton>
        <span className="text-[11px] lowercase text-soft">
          {none ? 'nothing selected' : `<${selection.tag}>${box ? ' box' : ''} · ${selection.widthPx}×${selection.heightPx}`}
        </span>
        <div className="flex items-center gap-1">
          {LAYERS.map((l) => (
            <ToolButton key={l.dir} disabled={none} title={l.title}
              onClick={() => send({ forge: EDITOR_COMMAND, type: 'layer', dir: l.dir })}>{l.label}</ToolButton>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <ToolButton disabled={noText} title="smaller" onClick={() => stepFont(-FONT_STEP)}>a−</ToolButton>
          <input type="number" className={`${toolCls} w-16 tabular-nums`} disabled={noText}
            value={selection?.fontSizePx ?? 0} min={FONT_MIN} max={FONT_MAX}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next >= FONT_MIN && next <= FONT_MAX) patch({ fontSizePx: next });
            }} />
          <ToolButton disabled={noText} title="larger" onClick={() => stepFont(FONT_STEP)}>a+</ToolButton>
        </div>
        <input type="color" aria-label="text colour" disabled={noText} value={selection?.color ?? '#000000'}
          onChange={(e) => patch({ color: e.target.value })}
          className="size-7 cursor-pointer rounded-card border border-hairline bg-paper disabled:cursor-not-allowed disabled:border-hairline-soft disabled:bg-bone disabled:opacity-60" />
        <select className={toolCls} aria-label="font weight" disabled={noText} value={selection?.fontWeight ?? 400}
          onChange={(e) => patch({ fontWeight: Number(e.target.value) })}>
          {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {ALIGNS.map((a) => (
            <ToolButton key={a} disabled={noText} active={selection?.textAlign === a}
              onClick={() => patch({ textAlign: a })}>{a}</ToolButton>
          ))}
        </div>
        {box && (
          <div className="flex items-center gap-1.5 border-l border-hairline pl-3">
            <input type="color" aria-label="fill colour" value={selection.fill}
              onChange={(e) => patch({ fill: e.target.value })}
              className="size-7 cursor-pointer rounded-card border border-hairline bg-paper" />
            <label className="flex items-center gap-1 text-[11px] lowercase text-soft">
              radius
              <input type="number" className={`${toolCls} w-16 tabular-nums`} value={selection.radiusPx}
                min={0} max={RADIUS_MAX}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 0 && next <= RADIUS_MAX) patch({ radiusPx: next });
                }} />
            </label>
            <label className="flex items-center gap-1 text-[11px] lowercase text-soft">
              opacity
              <input type="number" className={`${toolCls} w-16 tabular-nums`} value={selection.opacityPct}
                min={0} max={100}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 0 && next <= 100) patch({ opacityPct: next });
                }} />
            </label>
          </div>
        )}
      </div>

      <RefinePanel asset={asset} hidden={!refineOpen} onPatched={applyPatchedBg} />

      {error !== null && <div className="mb-2"><ErrorNote label="error">{error}</ErrorNote></div>}

      <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center">
        {srcDoc === null
          ? <span className="flex items-center gap-2 text-[13px] lowercase text-ink"><Spinner /> loading the canvas…</span>
          : (
            <div className="shrink-0 overflow-hidden rounded-card border border-hairline bg-paper"
              style={{ width: CANVAS_PX * scale, height: CANVAS_PX * scale }}>
              <iframe ref={iframeRef} title={`canvas editor for candidate ${asset.id}`}
                sandbox="allow-scripts allow-same-origin" srcDoc={srcDoc} onLoad={initRuntime}
                className="block border-0"
                style={{ width: CANVAS_PX, height: CANVAS_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
            </div>
          )}
      </div>
    </div>
  );
}
