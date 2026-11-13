import { Fragment, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useDurations } from '../lib/motion-tokens';

/**
 * Skeleton-first loading (ADR 0014). A region with no data for the current key
 * shows a layout-shaped placeholder, not a spinner; the real content then fades
 * in over the same footprint.
 */

const PULSE_OPACITY = [1, 0.55, 1];

/**
 * One placeholder block. Callers own the sizing (`h-*`, `w-*`, `aspect-*`);
 * this owns the fill and the pulse. Static under reduced motion — the pulse is
 * decoration, not status.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  const d = useDurations();
  const cls = `block rounded-[3px] bg-skeleton ${className}`;
  if (d.pulse === 0) return <span className={cls} />;
  return (
    <motion.span
      className={cls}
      animate={{ opacity: PULSE_OPACITY }}
      transition={{ duration: d.pulse, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

const LINE_WIDTHS = ['w-full', 'w-[85%]', 'w-[60%]'];

/** Text-shaped stand-in: `n` lines of ragged width, like a paragraph. */
export function SkeletonLines({ n, className = '' }: { n: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${LINE_WIDTHS[i % LINE_WIDTHS.length] ?? 'w-full'}`} />
      ))}
    </div>
  );
}

/**
 * A list-shaped stand-in: `row` repeated `rows` times. Five rows is the house default (spec
 * decision 11) — enough to read as a list, few enough not to promise a length.
 *
 * `gap` is its OWN prop rather than something a caller overrides through `className`. Tailwind
 * emits gap utilities in scale order (`.gap-1` before `.gap-2` before `.gap-3`), so a baked-in
 * `gap-2` silently beats a caller's `gap-1` while losing to `gap-3` — the same same-specificity
 * trap `primitives.tsx` documents for `Pill`. Pass the real list's spacing here, or the first real
 * row lands somewhere other than where the first skeleton row was.
 */
export function SkeletonList({
  rows = 5,
  row,
  probe,
  gap = 'gap-2',
  className = '',
}: {
  rows?: number;
  row: ReactNode;
  probe: string;
  /** The real list container's gap utility. */
  gap?: string;
  className?: string;
}) {
  return (
    <div data-probe={probe} className={`flex flex-col ${gap} ${className}`}>
      {/* Keyed by index: skeleton rows have no identity to preserve. */}
      {Array.from({ length: rows }, (_, i) => (
        <Fragment key={i}>{row}</Fragment>
      ))}
    </div>
  );
}

/**
 * A latch: true once any render of this mount has been pending.
 *
 * It is what tells a fade-in apart from a warm paint. A page that was never
 * pending (its query came from cache) must appear instantly; only a region that
 * actually showed a skeleton earns the handoff fade.
 */
// The latch belongs with Reveal, its only other consumer; splitting it into its
// own module to please fast refresh would scatter one primitive across two files.
// oxlint-disable-next-line react/only-export-components
export function useShowedSkeleton(pending: boolean): boolean {
  const showed = useRef(false);
  if (pending) showed.current = true;
  return showed.current;
}

/** The handoff fade. `enabled=false` renders the same box with no motion at all. */
export function FadeIn({
  enabled,
  className = '',
  children,
}: {
  enabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const d = useDurations();
  // `d.fade === 0` means reduced motion: return the plain box rather than mounting at opacity 0
  // and snapping to 1 a frame later. This is the handoff on EVERY skeletonised page, so it is the
  // most-trafficked instance of decision 3's "skip their initial values".
  if (!enabled || d.fade === 0) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: d.fade, ease: 'linear' }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Renders `skeleton` while the region's query is pending, then fades the real
 * content in over the same footprint. Warm mounts (never pending) paint
 * immediately, no fade.
 *
 * Two rules for callers:
 *
 * 1. **Wrap a whole region** — a `<section>` body, a list container — never a
 *    single grid cell. Both branches render a `div`, so a cell would gain a box
 *    the grid does not expect.
 * 2. **Pass the parent's spacing utility as `className`** when the loaded
 *    branch used to be a fragment of siblings inside a spaced parent
 *    (`flex flex-col gap-10`, `space-y-5`). The wrapper becomes the sibling, so
 *    without it the children lose their gap. Both branches get the same class,
 *    which is also what keeps the skeleton on the content's footprint.
 *
 * The `isError` branch belongs AHEAD of this, not inside it (ADR 0013: error
 * before empty/pending).
 *
 * No `AnimatePresence` on purpose: overlapping a skeleton exit with the content
 * entry would double the region's height mid-fade. The hard cut is deliberate.
 */
export function Reveal({
  pending,
  skeleton,
  children,
  className,
}: {
  pending: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const showed = useShowedSkeleton(pending);
  if (pending) return <div className={className}>{skeleton}</div>;
  return (
    <FadeIn enabled={showed} className={className}>
      {children}
    </FadeIn>
  );
}
