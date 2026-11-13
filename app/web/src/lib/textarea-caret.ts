// Textareas expose no geometry for their content, so to anchor UI to a selection — or to paint our
// own highlight over it — we render a hidden div that mirrors the textarea's typography and box,
// wrap the selected slice in a span, and read that span's rects. Standard "mirror div" technique.

export interface SelectionBox {
  /** All four edges are px relative to the textarea's own border box, already scroll-adjusted. */
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** Zero-width space: keeps a trailing newline (and an empty slice) measurable in the mirror. */
const ZWSP = '\u200b';

/**
 * Everything that can change where a glyph lands. Width and box-sizing are set explicitly
 * afterwards (the textarea's scrollbar makes the computed `width` the wrong content width).
 */
const MIRRORED: readonly string[] = [
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'font-size-adjust', 'line-height', 'letter-spacing', 'word-spacing', 'tab-size',
  'text-align', 'text-indent', 'text-transform', 'text-rendering',
  'white-space', 'overflow-wrap', 'word-break', 'direction',
];

/**
 * Builds the mirror, hands `read` the span covering `value.slice(start, end)` plus the mirror's own
 * rect (the origin every measurement is taken against), and tears the mirror down again.
 */
function withMirror<T>(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  read: (span: HTMLSpanElement, mirrorRect: DOMRect) => T,
): T {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of MIRRORED) mirror.style.setProperty(prop, computed.getPropertyValue(prop));

  const borderX = (parseFloat(computed.borderLeftWidth) || 0) + (parseFloat(computed.borderRightWidth) || 0);
  mirror.style.boxSizing = 'border-box';
  // clientWidth excludes a vertical scrollbar, so this reproduces the wrapping width exactly.
  mirror.style.width = `${textarea.clientWidth + borderX}px`;
  mirror.style.height = 'auto';
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflow = 'hidden';

  const value = textarea.value;
  mirror.append(document.createTextNode(value.slice(0, start)));
  const span = document.createElement('span');
  // A zero-width space keeps an empty or newline-only slice measurable.
  span.textContent = value.slice(start, end) || ZWSP;
  mirror.append(span);
  mirror.append(document.createTextNode(value.slice(end) + ZWSP));

  document.body.append(mirror);
  try {
    return read(span, mirror.getBoundingClientRect());
  } finally {
    mirror.remove();
  }
}

function toBox(rect: DOMRect, mirrorRect: DOMRect, textarea: HTMLTextAreaElement): SelectionBox {
  return {
    top: rect.top - mirrorRect.top - textarea.scrollTop,
    bottom: rect.bottom - mirrorRect.top - textarea.scrollTop,
    left: rect.left - mirrorRect.left - textarea.scrollLeft,
    right: rect.right - mirrorRect.left - textarea.scrollLeft,
  };
}

/** Bounding box of `value.slice(start, end)` inside `textarea`. Callers position against a wrapper that shares the textarea's origin. */
export function measureSelection(textarea: HTMLTextAreaElement, start: number, end: number): SelectionBox {
  return withMirror(textarea, start, end, (span, mirrorRect) =>
    toBox(span.getBoundingClientRect(), mirrorRect, textarea));
}

/**
 * One box per VISUAL line of the selection — a wrapped or multi-line selection yields several.
 * The bounding box of such a selection is the whole paragraph block, so anything drawn per line
 * (a highlight) must use these instead. Always at least one box, so callers can read `[0]`.
 */
export function measureSelectionRects(textarea: HTMLTextAreaElement, start: number, end: number): SelectionBox[] {
  return withMirror(textarea, start, end, (span, mirrorRect) => {
    // Newline-only slices produce empty/degenerate rects; the bounding box still has the right top.
    const rects = Array.from(span.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0);
    const source = rects.length > 0 ? rects : [span.getBoundingClientRect()];
    return source.map((r) => toBox(r, mirrorRect, textarea));
  });
}
