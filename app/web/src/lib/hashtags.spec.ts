import { describe, it, expect } from 'vitest';
import { normalizeHashtags } from './hashtags';

describe('normalizeHashtags', () => {
  it('prefixes a bare tag and leaves an already-prefixed one alone', () => {
    expect(normalizeHashtags(['build', '#public'])).toEqual(['#build', '#public']);
  });

  it('swallows inner whitespace rather than splitting the tag', () => {
    expect(normalizeHashtags([' build in public '])).toEqual(['#buildinpublic']);
  });

  it('collapses repeated leading hashes to one', () => {
    expect(normalizeHashtags(['###ai'])).toEqual(['#ai']);
  });

  it('drops entries that normalize to nothing', () => {
    expect(normalizeHashtags(['#', '', '   ', '##', '#real'])).toEqual(['#real']);
  });

  it('dedupes case-insensitively, first casing winning', () => {
    expect(normalizeHashtags(['#AI', '#ai', 'Ai'])).toEqual(['#AI']);
  });

  it('preserves input order', () => {
    expect(normalizeHashtags(['#c', '#a', '#b'])).toEqual(['#c', '#a', '#b']);
  });

  it('returns an empty array for empty input', () => {
    expect(normalizeHashtags([])).toEqual([]);
  });
});
