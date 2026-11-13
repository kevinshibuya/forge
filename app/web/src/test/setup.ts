import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';

// Extend explicitly rather than importing '@testing-library/jest-dom/vitest'.
// That entry does `import { expect } from 'vitest'` from its own location, and
// jest-dom hoists to app/node_modules where the vitest is 2.1.9 (shared/api's
// copy) — so it extends an expect this run never uses and every matcher fails
// with "Invalid Chai property". Extending from here resolves web's vitest 4.
// The matching type augmentation lives in ./jest-dom.d.ts, for the same reason.
expect.extend(jestDomMatchers);

// jsdom has no matchMedia, and motion's useReducedMotion() calls it on every
// render — without this stub every spec touching a Skeleton or a chart throws.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = () =>
    ({
      matches: false,
      media: '',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no ResizeObserver, and TellOverlay observes its textarea so marks re-measure when the
// resize handle is dragged. A no-op stub is enough: jsdom does no layout, so a real one would
// never fire anyway, and every overlay spec mocks the measurement outright.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// RTL registers its own auto-cleanup only when a global `afterEach` exists at
// import time. `globals: false` means there is none, so without this every
// multi-case spec queries a DOM still holding the previous case's tree.
afterEach(cleanup);

// NOT set here: `MotionGlobalConfig.skipAnimations = true`. It looks like the right cure for the
// standing rAF tax of every Skeleton pulsing at `repeat: Infinity` in jsdom, but it was tried
// (2026-09-02, PR #13 review fix pass) and broke four specs — hashtag-editor and selection-refine
// timed out at 5s and attach-picker could not find its rows. Completing a repeat:Infinity
// animation instantly appears to re-arm it in a tight loop. The pulse tax is the lesser problem.
