// Word-level diff for the selection-refine preview. Deliberately dependency-free:
// posts are a few thousand characters, so a plain LCS is fast enough and keeps the
// bundle honest.

export interface DiffSegment {
  type: 'same' | 'added' | 'removed';
  text: string;
  /**
   * Char offset in `a`. For `same`/`removed` it is where the segment starts in `a`;
   * for `added` it is the point in `a` where the new text is inserted (zero width).
   * This is what lets the caller decide whether a change fell outside the selection.
   */
  aOffset: number;
}

/** Whitespace-preserving tokens: every token is either a whitespace run or a word. Joining them rebuilds the input exactly. */
function tokenize(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}

/** Append, merging into the previous segment when the type matches (segments stay contiguous, so the first offset wins). */
function push(out: DiffSegment[], type: DiffSegment['type'], text: string, aOffset: number): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last && last.type === type) {
    last.text += text;
    return;
  }
  out.push({ type, text, aOffset });
}

/** Word-level diff of `a` → `b`, as a contiguous segment list that reconstructs `a` (same+removed) and `b` (same+added). */
export function diffWords(a: string, b: string): DiffSegment[] {
  if (a === b) return a === '' ? [] : [{ type: 'same', text: a, aOffset: 0 }];

  const ta = tokenize(a);
  const tb = tokenize(b);

  // Trim the shared head/tail before the O(n·m) core. A selection refine usually rewrites a
  // small span of a long post, so this keeps the DP table small in the common case.
  let head = 0;
  while (head < ta.length && head < tb.length && ta[head] === tb[head]) head++;
  let tail = 0;
  while (
    tail < ta.length - head
    && tail < tb.length - head
    && ta[ta.length - 1 - tail] === tb[tb.length - 1 - tail]
  ) tail++;

  const midA = ta.slice(head, ta.length - tail);
  const midB = tb.slice(head, tb.length - tail);
  const n = midA.length;
  const m = midB.length;
  const w = m + 1;

  // dp[i][j] = length of the LCS of midA[i..] and midB[j..]; walking it forward from (0,0)
  // emits segments in reading order.
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = midA[i]! === midB[j]!
        ? dp[(i + 1) * w + j + 1]! + 1
        : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }

  const out: DiffSegment[] = [];
  const headText = ta.slice(0, head).join('');
  push(out, 'same', headText, 0);
  let off = headText.length;

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const x = midA[i]!;
    const y = midB[j]!;
    if (x === y) {
      push(out, 'same', x, off);
      off += x.length;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
      push(out, 'removed', x, off);
      off += x.length;
      i++;
    } else {
      push(out, 'added', y, off);
      j++;
    }
  }
  while (i < n) {
    const x = midA[i]!;
    push(out, 'removed', x, off);
    off += x.length;
    i++;
  }
  while (j < m) {
    push(out, 'added', midB[j]!, off);
    j++;
  }
  push(out, 'same', ta.slice(ta.length - tail).join(''), off);

  return coalesce(out);
}

const WHITESPACE_ONLY = /^\s+$/;

/**
 * A word-level LCS keeps matching the spaces *between* rewritten words, which renders as
 * `nobody`/`no` `measures`/`one prices` — unreadable. Rewrite each change run (non-`same`
 * segments separated only by whitespace matches) into one removal followed by one addition.
 * Both reconstruction invariants survive: the shared whitespace belongs to `a` and to `b`,
 * so it lands in both halves.
 */
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i]!;
    if (seg.type === 'same') {
      out.push(seg);
      i++;
      continue;
    }
    let end = i; // last index that belongs to this change run
    let k = i;
    while (k < segments.length) {
      const s = segments[k]!;
      if (s.type !== 'same') {
        end = k;
        k++;
      } else if (WHITESPACE_ONLY.test(s.text) && segments[k + 1] !== undefined && segments[k + 1]!.type !== 'same') {
        k++; // a matched space between two edits — absorb it rather than break the run
      } else {
        break;
      }
    }
    const run = segments.slice(i, end + 1);
    const removed = run.filter((s) => s.type !== 'added').map((s) => s.text).join('');
    const added = run.filter((s) => s.type !== 'removed').map((s) => s.text).join('');
    const aOffset = run[0]!.aOffset;
    if (removed !== '') out.push({ type: 'removed', text: removed, aOffset });
    if (added !== '') out.push({ type: 'added', text: added, aOffset });
    i = end + 1;
  }
  return out;
}

/**
 * How many distinct change *spots* land outside `[selectionStart, selectionEnd)` of the original body.
 * A spot is a maximal run of adjacent non-`same` segments, so a replacement (removed + added)
 * counts once. A pure insertion is zero-width and counts as inside when it sits on either
 * selection edge — text appended at the tail of the selection is still part of that edit.
 */
export function countChangesOutside(
  segments: readonly DiffSegment[],
  selectionStart: number,
  selectionEnd: number,
): number {
  let count = 0;
  let i = 0;
  while (i < segments.length) {
    if (segments[i]!.type === 'same') {
      i++;
      continue;
    }
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    while (i < segments.length && segments[i]!.type !== 'same') {
      const seg = segments[i]!;
      start = Math.min(start, seg.aOffset);
      end = Math.max(end, seg.aOffset + (seg.type === 'removed' ? seg.text.length : 0));
      i++;
    }
    const outside = start === end
      ? start < selectionStart || start > selectionEnd
      : end <= selectionStart || start >= selectionEnd;
    if (outside) count++;
  }
  return count;
}
