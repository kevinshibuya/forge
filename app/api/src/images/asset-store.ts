import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { NotFoundException } from '@nestjs/common';

const REPO_ROOT = join(process.cwd(), '..', '..');

export function assetsRoot(): string {
  return process.env.ASSETS_ROOT ?? join(process.cwd(), 'uploads', 'assets');
}

export function newGroupId(): string {
  return randomUUID();
}

export function candidateDir(postId: number, groupId: string): string {
  return join(assetsRoot(), String(postId), groupId);
}

/** The whole of `uploads/assets/<postId>/`, every candidate group and patch dir under it.
 *  Never an individual png_path: a legacy path into <repo>/post-assets is not under this root. */
export async function removePostAssets(postId: number): Promise<void> {
  if (!Number.isInteger(postId) || postId <= 0) throw new Error(`refusing to remove assets for post id ${postId}`);
  await rm(join(assetsRoot(), String(postId)), { recursive: true, force: true });
}

export async function writePng(dir: string, index: number, buf: Buffer): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${index}.png`);
  await writeFile(path, buf);
  return path;
}

export async function listPngs(dir: string): Promise<string[]> {
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.png')).sort().map((n) => join(dir, n));
}

function within(root: string, abs: string): boolean {
  const rel = relative(resolve(root), resolve(abs));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function resolveAssetFile(pngPath: string): string {
  const abs = isAbsolute(pngPath) ? pngPath : join(REPO_ROOT, pngPath);
  // Canonicalize BOTH the target and the allowed roots (following symlinks) before the lexical
  // containment check: a symlink living inside ASSETS_ROOT but pointing OUTSIDE it passes a purely
  // lexical check yet must be rejected. realpathSync throws for a missing file/broken link -> 404.
  let real: string;
  try { real = realpathSync(abs); }
  catch { throw new NotFoundException(`asset file not found: ${pngPath}`); }
  const roots = [assetsRoot(), join(REPO_ROOT, 'post-assets')]
    .map((r) => { try { return realpathSync(r); } catch { return null; } })
    .filter((r): r is string => r !== null);
  // Containment is checked against the CANONICAL (symlink-resolved) paths so a link inside the root
  // pointing outside is rejected; the ORIGINAL abs path is returned so legitimate callers see the
  // path they passed (realpathSync would otherwise rewrite e.g. /var -> /private/var on macOS).
  if (!roots.some((r) => within(r, real))) {
    throw new NotFoundException(`asset file outside allowed roots: ${pngPath}`);
  }
  return abs;
}

/**
 * The textless background sibling of a hybrid candidate's composite PNG.
 * pngPath may be repo-relative (the storage contract resolveAssetFile supports) —
 * absolutize against REPO_ROOT before taking the dirname (codex-review catch).
 */
export function bgPathFor(pngPath: string): string {
  const abs = isAbsolute(pngPath) ? pngPath : join(REPO_ROOT, pngPath);
  return join(dirname(abs), 'bg.png');
}

/** Validate a PNG by signature and return its real dimensions from the IHDR (null if not a readable PNG). */
export async function readPngSize(path: string): Promise<{ w: number; h: number } | null> {
  try {
    const fd = await open(path, 'r');
    try {
      const buf = Buffer.alloc(24);
      const { bytesRead } = await fd.read(buf, 0, 24, 0);
      if (bytesRead < 24) return null;
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (!buf.subarray(0, 8).equals(sig)) return null;
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    } finally { await fd.close(); }
  } catch { return null; }
}
