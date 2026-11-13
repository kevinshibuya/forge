import { describe, expect, it } from 'vitest';
import {
  INPUT_CAPS,
  INPUT_FILE_EXTENSIONS,
  REFUSAL,
  fmtBytes,
  inferInputKind,
  isTextLike,
  pastedTextRef,
} from './inputs';
import { SourceSchema } from './outputs';

describe('isTextLike', () => {
  it('takes the extensionless basenames whole', () => {
    expect(isTextLike('README')).toBe(true);
    expect(isTextLike('Makefile')).toBe(true);
  });

  it('is case-insensitive on the extension', () => {
    expect(isTextLike('notes.MD')).toBe(true);
    expect(isTextLike('notes.md')).toBe(true);
  });

  it('refuses a dotfile whose only dot leads the name', () => {
    expect(isTextLike('.env')).toBe(false);
  });

  it('refuses a binary', () => {
    expect(isTextLike('photo.png')).toBe(false);
  });

  it('leaves a pdf to the converter, and only a dropped file may be one', () => {
    expect(isTextLike('a.pdf')).toBe(false);
    expect(INPUT_FILE_EXTENSIONS).toContain('pdf');
  });
});

describe('inferInputKind', () => {
  it('reads a single-line link as a url', () => {
    expect(inferInputKind('https://example.com/a')).toBe('url');
    expect(inferInputKind('  http://example.com/a  ')).toBe('url');
  });

  it('reads a tilde or slash path as a path', () => {
    expect(inferInputKind('~/keki/notes')).toBe('path');
    expect(inferInputKind('/Volumes/T7/notes')).toBe('path');
  });

  it('reads a multi-line paste as a file even when its first line is a link', () => {
    expect(inferInputKind('https://example.com/a\nand a second line')).toBe('file');
  });

  it('reads a bare word as a file', () => {
    expect(inferInputKind('a thought')).toBe('file');
  });
});

describe('pastedTextRef', () => {
  it('names the paste after its first non-empty line, cut to 60', () => {
    expect(pastedTextRef('  the first line  \nthe second', [])).toBe('the first line');
    expect(pastedTextRef(`${'x'.repeat(80)}\nmore`, [])).toBe('x'.repeat(60));
  });

  it('falls back when there is no line to name it after', () => {
    expect(pastedTextRef('   \n\n  ', [])).toBe('pasted text');
  });

  it('numbers a collision, the fallback and a real first line alike', () => {
    expect(pastedTextRef('   ', ['pasted text'])).toBe('pasted text 2');
    expect(pastedTextRef('   ', ['pasted text', 'pasted text 2'])).toBe('pasted text 3');
    expect(pastedTextRef('a note', ['a note'])).toBe('a note 2');
  });
});

describe('fmtBytes', () => {
  it('prints bytes whole, larger units to one decimal, and drops a trailing zero', () => {
    expect(fmtBytes(80)).toBe('80 b');
    expect(fmtBytes(312 * 1024)).toBe('312 kB');
    expect(fmtBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
  });
});

describe('REFUSAL', () => {
  it('prints exact bytes, because a rounded cap reads as no refusal at the boundary', () => {
    const sentence = REFUSAL.overBytes(INPUT_CAPS.bytes + 1);
    expect(sentence).toContain('5,242,881 bytes');
    expect(sentence).toBe('5,242,881 bytes, the cap is 5 MB');
  });
});

describe('SourceSchema, tightened', () => {
  it('refuses a ref of spaces at every edge that parses a Source', () => {
    expect(SourceSchema.safeParse({ kind: 'file', ref: '   ', note: '' }).success).toBe(false);
  });

  it('trims the ref it keeps', () => {
    const parsed = SourceSchema.parse({ kind: 'file', ref: '  x  ', note: '' });
    expect(parsed.ref).toBe('x');
  });
});
