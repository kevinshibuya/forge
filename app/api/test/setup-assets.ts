import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs before each test file. assetsRoot() reads process.env.ASSETS_ROOT lazily, so this
// redirects ALL image file-writes to a throwaway temp dir. Specs that need a known root
// (e.g. the asset-store test) may still override process.env.ASSETS_ROOT at their own top.
process.env.ASSETS_ROOT = mkdtempSync(join(tmpdir(), 'forge-assets-'));

// Same reasoning for the Inputs store: inputsRoot() reads process.env.INPUTS_ROOT lazily, so
// every attach in the suite writes into a throwaway dir instead of the repo's uploads/.
process.env.INPUTS_ROOT = mkdtempSync(join(tmpdir(), 'forge-inputs-'));
