import { mkdirSync, realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isTextLike, type InputKind } from '@forge/shared';

/** Where the frozen copies of `file` and `url` inputs live, beside the asset store. A `path`
 *  input stores nothing: it is re-walked at every run so the operator's edits show up. */
export function inputsRoot(): string {
  const root = process.env.INPUTS_ROOT ?? path.join(process.cwd(), 'uploads', 'inputs');
  mkdirSync(root, { recursive: true });
  // Resolved once, here, so every path downstream is in the same form. On macOS a temp root is
  // handed out as /var/... and resolves to /private/var/..., and a containment check that
  // compared one form against the other would refuse every legitimate write.
  return realpathSync(root);
}

/**
 * A file name derived from operator text that can never be anything but a file name: no
 * separators to climb with, no leading dot to hide behind, and bounded so a long paste cannot
 * exhaust the filesystem's limit.
 */
function sanitise(ref: string): string {
  const flat = ref.replace(/[/\\\0]/g, '_').replace(/^\.+/, '').slice(0, 200);
  return flat.length === 0 ? 'pasted' : flat;
}

/**
 * The one naming rule, derived from persisted columns only, so the copy written at attach and the
 * copy read at stage agree by construction rather than by a stored name nobody re-checks.
 */
export function storedName(kind: InputKind, ref: string): string {
  if (kind === 'url') return 'page.txt';
  const s = sanitise(ref);
  if (s.toLowerCase().endsWith('.pdf')) return `${s}.txt`;   // the converted text, not the pdf
  return isTextLike(s) ? s : `${s}.txt`;
}

export function inputFolder(postId: number, inputId: number): string {
  return path.join(inputsRoot(), String(postId), String(inputId));
}

/**
 * The one containment check, on the final joined path rather than on the name alone. The asset
 * store only ever checks a path it read; this store takes a caller-supplied name, so the check
 * has to happen where the name becomes a path.
 */
export function storedPath(postId: number, inputId: number, kind: InputKind, ref: string): string {
  const root = inputsRoot();
  const joined = path.join(inputFolder(postId, inputId), storedName(kind, ref));
  const rel = path.relative(root, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to write outside the inputs root: ${joined}`);
  }
  return joined;
}

export async function writeStored(
  postId: number, inputId: number, kind: InputKind, ref: string, text: string,
): Promise<string> {
  await mkdir(inputFolder(postId, inputId), { recursive: true });
  const target = storedPath(postId, inputId, kind, ref);
  await writeFile(target, text, 'utf8');
  return target;
}

export async function removeStored(postId: number, inputId: number): Promise<void> {
  await rm(inputFolder(postId, inputId), { recursive: true, force: true });
}

/** The whole of `uploads/inputs/<postId>/`. Refuses an id that could join to the root itself. */
export async function removePostInputs(postId: number): Promise<void> {
  if (!Number.isInteger(postId) || postId <= 0) throw new Error(`refusing to remove inputs for post id ${postId}`);
  await rm(path.join(inputsRoot(), String(postId)), { recursive: true, force: true });
}
