import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { PostStatus } from '@forge/shared';
import type { Tier } from '../api/client';

export const PageHeader = ({ label, sub }: { label: string; sub?: string }) => (
  <header className="mb-8 border-b border-hairline pb-6">
    <h1 className="text-[clamp(2rem,4vw,3.2rem)] font-bold lowercase leading-[0.95] tracking-[-0.033em] text-ink">
      {label}
    </h1>
    {sub && <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed lowercase text-soft">{sub}</p>}
  </header>
);

export const Panel = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-card border border-hairline bg-paper p-5 ${className}`}>{children}</section>
);

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-card border border-hairline bg-paper p-4 ${className}`}>{children}</div>
);

/**
 * Same-specificity Tailwind utilities resolve by STYLESHEET order, not by the order they appear in
 * `class`, so a hardcoded default silently beats a caller's override — `<Pill className="bg-bone">`
 * rendered paper anyway. Drop each default whose slot the caller fills, so the override lands.
 * The size utilities (`text-[11px]`) and spacing (`pr-1.5`) are deliberately not matched.
 */
const overridden = (className: string, slot: RegExp) => slot.test(className);
const BG = /(^|\s)bg-/;
const BORDER = /(^|\s)border-[a-z]/;
const TEXT = /(^|\s)text-[a-z]/;

