// Mimics `codex exec` writing gpt-image-2 output: N 1×1 PNGs into cwd. Count via STUB_IMAGE_COUNT (default 3).
import { writeFileSync } from 'node:fs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const n = Number(process.env.STUB_IMAGE_COUNT ?? '3');
for (let i = 0; i < n; i++) writeFileSync(`${i}.png`, PNG);
process.stdout.write(`Generated ${n} images into the current directory\n`);
process.exit(0);
