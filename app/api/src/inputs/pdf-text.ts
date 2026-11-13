import { REFUSAL } from '@forge/shared';

/** What a converter answers: text we can stage, or one sentence saying why not. Shared by the
 *  PDF converter and the url reader, which is itself one of the PDF converter's callers. */
export type Converted = { ok: true; text: string; title?: string } | { ok: false; refused: string };

/**
 * A PDF's text layer, or a refusal. `unpdf` ships a CommonJS build, so the dynamic import here
 * resolves under the api's NodeNext setup and `pdf-parse` is not needed.
 *
 * A scan has no text layer and yields whitespace, which is a refusal rather than an empty input:
 * staging nothing would leave the operator with a manifest entry the model cannot use.
 */
export async function pdfText(buf: Buffer): Promise<Converted> {
  const { extractText } = await import('unpdf');
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  let text: string;
  try {
    const result = await extractText(bytes, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join('\n') : result.text;
  } catch {
    return { ok: false, refused: REFUSAL.noPdfText };
  }

  if (text.trim().length === 0) return { ok: false, refused: REFUSAL.noPdfText };
  return { ok: true, text: text.replace(/\n{3,}/g, '\n\n').trim() };
}
