import { motion } from 'motion/react';
import { useLoadIn } from '../../lib/motion-tokens';

/**
 * The reachable pipeline stages for a SCHEDULED post. `published`/`measured` can never
 * appear in an `upcoming` row — publishing clears the schedule (migration 0009) — so the
 * meter has four ticks and no unreachable fifth.
 */
const STAGES = ['queued', 'drafting', 'draft_ready', 'approved'] as const;
export type TickStage = (typeof STAGES)[number];

/** Segmented 4-tick progress meter: filled ticks mint, empty ticks on the hairline-soft track. */
export function TickMeter({ stage }: { stage: TickStage }) {
  const filled = STAGES.indexOf(stage) + 1;
  const label = stage.replace('_', ' ');
  const loadIn = useLoadIn();
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]" title={label} aria-label={label}>
      {STAGES.map((s, i) =>
        // Filled ticks grow from the bottom (originY 1); the empty track stays plain, so the
        // meter fills rather than the whole strip appearing at once.
        i < filled ? (
          <motion.span
            key={s}
            className="h-3 w-[3px] bg-mint"
            style={{ originY: 1 }}
            initial={loadIn.initial({ scaleY: 0 })}
            animate={{ scaleY: 1 }}
            transition={loadIn.transition(i)}
          />
        ) : (
          <span key={s} className="h-3 w-[3px] bg-hairline-soft" />
        ),
      )}
    </span>
  );
}
