#!/usr/bin/env node
// Builds the seed post's image: post-assets/idle-transaction.html and post-assets/idle-transaction.png.
//
//   node scripts/make-seed-asset.mjs        (from app/api, Node 22 or later)
//
// The seed inserts this pair as post #1's selected html-lane asset. The PNG is a neutral
// placeholder, not a render of the HTML: a dark square with one lighter panel, drawn pixel by
// pixel so the script needs no browser and no dependencies. A re-run writes identical bytes.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const OUT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../post-assets');
const SIZE = 1200;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>the idle transaction</title>
<style>
  html, body { margin: 0; }
  body { width: 1200px; height: 1200px; background: #111822; color: #f6f9fc;
         font-family: system-ui, sans-serif; display: grid; place-items: center; }
  .panel { width: 960px; padding: 80px; box-sizing: border-box; background: #1c2633; border-radius: 24px; }
  h1 { font-size: 88px; margin: 0 0 32px; font-weight: 700; }
  p { font-size: 36px; line-height: 1.4; margin: 0; color: rgba(246, 249, 252, 0.65); }
</style>
</head>
<body>
  <div class="panel">
    <h1>the idle transaction</h1>
    <p>17 of 20 pooled connections sat idle inside a transaction. A 5-second timeout fixed it.</p>
  </div>
</body>
</html>
`;

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A SIZE x SIZE RGB PNG: #111822 background, a #1c2633 panel inset by 120 px. */
function placeholderPng() {
  const row = 1 + SIZE * 3;
  const raw = Buffer.alloc(row * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const inPanel = x >= 120 && x < SIZE - 120 && y >= 120 && y < SIZE - 120;
      const [r, g, b] = inPanel ? [0x1c, 0x26, 0x33] : [0x11, 0x18, 0x22];
      const at = y * row + 1 + x * 3;
      raw[at] = r; raw[at + 1] = g; raw[at + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'idle-transaction.html'), HTML);
await writeFile(path.join(OUT_DIR, 'idle-transaction.png'), placeholderPng());
console.log(`wrote ${path.join(OUT_DIR, 'idle-transaction.{html,png}')}`);
