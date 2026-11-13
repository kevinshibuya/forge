import { describe, it, expect } from 'vitest';
import { countChangesOutside, diffWords, type DiffSegment } from './diff';

/** `same` + `removed` must rebuild `a`; `same` + `added` must rebuild `b`. */
function reconstruct(segments: readonly DiffSegment[]): { a: string; b: string } {
  return {
    a: segments.filter((s) => s.type !== 'added').map((s) => s.text).join(''),
    b: segments.filter((s) => s.type !== 'removed').map((s) => s.text).join(''),
  };
}

describe('diffWords', () => {
  it('returns one same segment for identical non-empty strings', () => {
    expect(diffWords('hello world', 'hello world')).toEqual([
      { type: 'same', text: 'hello world', aOffset: 0 },
    ]);
  });

  it('returns nothing at all for the empty-to-empty case', () => {
    expect(diffWords('', '')).toEqual([]);
  });

  it('marks a pure insertion as added, anchored where it lands in a', () => {
    expect(diffWords('one three', 'one two three')).toEqual([
      { type: 'same', text: 'one ', aOffset: 0 },
      { type: 'added', text: 'two ', aOffset: 4 },
      { type: 'same', text: 'three', aOffset: 4 },
    ]);
  });

  it('marks a pure deletion as removed', () => {
    expect(diffWords('one two three', 'one three')).toEqual([
      { type: 'same', text: 'one ', aOffset: 0 },
      { type: 'removed', text: 'two ', aOffset: 4 },
      { type: 'same', text: 'three', aOffset: 8 },
    ]);
  });

  it('emits a replacement as one removal then one addition sharing an offset', () => {
    expect(diffWords('the quick fox', 'the slow fox')).toEqual([
      { type: 'same', text: 'the ', aOffset: 0 },
      { type: 'removed', text: 'quick', aOffset: 4 },
      { type: 'added', text: 'slow', aOffset: 4 },
      { type: 'same', text: ' fox', aOffset: 9 },
    ]);
  });

  it('keeps aOffset pointing into a for the segment after a change', () => {
    const segments = diffWords('the quick fox', 'the slow fox');
    const trailing = segments[segments.length - 1];
    expect(trailing?.type).toBe('same');
    // 'the quick' is 9 chars, so the tail really does start at index 9 of `a`.
    expect(trailing?.aOffset).toBe(9);
    expect('the quick fox'.slice(trailing?.aOffset ?? 0)).toBe(trailing?.text);
  });

  it('coalesces a multi-token rewrite into one removal and one addition', () => {
    // The reason `coalesce` exists. Without its whitespace-absorption arm (diff.ts:132) the LCS
    // keeps matching the space BETWEEN the rewritten words and this fragments into
    // nobody/no measures/one prices — the unreadable rendering diff.ts:108-113 names. The
    // reconstruction invariant below survives that regression, so only an explicit shape
    // assertion catches it.
    expect(diffWords('nobody measures this', 'no one prices this')).toEqual([
      { type: 'removed', text: 'nobody measures', aOffset: 0 },
      { type: 'added', text: 'no one prices', aOffset: 0 },
      { type: 'same', text: ' this', aOffset: 15 },
    ]);
  });

  it('handles the empty-string edges', () => {
    expect(diffWords('', 'x')).toEqual([{ type: 'added', text: 'x', aOffset: 0 }]);
    expect(diffWords('x', '')).toEqual([{ type: 'removed', text: 'x', aOffset: 0 }]);
  });

  it('reconstructs both inputs from the segments', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['one three', 'one two three'],
      ['one two three', 'one three'],
      ['the quick fox', 'the slow fox'],
      ['nobody measures this', 'no one prices this'],
    ];
    for (const [a, b] of pairs) {
      expect(reconstruct(diffWords(a, b)), `${a} -> ${b}`).toEqual({ a, b });
    }
  });
});

describe('countChangesOutside', () => {
  // 'the quick fox' -> 'the slow fox': one change spot spanning a[4..9).
  const replacement = diffWords('the quick fox', 'the slow fox');
  // 'one three' -> 'one two three': one zero-width insertion spot at a[4].
  const insertion = diffWords('one three', 'one two three');

  it('counts a change that ends before the selection', () => {
    expect(countChangesOutside(replacement, 10, 13)).toBe(1);
  });

  it('counts a change that starts after the selection', () => {
    expect(countChangesOutside(replacement, 0, 3)).toBe(1);
  });

  it('does not count a change inside the selection', () => {
    expect(countChangesOutside(replacement, 0, 13)).toBe(0);
  });

  it('counts each disjoint change spot separately', () => {
    // Nothing else here counts past 1, so a `Math.min(count, 1)` regression would pass the whole
    // file — and selection-refine.tsx:332 pluralizes on this number.
    const twoSpots = diffWords('alpha x beta y gamma', 'alpha X beta Y gamma');
    expect(countChangesOutside(twoSpots, 0, 5)).toBe(2);
    expect(countChangesOutside(twoSpots, 6, 7)).toBe(1);
    expect(countChangesOutside(twoSpots, 0, 20)).toBe(0);
  });

  it('counts a multi-token rewrite as one spot, not one per word', () => {
    // The user-facing half of the coalesce case above: fragmenting the run would report a spot
    // outside a selection that covers the whole edit.
    const rewrite = diffWords('nobody measures this', 'no one prices this');
    expect(countChangesOutside(rewrite, 0, 6)).toBe(0);
  });

  it('treats a zero-width insertion on either selection edge as inside', () => {
    expect(countChangesOutside(insertion, 4, 8)).toBe(0); // sits on the start edge
    expect(countChangesOutside(insertion, 0, 4)).toBe(0); // sits on the end edge
  });

  it('counts a zero-width insertion that falls clear of the selection', () => {
    expect(countChangesOutside(insertion, 5, 9)).toBe(1);
  });

  it('counts nothing when there are no changes', () => {
    expect(countChangesOutside(diffWords('same text', 'same text'), 0, 4)).toBe(0);
  });
});
