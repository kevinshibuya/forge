import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRefineSelection, useRefineSelectionProposal, useRun, useUpdateBody } from '../api/hooks';
import { countChangesOutside, diffWords, type DiffSegment } from '../lib/diff';
import { measureSelectionRects, type SelectionBox } from '../lib/textarea-caret';
import { useRunWatcher } from './run-watcher';
import { Button, ErrorNote, Spinner, WarnBanner, inputCls } from './primitives';

const POPUP_W = 420;
const GAP = 8;
/** Breathing room against the viewport edges. */
const EDGE = 8;
/** Only used before the popup has ever been laid out; a ResizeObserver replaces it immediately. */
const EST_POPUP_H = 240;

const SEGMENT_CLS: Record<DiffSegment['type'], string> = {
  same: '',
  // text-hero, not text-ink: --ink inverts to near-white in dark theme, which would put
  // light text back on these light accent fills. --hero is dark in BOTH themes.
  added: 'rounded-sm bg-mint text-hero',
  removed: 'rounded-sm bg-salmon text-hero line-through decoration-hero',
};

interface SelectionSpan { start: number; end: number; text: string }

/**
 * Everything the layout effect derives, in coordinates of the wrapper the textarea shares its
 * origin with. `frame` is the textarea's own box: the highlight layer clips to it, so a selection
 * scrolled out of view is not painted over whatever sits above or below the textarea.
 */
interface Placement {
  popup: { top: number; left: number; width: number };
  frame: { top: number; left: number; width: number; height: number };
  rects: SelectionBox[];
}

/**
 * `compose` = collecting an instruction; `launched` = a run exists and the run row + proposal
 * queries drive the rest of the UI (waiting / failed / preview), so there is no state to keep
 * in sync with them. `originalBody` is frozen at launch: the diff and the outside-selection
 * count must be measured against the exact text the offsets referred to.
 */
type Phase =
  | { kind: 'compose' }
  | { kind: 'launched'; runId: number; originalBody: string; instruction: string };

