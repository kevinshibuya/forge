import type { ReactNode, SVGProps } from 'react';

/**
 * One cell of the hero's 2x2 "main metrics" panel (Dribbble spine: ink-outline glyph in a
 * hairline ring, huge number, lowercase soft label, hairline divider, one sub-metric line).
 * Renders on `--color-hero-panel` via the band's `data-surface="dark"` scope.
 */
export function HeroStatCard({
  icon, value, label, sub,
}: { icon: ReactNode; value: string; label: string; sub: string }) {
  return (
    <div data-probe="hero-stat-card" className="flex h-full min-w-0 flex-col p-6">
      <div className="flex items-center gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline text-ink">
          {icon}
        </span>
        <span className="truncate text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
          {value}
        </span>
      </div>
      <div className="mt-3 truncate text-[13px] lowercase text-soft" title={label}>{label}</div>
      <div className="mt-auto truncate border-t border-hairline-soft pt-3.5 text-[12px] lowercase text-soft" title={sub}>
        {sub}
      </div>
    </div>
  );
}

/* ---- the four hero glyphs (Bench illustration grammar; the shell's `icons.tsx` owns the
       nav rail, this file owns the hero panel — the only two places icons are allowed) ---- */

const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  className: 'size-[17px]',
} as const;

type GlyphProps = SVGProps<SVGSVGElement>;

/** impressions — an eye */
export const ImpressionsGlyph = (props: GlyphProps) => (
  <svg {...base} {...props}>
    <path d="M1.75 10S4.75 4.75 10 4.75 18.25 10 18.25 10 15.25 15.25 10 15.25 1.75 10 1.75 10z" />
    <circle cx="10" cy="10" r="2.25" />
  </svg>
);

/** engagements — a reply bubble */
export const EngagementsGlyph = (props: GlyphProps) => (
  <svg {...base} {...props}>
    <path d="M16.75 11.5a1.75 1.75 0 0 1-1.75 1.75H7.5L4 16.25V5.5a1.75 1.75 0 0 1 1.75-1.75H15a1.75 1.75 0 0 1 1.75 1.75z" />
  </svg>
);

/** new followers — a person with a plus */
export const NewFollowersGlyph = (props: GlyphProps) => (
  <svg {...base} {...props}>
    <circle cx="8" cy="6.75" r="2.75" />
    <path d="M2.75 16.25c0-2.9 2.35-4.75 5.25-4.75s5.25 1.85 5.25 4.75" />
    <path d="M15.5 5.25v4.5M17.75 7.5h-4.5" />
  </svg>
);

/** followers total — a stacked pair */
export const FollowersTotalGlyph = (props: GlyphProps) => (
  <svg {...base} {...props}>
    <circle cx="7.75" cy="6.75" r="2.75" />
    <path d="M2.5 16.25c0-2.9 2.35-4.75 5.25-4.75s5.25 1.85 5.25 4.75" />
    <path d="M13.25 4.4a2.75 2.75 0 0 1 0 5.2M15 11.9c1.55.55 2.5 1.9 2.5 3.6" />
  </svg>
);
