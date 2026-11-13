const TZ = 'America/Sao_Paulo';

export const fmtDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(iso)).toLowerCase();

export const fmtDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso)).toLowerCase();

/**
 * A `YYYY-MM-DD` is a CALENDAR DAY, not an instant. `new Date('2026-08-12')` parses as UTC
 * midnight, which is 2026-08-11 21:00 in São Paulo — every date-only value would render a day
 * early. Split the string and build the Date from LOCAL parts instead, then format WITHOUT a
 * timeZone (the parts are already the day we mean; converting again would re-introduce the shift).
 */
const localDay = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** 'aug 12' — for a date-only `YYYY-MM-DD`. Never pass an instant here; use `fmtDay`. */
export const fmtDateOnly = (date: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(localDay(date)).toLowerCase();

/** 'wed' — the weekday of a date-only `YYYY-MM-DD`. */
export const fmtWeekdayShort = (date: string): string =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(localDay(date)).toLowerCase();

/** 'august 2026' — the month a date-only `YYYY-MM-DD` falls in. */
export const fmtMonthYear = (date: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(localDay(date)).toLowerCase();

/** Weekday of a date-only `YYYY-MM-DD`, monday = 0 (the week the server anchors on). */
export const dayIndexMonday = (date: string): number => (localDay(date).getDay() + 6) % 7;

/** Today as `YYYY-MM-DD` in the operating timezone — 'sv-SE' is ISO-shaped by definition. */
export const todayIso = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

/** Shift a date-only `YYYY-MM-DD` by whole days/months, staying in calendar space. */
export const addDays = (date: string, days: number): string => {
  const d = localDay(date);
  d.setDate(d.getDate() + days);
  return isoOf(d);
};
export const addMonths = (date: string, months: number): string => {
  const d = localDay(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return isoOf(d);
};
const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmtNum = (n: number): string => new Intl.NumberFormat('en-US').format(Math.round(n));

export const daysLeft = (iso: string): number =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

export const durationS = (startIso: string, endIso: string | null): string =>
  endIso ? `${Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000)}s` : '…';

/**
 * Estimated cost. Four decimals because a single run lives in the cents, and a nonzero cost that
 * would round to $0.0000 says so instead of reading as free.
 */
export const fmtUsd = (usd: number): string => (usd > 0 && usd < 0.0001 ? '<$0.0001' : `$${usd.toFixed(4)}`);

/** Display-only: shrink embedded base64 image data-URIs so a prompt/output pane doesn't bloat the viewer. */
export const elideDataUris = (text: string): string =>
  text.replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, 'data:image/…;base64,…[elided]');
