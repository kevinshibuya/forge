import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFUSAL } from '@forge/shared';
import { pdfText } from './pdf-text';

const fixture = (name: string) => readFile(path.join(__dirname, '..', '..', 'test', 'fixtures', 'inputs', name));

describe('pdfText', () => {
  it('reads the text layer of a real pdf', async () => {
    const result = await pdfText(await fixture('one-page.pdf'));
    if (!result.ok) throw new Error(`expected text, got ${result.refused}`);
    expect(result.text).toContain('inputs fixture, page one');
  });

  it('refuses a scan, which would stage a manifest entry the model cannot read', async () => {
    expect(await pdfText(await fixture('scanned.pdf'))).toEqual({ ok: false, refused: REFUSAL.noPdfText });
  });

  it('refuses bytes that are not a pdf at all', async () => {
    expect(await pdfText(Buffer.from('not a pdf'))).toEqual({ ok: false, refused: REFUSAL.noPdfText });
  });
});
