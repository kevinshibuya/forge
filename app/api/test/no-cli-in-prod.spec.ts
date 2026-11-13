import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { nodeFileTrace } from '@vercel/nft';

/**
 * Invariant 9 (ADR 0026): the production entry never reaches `@forge/engine-cli`. The spec builds
 * the api into `dist-trace/` (never the `dist/` the running watcher writes), traces every file each
 * entry can load, and looks for the workspace in the list. `main.dev` is the positive control: it
 * must reach the workspace, which is what proves the absence assertion can go red.
 */
const API = resolve(__dirname, '..');
const APP = resolve(API, '..');
const OUT = join(API, 'dist-trace');

async function traced(entry: string): Promise<string[]> {
  const { fileList } = await nodeFileTrace([join(OUT, entry)], { base: APP });
  return [...fileList];
}

describe('the production entry never loads @forge/engine-cli', () => {
  beforeAll(() => {
    execFileSync('npx', ['nest', 'build', '--path', 'tsconfig.trace.json'], { cwd: API, stdio: 'pipe' });
  }, 120_000);

  it('main (the api backend) has no file of the cli workspace in its trace', async () => {
    const files = await traced('main.js');
    expect(files.some((f) => f.endsWith('api/dist-trace/bootstrap.js'))).toBe(true);
    expect(files.filter((f) => f.includes('engine-cli/'))).toEqual([]);
  }, 60_000);

  it('main.dev (the cli backend) reaches the cli workspace, so the check above can fail', async () => {
    const files = await traced('main.dev.js');
    expect(files).toContain('engine-cli/dist/index.js');
  }, 60_000);
});
