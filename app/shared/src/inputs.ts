/** Every kind a stored Input row can carry. `file` is bytes we hold, `url` is a page we fetched
 *  once. `path` was a place on this machine; ADR 0017 amended retired it, and it stays in the enum
 *  only for the rows attached before slice 2, which slice 12 converts. */
export const INPUT_KINDS = ['file', 'url', 'path'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** What an operator may attach today. */
export const ATTACHABLE_INPUT_KINDS = ['file', 'url'] as const;

/** The allowlist of text-like extensions, lower case and without the dot. */
export const INPUT_TEXT_EXTENSIONS: readonly string[] = [
  'md', 'mdx', 'txt', 'markdown', 'json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'xml', 'html',
  'css', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'lua', 'sh', 'zsh', 'bash', 'sql', 'ini', 'cfg', 'conf',
];

/** Text files that carry no extension at all. Matched whole and case-sensitively, the way the
 *  filesystem writes them. */
export const INPUT_TEXT_BASENAMES: readonly string[] = ['Makefile', 'Dockerfile', 'README', 'LICENSE'];

/** What a dropped file may be. A PDF is converted to text at attach, so it is droppable without
 *  being text-like: under a `path` it is skipped like any other binary. */
export const INPUT_FILE_EXTENSIONS: readonly string[] = [...INPUT_TEXT_EXTENSIONS, 'pdf'];

/** The basename in INPUT_TEXT_BASENAMES, or the extension in INPUT_TEXT_EXTENSIONS. A name whose
 *  only dot leads it, `.env`, has no extension and is not text-like. */
export function isTextLike(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1);
  if (INPUT_TEXT_BASENAMES.includes(base)) return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return INPUT_TEXT_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}

/** Per input, counted over the files that would actually be staged. Over the cap is a refusal
 *  naming the numbers, never a truncation, so a manifest is never a surprise subset. */
export const INPUT_CAPS = { files: 200, bytes: 5 * 1024 * 1024 } as const;

export const URL_FETCH = { timeoutMs: 15_000, maxBytes: INPUT_CAPS.bytes, maxRedirects: 5 } as const;

/**
 * The body-parser limit for a pasted text. It exists to bound a request, never to decide the cap:
 * the producer does that, by sentence.
 *
 * Sized at more than TWICE INPUT_CAPS.bytes because JSON escaping inflates the body. A quote or a
 * backslash costs two bytes, a newline costs two, a control character costs six, so a text of
 * quotes or newlines alone doubles. At 6mb a legitimate 5 MB paste that was a fifth quotes was
 * refused with a 413 before the producer ever saw it, and the operator was told it was over a cap
 * it was under.
 */
export const INPUT_JSON_LIMIT = '12mb';

/** One staged file, as the legacy columns `runs.staged_manifest` and `runs.staged_inputs` hold it.
 *  Read-only since slice 2, written by no code path, dropped in slice 12's contract migration. */
export interface StagedManifestEntry {
  path: string;
  bytes: number;
}

export interface InputManifest {
  files: StagedManifestEntry[];
  bytes: number;
  skipped: number;
  refused: string[];
}

/** One input as a run saw it, persisted as runs.staged_inputs. `root` is relative to the staged
 *  key directory, so the manifest and the folder agree without an ordinal. */
export interface StagedInput extends InputManifest {
  inputId: number;
  kind: InputKind;
  ref: string;
  root: string;
}

/** Preview never throws for a refusal: the union is the answer, and only attach turns the
 *  refusal into a 422. */
export type InputPreview =
  | { ok: true; kind: InputKind; ref: string; manifest: InputManifest }
  | { ok: false; refused: string };

/** A whole text must be one line to count as a url or a path. A multi-line paste is a file even
 *  when its first line is a link, which is what makes "paste an article" work. */
export function inferInputKind(text: string): InputKind {
  const trimmed = text.trim();
  if (trimmed.includes('\n')) return 'file';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'url';
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return 'path';
  return 'file';
}

/** Names a pasted text after its first non-empty line. The ref is a display name and may hold
 *  anything; the storage name is derived from it and sanitised where the file is written. */
export function pastedTextRef(text: string, taken: readonly string[]): string {
  const first = text.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  const base = first === undefined ? 'pasted text' : first.slice(0, 60);
  if (!taken.includes(base)) return base;
  // Among base and the next taken.length + 1 numbered candidates, one is always free.
  for (let n = 2; n <= taken.length + 2; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base} ${taken.length + 2}`;
}

/** 1024-based. Bytes print whole, larger units to one decimal with a trailing zero dropped, so
 *  the cap reads as "5 MB" and a real measurement reads as "4.2 MB". */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} b`;
  const units = ['kB', 'MB', 'GB'] as const;
  let value = n / 1024;
  let unit: string = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i]!;
  }
  return `${value.toFixed(1).replace(/\.0$/, '')} ${unit}`;
}

/** One sentence, lower case, no trailing period, naming what the operator would change. Every
 *  producer reuses these verbatim, so the web can match on them and the api never invents one. */
export const REFUSAL = {
  pathRetired: 'a path on this machine cannot be an input any more; drop the file or paste its text',
  notText: (name: string) => `${name} is not a text file`,
  badName: 'a file name cannot contain a path separator',
  // Exact bytes on purpose: at the boundary a rounded "5.0 MB, the cap is 5 MB" reads as no refusal.
  overBytes: (n: number) => `${n.toLocaleString('en-US')} bytes, the cap is ${fmtBytes(INPUT_CAPS.bytes)}`,
  privateAddress: (host: string) => `${host} resolves to a private or local address`,
  cannotResolve: (host: string) => `${host} does not resolve; check the link`,
  badScheme: 'only http and https links can be inputs',
  fetchFailed: (status: number) => `the page answered ${status}`,
  fetchTimeout: `the page did not answer within ${URL_FETCH.timeoutMs / 1000} s`,
  tooManyRedirects: `the page redirected more than ${URL_FETCH.maxRedirects} times`,
  notTextPage: (type: string) => `not a text page (${type})`,
  noArticle: 'no article text found on that page',
  noPdfText: 'no text in this PDF',
  oneAtATime: 'one file at a time',
  duplicate: (ref: string) => `${ref} is already attached`,
} as const;