export function SelectionRefine({ postId, textareaRef, blocked, onSaveEdits, saving = false }: {
  postId: number;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Unsaved local edits: the server would slice its own copy of the body, so the offsets would lie. */
  blocked: boolean;
  /**
   * Persist the local draft so a refine can run against offsets the server agrees with. Without
   * it, a tell you just typed is a dead end: the mark invites a click, the popup opens, and the
   * only thing it can say is "save first" about text you are trying to fix.
   */
  onSaveEdits?: () => Promise<void>;
  saving?: boolean;
}) {
  const [selection, setSelection] = useState<SelectionSpan | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [instruction, setInstruction] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'compose' });
  const [reflow, setReflow] = useState(0);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const reflowFrame = useRef(0);

  /** Coalesced to one re-measure per frame: page scroll fires far too often to measure inline. */
  const bump = useCallback(() => {
    if (reflowFrame.current) return;
    reflowFrame.current = requestAnimationFrame(() => {
      reflowFrame.current = 0;
      setReflow((n) => n + 1);
    });
  }, []);

  const { notifyLaunched } = useRunWatcher();
  const launch = useRefineSelection(postId);
  const save = useUpdateBody(postId);
  const runId = phase.kind === 'launched' ? phase.runId : null;
  const run = useRun(runId, { pollWhileRunning: true });
  const succeeded = run.data?.status === 'succeeded';
  const proposal = useRefineSelectionProposal(postId, runId, { enabled: succeeded });

  // Everything the user cannot back out of: dismissal is disabled while a run or a write is in flight.
  const waiting = phase.kind === 'launched'
    && (run.isPending || run.data?.status === 'running' || (succeeded && proposal.isPending));
  const locked = waiting || launch.isPending || save.isPending;

  const close = useCallback(() => {
    setSelection(null);
    setInstruction('');
    setPhase({ kind: 'compose' });
  }, []);

  // Track the textarea's selection only while composing — once a run is launched the popup owns
  // the interaction, and a stray caret move must not tear down a proposal. Updates are held back
  // while the mouse button is down so the popup does not chase a drag-select in progress.
  useEffect(() => {
    if (phase.kind !== 'compose') return;
    let dragging = false;
    const read = () => {
      const ta = textareaRef.current;
      if (!ta || document.activeElement !== ta) return; // focus in the popup keeps the last selection
      const { selectionStart: start, selectionEnd: end, value } = ta;
      setSelection(start === end ? null : { start, end, text: value.slice(start, end) });
    };
    const onSelectionChange = () => { if (!dragging) read(); };
    const onMouseDown = (e: MouseEvent) => { if (e.target === textareaRef.current) dragging = true; };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      read();
    };
    read();
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [phase.kind, textareaRef]);

  /**
   * The popup hugs the RIGHT of the selection and stays there — it may overflow the body panel
   * (wanted: nothing in the wrapper chain clips it) and it may cover unselected body text. The one
   * thing it may never cover is the selected text itself, so when the viewport's right margin pulls
   * it back over the selection it steps below the selection instead (above, if below won't fit).
   *
   * Everything is decided against the VIEWPORT, never against the textarea's own width: clamping
   * into the textarea is what used to drop the popup on top of the selection.
   */
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!selection || !ta) {
      setPlacement(null);
      return;
    }
    const rects = measureSelectionRects(ta, selection.start, selection.end);
    const frame = { top: ta.offsetTop, left: ta.offsetLeft, width: ta.offsetWidth, height: ta.offsetHeight };
    const taRect = ta.getBoundingClientRect();
    // Wrapper origin in viewport coords: lets the fit test run against the viewport, as it must,
    // while the result stays in the absolute-positioning space the popup renders in.
    const originTop = taRect.top - frame.top;
    const originLeft = taRect.left - frame.left;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const popupH = popupRef.current?.offsetHeight || EST_POPUP_H;

    // Selection extent, lifted from textarea-relative into wrapper coords.
    const selTop = frame.top + Math.min(...rects.map((r) => r.top));
    const selBottom = frame.top + Math.max(...rects.map((r) => r.bottom));
    const selRight = frame.left + Math.max(...rects.map((r) => r.right));

    // Horizontal: right of the selection, pulled back to the viewport's right margin if it spills.
    // The floor is the textarea's left edge — the popup must never end up in the sidebar gutter.
    const width = Math.min(POPUP_W, vw - EDGE - taRect.left);
    const maxLeft = vw - EDGE - width - originLeft;
    const left = Math.min(Math.max(selRight + GAP, frame.left), Math.max(frame.left, maxLeft));

    // Vertical: the selection's first line, kept on screen and never above the textarea's own top.
    const wantTop = Math.max(selTop, frame.top);
    let top = Math.min(Math.max(wantTop + originTop, EDGE), Math.max(EDGE, vh - popupH - EDGE)) - originTop;

    // Did the pull-back park it on the selected text? Then move off the line, not off the anchor.
    const coversSelection = rects.some((r) =>
      left < frame.left + r.right && left + width > frame.left + r.left
      && top < frame.top + r.bottom && top + popupH > frame.top + r.top);
    if (coversSelection) {
      const below = selBottom + GAP;
      const above = selTop - GAP - popupH;
      top = below + originTop + popupH <= vh - EDGE || above + originTop < EDGE ? below : above;
    }
    setPlacement({ popup: { top, left, width }, frame, rects });
  }, [selection, reflow, textareaRef]);

  useEffect(() => {
    if (!selection) return;
    // Capture catches the textarea's own scroll as well as any scrolling ancestor / the page.
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
      if (reflowFrame.current) {
        cancelAnimationFrame(reflowFrame.current);
        reflowFrame.current = 0;
      }
    };
  }, [selection, bump]);

  // The popup grows a lot between phases (compose → diff preview); its height decides the vertical
  // clamp, so re-place whenever it changes. The initial observation also replaces EST_POPUP_H.
  const open = placement !== null;
  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    const observer = new ResizeObserver(bump);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, bump]);

  // Escape dismisses whenever the popup is idle. Click-outside only while composing: once a
  // proposal is on screen, discarding it takes a deliberate reject.
  useEffect(() => {
    if (!selection || locked) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => {
      if (phase.kind !== 'compose') return;
      const target = e.target;
      if (target instanceof Node && popupRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [selection, locked, phase.kind, close]);

  const originalBody = phase.kind === 'launched' ? phase.originalBody : '';
  const proposedBody = proposal.data?.proposedBody ?? null;
  const segments = useMemo(
    () => (proposedBody === null ? null : diffWords(originalBody, proposedBody)),
    [originalBody, proposedBody],
  );
  const outside = useMemo(
    () => (segments && selection ? countChangesOutside(segments, selection.start, selection.end) : 0),
    [segments, selection],
  );

  if (!selection || !placement) return null;

  const submit = () => {
    const ta = textareaRef.current;
    const trimmed = instruction.trim();
    if (!ta || !trimmed) return;
    launch.mutate(
      { selectionStart: selection.start, selectionEnd: selection.end, instruction: trimmed },
      {
        onSuccess: (res) => {
          notifyLaunched(res.runId, postId);
          setPhase({ kind: 'launched', runId: res.runId, originalBody: ta.value, instruction: trimmed });
        },
      },
    );
  };
  const accept = () => {
    if (phase.kind !== 'launched' || proposedBody === null) return;
    save.mutate({ body: proposedBody, sourceRunId: phase.runId }, { onSuccess: close });
  };
  const retry = () => setPhase({ kind: 'compose' }); // keeps the instruction so it can be tweaked

  const failure = phase.kind === 'launched'
    ? (run.error?.message
      ?? (run.data && run.data.status !== 'running' && run.data.status !== 'succeeded'
        ? `run #${phase.runId} ${run.data.failureKind ?? run.data.status}: ${run.data.error ?? 'no detail'}`
        : null)
      ?? proposal.error?.message
      ?? null)
    : null;

  return (
    <>
      {/* The native highlight dies the moment focus moves into the popup, so we paint our own in
          the same hue as `::selection`. Translucent (it sits OVER the text, the textarea's
          background being opaque) and click-through, clipped to the textarea's box. */}
      <div aria-hidden className="pointer-events-none absolute z-10 overflow-hidden" style={placement.frame}>
        {placement.rects.map((r, i) => (
          // 35%, not 55%: this paints OVER the body text, and in dark theme --ink is near-white, so
          // at 55% the highlighted words sat at ≈3:1 on the mint (§4 checks 1+2). 35% keeps the
          // band clearly visible on both grounds while the text under it stays ≥5:1.
          <div key={`${i}-${r.top}-${r.left}`} className="absolute rounded-[2px] bg-mint/35"
            style={{
              top: r.top, left: r.left,
              width: Math.max(0, r.right - r.left), height: Math.max(0, r.bottom - r.top),
            }} />
        ))}
      </div>

      <div ref={popupRef} role="dialog" aria-label="refine selection"
        style={{ top: placement.popup.top, left: placement.popup.left, width: placement.popup.width }}
        className="absolute z-20 rounded-card border border-hairline bg-paper p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">refine selection</div>
          <span className="text-[11px] tabular-nums lowercase text-soft">{selection.end - selection.start} chars</span>
        </div>
        <p className="mb-2 line-clamp-2 border-l-2 border-hairline-soft pl-2 text-[12px] italic text-soft">{selection.text}</p>

        {phase.kind === 'compose' && (blocked ? (
          <>
            <WarnBanner>this refine runs against the saved body, so your edits go first</WarnBanner>
            {onSaveEdits && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="subtle" onClick={close}>cancel</Button>
                <Button disabled={saving} onClick={() => { void onSaveEdits(); }}>
                  {saving ? 'saving…' : 'save and refine'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Deliberately not autofocused: stealing focus mid-selection would abort a keyboard
                shift-select and drop the textarea's selection highlight. */}
            <textarea className={`${inputCls} min-h-14 text-[13px]`} value={instruction}
              placeholder="e.g. make this land harder, cut the hedging"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="subtle" onClick={close}>cancel</Button>
              <Button disabled={!instruction.trim() || launch.isPending} onClick={submit}>
                {launch.isPending ? 'launching…' : 'refine'}
              </Button>
            </div>
            {launch.isError && <div className="mt-2"><ErrorNote label="launch failed">{launch.error.message}</ErrorNote></div>}
          </>
        ))}

        {phase.kind === 'launched' && (
          <>
            {waiting && (
              <div className="flex items-center gap-2 text-[13px] lowercase text-soft">
                <Spinner /> refining “{phase.instruction}”…
              </div>
            )}

            {!waiting && failure !== null && (
              <>
                <ErrorNote label="error">{failure}</ErrorNote>
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button variant="subtle" onClick={close}>close</Button>
                  <Button onClick={retry}>try again</Button>
                </div>
              </>
            )}

            {!waiting && failure === null && segments && (
              <>
                <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-card border border-hairline bg-bone p-2 text-[13px] leading-relaxed text-ink">
                  {segments.map((seg, i) => (
                    <span key={`${i}-${seg.type}`} className={SEGMENT_CLS[seg.type]}>{seg.text}</span>
                  ))}
                </div>
                {outside > 0 && (
                  <p className="mt-2 text-[12px] lowercase text-soft">
                    also adjusted {outside} spot{outside === 1 ? '' : 's'} outside your selection
                  </p>
                )}
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button variant="subtle" disabled={save.isPending} onClick={close}>reject</Button>
                  <Button disabled={save.isPending} onClick={accept}>{save.isPending ? 'applying…' : 'accept'}</Button>
                </div>
                {save.isError && <div className="mt-2"><ErrorNote label="accept failed">{save.error.message}</ErrorNote></div>}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
