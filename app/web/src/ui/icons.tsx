import type { SVGProps } from 'react';

/**
 * Hand-rolled ink-outline glyphs (Bench illustration grammar): 20px box, 1.5px
 * stroke in `currentColor`, round joins, no fills, no icon library. Used ONLY in
 * the nav rail and the shell's bottom cluster — never beside list items.
 */
export type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/* ---- destinations ---- */

/** overview — a panelled board */
export const OverviewIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.25" />
    <path d="M2.75 8h14.5M8.25 8v8.75" />
  </svg>
);

/** backlog — a stacked queue */
export const BacklogIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="2.75" y="10.5" width="14.5" height="6.25" rx="1.75" />
    <path d="M4.75 7.75h10.5M6.75 5h6.5" />
  </svg>
);

/** planner — a month grid */
export const PlannerIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="2.75" y="4.25" width="14.5" height="12.5" rx="2.25" />
    <path d="M2.75 8.25h14.5M6.75 2.75v3M13.25 2.75v3" />
    <path d="M6.5 11.75h.01M10 11.75h.01M13.5 11.75h.01" />
  </svg>
);

/** posts — a written page */
export const PostsIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4.25 2.75h7.5l4 4v10.5H4.25z" />
    <path d="M11.5 2.9V6.75h3.85M7 10.5h6M7 13.5h4" />
  </svg>
);

/** analytics — magnitude bars */
export const AnalyticsIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M2.75 17.25h14.5M5.75 17.25v-4.5M10 17.25V6.5M14.25 17.25v-7" />
  </svg>
);

/** playbook — an open book */
export const PlaybookIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M10 5.75C8.6 4.6 6.9 4.1 4.25 4.25v10.5c2.65-.15 4.35.35 5.75 1.5 1.4-1.15 3.1-1.65 5.75-1.5V4.25c-2.65-.15-4.35.35-5.75 1.5z" />
    <path d="M10 5.75v10.5" />
  </svg>
);

/** runs — an activity trace */
export const RunsIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M2.75 10.5h3l2-5 3.5 10 2.25-5h3.75" />
  </svg>
);

/** settings — two sliders */
export const SettingsIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M3 7h5.25M11.75 7H17M3 13h1.75M8.25 13H17" />
    <circle cx="10" cy="7" r="1.75" />
    <circle cx="6.5" cy="13" r="1.75" />
  </svg>
);

/* ---- shell chrome ---- */

/** the forge mark: a circular ink ring around a solid core */
export const LogoMark = (props: IconProps) => (
  <svg {...base} strokeWidth={1.75} {...props}>
    <circle cx="10" cy="10" r="7.75" />
    <circle cx="10" cy="10" r="3.25" fill="currentColor" stroke="none" />
  </svg>
);

/** chevron, pointing left (collapse); rotate 180° for expand. The shell animates that rotation
 *  on the same duration/curve as the rail's width — keep the two in step if either changes. */
export const ChevronIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12.25 4.75 7 10l5.25 5.25" />
  </svg>
);

/** sun — switch to light */
export const SunIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="10" cy="10" r="3.5" />
    <path d="M10 1.75v1.75M10 16.5v1.75M18.25 10H16.5M3.5 10H1.75M15.83 4.17l-1.24 1.24M5.41 14.59l-1.24 1.24M15.83 15.83l-1.24-1.24M5.41 5.41 4.17 4.17" />
  </svg>
);

/** moon — switch to dark */
export const MoonIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M16.25 12.4A6.9 6.9 0 0 1 7.6 3.75a6.9 6.9 0 1 0 8.65 8.65z" />
  </svg>
);
