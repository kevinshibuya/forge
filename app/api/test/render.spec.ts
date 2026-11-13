import { describe, expect, it, afterAll } from 'vitest';
import { PlaywrightRenderer } from '../src/images/render.service';

const renderer = new PlaywrightRenderer();
afterAll(() => renderer.onModuleDestroy());

function pngSize(buf: Buffer): { w: number; h: number } {
  // PNG signature then IHDR: width @16, height @20 (big-endian).
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('PlaywrightRenderer', () => {
  it('renders HTML to a PNG of the requested size', async () => {
    const html = '<!doctype html><html><body style="margin:0"><div style="width:100%;height:100%;background:#111822"></div></body></html>';
    const buf = await renderer.render(html, { width: 1200, height: 1200 });
    expect(pngSize(buf)).toEqual({ w: 1200, h: 1200 });
  }, 30000);
});
