import type { Renderer } from './render.service';

// Minimal valid 1×1 PNG — enough for asset rows + streaming in tests (dimensions come from opts, not the buffer).
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export class FakeRenderer implements Renderer {
  render(): Promise<Buffer> { return Promise.resolve(ONE_PX_PNG); }
}
