import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { lintTells, mergeTells, type TellSpan } from '@forge/shared';
import { measureSelectionRects, type SelectionBox } from '../lib/textarea-caret';

interface Frame { top: number; left: number; width: number; height: number }
interface Painted { span: TellSpan; box: SelectionBox }

/**
 * Tell marks painted over a textarea's own text. The caller places this inside the same
 * `relative` wrapper as the textarea, right after it.
 *
 * The frame ignores pointer events so typing and selecting still reach the textarea, but each
 * rect takes them back: a `pointer-events-none` element is never hit-tested, so a `title` on one
 * would never show. Taking them means a click would otherwise be swallowed, so a rect's mousedown
 * selects the flagged span instead.
 *
 * z-0 keeps the marks under the selection-refine highlight layer (z-10), so a selection paints
 * over a tell rather than the other way round.
 *
 * Clicking a rect therefore also opens the selection-refine popup on the flagged span: the popup
 * reads `selectionchange`, and its drag guard only arms when the mousedown target IS the textarea
 * (selection-refine.tsx:101), which a rect is not. That is deliberate and the point of the
 * interaction: click a tell, get offered a rewrite of exactly that span.
 */
export function TellOverlay(
  { textareaRef, text }: { textareaRef: RefObject<HTMLTextAreaElement | null>; text: string },
): ReactNode {
  /** Merged, like LintedText: two rects on the same characters would double the fill alpha
   *  and stack two underlines, which reads as a rendering bug. */
  const spans = useMemo(() => mergeTells(lintTells(text)), [text]);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [painted, setPainted] = useState<Painted[]>([]);
  /** The frame clips its rects to the textarea, so a CSS tooltip on one would be cut off on
   *  the first line. The tip renders outside that clip instead, placed from the hovered box. */
  const [hovered, setHovered] = useState<Painted | null>(null);

  const measure = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || spans.length === 0) {
      setFrame(null);
      setPainted([]);
      return;
    }
    setFrame({
      top: textarea.offsetTop, left: textarea.offsetLeft,
      width: textarea.offsetWidth, height: textarea.offsetHeight,
    });
    setHovered(null);
    setPainted(spans.flatMap((span) =>
      measureSelectionRects(textarea, span.start, span.end).map((box) => ({ span, box }))));
  }, [textareaRef, spans]);

  useLayoutEffect(() => {
    measure();
    const textarea = textareaRef.current;
    if (!textarea) return;

    /** measureSelectionRects builds and tears down a mirror div per call, once per span. Scroll
     *  fires far faster than paint, so coalesce to one measure per frame. */
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };

    textarea.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    // Dragging the textarea's own resize handle rewraps the text without firing either of the
    // above, which left every mark stale until the next keystroke.
    const observer = new ResizeObserver(schedule);
    observer.observe(textarea);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      textarea.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [measure, textareaRef]);

  if (!frame || painted.length === 0) return null;

  return (
    <>
      <div aria-hidden className="pointer-events-none absolute z-0 overflow-hidden" style={frame}>
        {painted.map((mark) => (
          <div
            key={`${mark.span.start}-${mark.span.end}-${mark.box.top}-${mark.box.left}`}
            title={mark.span.labels.join(', ')}
            className="pointer-events-auto absolute rounded-[2px] border-b-2 border-salmon bg-salmon/20"
            style={{
              top: mark.box.top, left: mark.box.left,
              width: mark.box.right - mark.box.left, height: mark.box.bottom - mark.box.top,
            }}
            onMouseEnter={() => setHovered(mark)}
            onMouseLeave={() => setHovered((current) => (current === mark ? null : current))}
            onMouseDown={(e) => {
              e.preventDefault();
              const textarea = textareaRef.current;
              if (!textarea) return;
              textarea.focus();
              textarea.setSelectionRange(mark.span.start, mark.span.end);
            }}
          />
        ))}
      </div>

      {hovered && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-card border border-hairline bg-paper px-[7px] py-[3px] text-[11px] leading-[1.4] lowercase text-ink"
          style={{
            top: frame.top + hovered.box.top - 6,
            left: frame.left + (hovered.box.left + hovered.box.right) / 2,
          }}
        >
          {hovered.span.labels.join(', ')}
        </div>
      )}
    </>
  );
}