export const Pill = ({ children, className = '' }: { children: ReactNode; className?: string }) => {
  const bg = overridden(className, BG) ? '' : 'bg-paper';
  const border = overridden(className, BORDER) ? '' : 'border-hairline';
  const text = overridden(className, TEXT) ? '' : 'text-soft';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-[11px] font-medium lowercase ${bg} ${border} ${text} ${className}`}>
      {children}
    </span>
  );
};

const TIER_STYLES: Record<Tier, string> = {
  T1: 'border-ink bg-ink text-bone',
  T2: 'border-hairline bg-paper text-ink',
  T3: 'border-hairline-soft bg-paper text-soft',
};
// data codes (T1/T2/T3, urns, run ids) are exempt from the lowercase rule — only UI copy lowercases (phase-4 §5.3)
export const TierBadge = ({ tier }: { tier: Tier }) => (
  <span className={`inline-flex rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.06em] ${TIER_STYLES[tier]}`}>
    {tier}
  </span>
);

const STATUS_DOTS: Record<PostStatus, string> = {
  // Re-differentiated by FILL, not hue (phase-4 §5.5): the palette has two accents, so the
  // distinctions ride hollow-vs-solid. `queued` is an ink-outlined hollow dot — visible in both
  // themes because --ink flips with the theme, unlike the old near-invisible hairline fill.
  queued: 'border border-ink bg-transparent',
  drafting: 'bg-salmon animate-pulse',
  draft_ready: 'bg-salmon',
  approved: 'bg-mint',
  published: 'bg-ink',
  measured: 'bg-ink',
};
export const StatusPill = ({ status }: { status: PostStatus }) => (
  <Pill>
    <span className={`size-1.5 rounded-full ${STATUS_DOTS[status]}`} />
    {status.replace('_', ' ')}
  </Pill>
);

/**
 * Disabled state (phase-4 §4 check 4). `opacity-40` composited the WHOLE element, collapsing a
 * disabled solid button to ≈2.6:1 in light and ≈3.2:1 in dark — the label became unreadable rather
 * than merely inert. Instead the variant's colours are replaced outright: the control recedes to
 * the page ground (`bone`) behind a soft hairline, and the label stays `soft` — ≥5.6:1 in light,
 * ≥7.5:1 in dark, and the same inside the `data-surface="dark"` scope, where `bone` re-points to
 * `hero`. `border border-transparent` on the base is what lets that hairline render on `solid`
 * (which carries no border of its own) and incidentally makes all three variants the same height.
 */
const DISABLED = 'disabled:cursor-not-allowed disabled:border-hairline-soft disabled:bg-bone disabled:text-soft disabled:hover:opacity-100';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' | 'subtle' };
export const Button = ({ variant = 'solid', className = '', ...props }: ButtonProps) => {
  // Exactly ONE border-colour utility per variant: two of equal specificity would resolve by
  // stylesheet order, not by the order written here (the same trap `Pill` fell into).
  const styles = {
    solid: 'border-transparent bg-ink text-bone hover:opacity-80',
    ghost: 'border-hairline text-ink hover:bg-paper',
    subtle: 'border-hairline-soft bg-paper text-soft hover:text-ink',
  }[variant];
  return (
    <button
      className={`rounded-pill border px-4 py-1.5 text-[13px] font-semibold lowercase transition-colors ${DISABLED} ${styles} ${className}`}
      {...props}
    />
  );
};

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block">
    <div className="mb-1 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">{label}</div>
    {children}
  </label>
);

export const inputCls =
  'w-full rounded-card border border-hairline bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-soft';

/** The `inputCls` idiom at chip scale: same border/typography, pill-shaped and content-width. */
// Disabled follows the `Button` rule (§4 check 4): recede to the page ground behind a soft
// hairline rather than composite the whole chip to 40%, which left the tag unreadable mid-PATCH.
export const chipInputCls =
  'rounded-full border border-hairline bg-paper px-3 py-1 text-[11px] font-medium lowercase text-ink outline-none placeholder:text-soft/60 focus:border-ink disabled:cursor-not-allowed disabled:border-hairline-soft disabled:bg-bone disabled:text-soft';

/** In-place status only — never a page or region gate (ADR 0014). */
export const Spinner = () => (
  <span
    data-probe="spinner"
    className="inline-block size-4 animate-spin rounded-full border-2 border-hairline border-t-salmon"
  />
);

export const EmptyState = ({ children }: { children: ReactNode }) => (
  <div className="rounded-card border border-dashed border-hairline-soft p-10 text-center text-[14px] lowercase text-soft">
    {children}
  </div>
);

/**
 * The salmon lead lives HERE, not at the call sites, so "failure = salmon" survives the next
 * `ErrorNote` someone adds. `label` is REQUIRED on purpose: a default let call sites keep their
 * own lead inside `children`, which put the hue on the generic word "error" and left the actual
 * meaning in ink — the exact inversion this prop exists to prevent.
 * The lead carries weight as well as hue, because hue alone cannot carry it: salmon is ~2.3:1 on
 * light paper, fine as a short accent but unreadable as body copy, so the detail stays `text-ink`.
 * `WarnBanner` below stays deliberately hueless — spec §5.6 removed its lead on purpose.
 */
export const ErrorNote = ({ label, children, inline = false }: {
  label: string; children?: ReactNode;
  /**
   * Field scale: the same rule without the card chrome, for a validation message under an input.
   * A panel-level failure and a "that number is out of range" must not shout equally loudly, and
   * three bordered cards inside one settings form flatten that hierarchy. The variant lives here
   * rather than at the call sites for the same reason `label` is required — so the next field
   * error inherits the contrast rule instead of re-inventing salmon body copy.
   */
  inline?: boolean;
}) => (
  <div className={inline
    // No `lowercase` here, unlike the field-error divs this replaced: the label can be a
    // user-typed identifier (a pricing row's model name), and the input two pixels above shows
    // it with its real case. Every message that reaches this is already authored lowercase, so
    // the transform only ever reached the label — where it renamed the thing being reported.
    ? 'mt-1 text-[12px] text-ink'
    : 'rounded-card border border-hairline bg-paper px-4 py-3 text-[13px] text-ink'}>
    <span className="font-semibold text-salmon">{label}</span>
    {children !== undefined && <> · {children}</>}
  </div>
);

export const WarnBanner = ({ children }: { children: ReactNode }) => (
  <div className="rounded-card border border-hairline bg-paper px-4 py-3 text-[13px] lowercase text-ink">
    {children}
  </div>
);
