import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inputsRoot, removePostInputs, writeStored } from '../src/inputs/inputs-store';

// INPUTS_ROOT is a fresh temp dir per file (test/setup-assets.ts), so ids 7 and 8 are ours alone.
describe('removePostInputs', () => {
  it("removes one post's folder whole and leaves its sibling", async () => {
    await writeStored(7, 1, 'file', 'a.md', 'x');
    const sibling = await writeStored(8, 1, 'file', 'b.md', 'y');
    await removePostInputs(7);
    expect(existsSync(join(inputsRoot(), '7'))).toBe(false);
    expect(readFileSync(sibling, 'utf8')).toBe('y');
  });

  it('is a no-op on a folder that is already gone', async () => {
    await expect(removePostInputs(7)).resolves.toBeUndefined();
  });

  it('refuses an id that could join to the root itself', async () => {
    // inputsRoot() mkdirs on every call, so "the root still exists" could never go red. The guard's
    // real job is that join(root, String(NaN)) is never handed to rm.
    const nanDir = join(inputsRoot(), 'NaN');
    mkdirSync(nanDir, { recursive: true });
    for (const id of [0, -1, 1.5, NaN]) {
      await expect(removePostInputs(id)).rejects.toThrow(String(id));
    }
    expect(existsSync(nanDir)).toBe(true);
    expect(existsSync(join(inputsRoot(), '8'))).toBe(true);
  });
});
