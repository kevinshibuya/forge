import { useEffect, useRef } from 'react';
import { useReducedMotion, type Transition } from 'motion/react';

/**
 * The one motion vocabulary. Durations are SECONDS here (motion's unit) and
 * milliseconds in `index.css` — the same values, two units; change both.
 *
 * Reduced motion is not "shorter": `useDurations()` returns zeros, and the
 * load-in's `initial` collapses to `false`, so a bar lands at its final size
 * without ever painting a frame at 0%. See ADR 0014.
 */

/**
 * Mirrors `--ease-standard`. A mutable tuple on purpose: motion's `Easing`
 * accepts `[number, number, number, number]`, and a readonly tuple does not
 * assign to it.
 */
export const EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1];

export const DUR = {
  standard: 0.24,
  slow: 0.36,
  loadIn: 0.5,
  draw: 0.7,
  fade: 0.15,
  pulse: 1.6,
} as const;

/** Delay between one bar's load-in and the next, within one chart. */
export const STAGGER = 0.04;

/**
 * Bars past the 12th share the 12th's delay. Without the cap a 30-row bar list
 * would still be growing 1.2s after the rest of the page settled.
 */
export const STAGGER_CAP = 12;

export type Durations = { [K in keyof typeof DUR]: number };

const ZERO_DURATIONS: Durations = {
  standard: 0,
  slow: 0,
  loadIn: 0,
  draw: 0,
  fade: 0,
  pulse: 0,
};

/**
 * `DUR`, or all zeros under reduced motion. `MotionConfig reducedMotion="user"`
 * only suppresses transform and layout animation, so anything animating width,
 * height, opacity or pathLength has to zero its own durations.
 */
export function useDurations(): Durations {
  return useReducedMotion() ? ZERO_DURATIONS : DUR;
}

export type LoadIn = {
  transition: (index: number) => Transition;
  /** The `initial` prop for a bar: `from` on the mount render with motion enabled, `false` otherwise. */
  initial: <V>(from: V) => V | false;
};

/**
 * A graph grows in once per mount, warm or cold; a later data change
 * interpolates and never replays the grow.
 *
 * The mount render sees `mounted.current === false` and hands every bar its
 * staggered load-in. Any later render — a data change, or a row that mounts
 * after the chart is up — gets `initial: false` and the plain `slow`
 * interpolation. StrictMode's double-run of the effect leaves the ref `true`,
 * which is what we want.
 */
export function useLoadIn(): LoadIn {
  const d = useDurations();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const isMountRender = !mounted.current;
  return {
    transition: (index) =>
      isMountRender
        ? {
            duration: d.loadIn,
            ease: EASE_STANDARD,
            delay: Math.min(index, STAGGER_CAP) * (d.loadIn === 0 ? 0 : STAGGER),
          }
        : { duration: d.slow, ease: EASE_STANDARD, delay: 0 },
    initial: (from) => (isMountRender && d.loadIn > 0 ? from : false),
  };
}
