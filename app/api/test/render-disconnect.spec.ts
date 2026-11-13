import { describe, it, expect, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
// vi.mock is hoisted above these imports by vitest, so PlaywrightRenderer binds to the mocked
// playwright module even with a static import (no top-level await, which tsc rejects under NodeNext).
import { PlaywrightRenderer } from '../src/images/render.service';

// Fix E: a Chromium that dies AFTER launch must not leave a dead browser cached. We mock playwright
// so we can (1) count launches and (2) emit 'disconnected' deterministically. Module mocks are
// per-file in vitest, so this does not affect the real-browser render.spec.ts.
const state = vi.hoisted(() => ({ launches: 0, emitters: [] as EventEmitter[] }));

vi.mock('playwright', async () => {
  const { EventEmitter } = await import('node:events');
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  class FakeBrowser extends EventEmitter {
    async newContext() {
      return {
        newPage: async () => ({
          setContent: async () => undefined,
          evaluate: async () => true,
          screenshot: async () => PNG_SIG,
        }),
        close: async () => undefined,
      };
    }
    async close() { this.emit('disconnected'); }
  }
  return {
    chromium: {
      launch: vi.fn(async () => { state.launches += 1; const b = new FakeBrowser(); state.emitters.push(b); return b; }),
    },
  };
});

describe('PlaywrightRenderer disconnect recovery (fix E)', () => {
  it('caches the browser but relaunches once it disconnects mid-life', async () => {
    const renderer = new PlaywrightRenderer();
    await renderer.render('<html></html>', { width: 10, height: 10 });
    expect(state.launches).toBe(1);

    // A second render reuses the cached (still-alive) browser — no relaunch.
    await renderer.render('<html></html>', { width: 10, height: 10 });
    expect(state.launches).toBe(1);

    // Simulate a crash/disconnect after a successful launch: the cache must clear.
    state.emitters[0]!.emit('disconnected');
    await renderer.render('<html></html>', { width: 10, height: 10 });
    expect(state.launches).toBe(2);
  });
});
