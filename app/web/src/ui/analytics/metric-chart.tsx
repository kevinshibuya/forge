import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { addDays, fmtDateOnly, fmtNum } from '../../lib/format';
import { EASE_STANDARD, useDurations } from '../../lib/motion-tokens';

/** ISO date (`YYYY-MM-DD`) + the value for that day. ONLY days that carry imported rows. */
export interface ChartPoint { date: string; value: number }

/** Split presence-only points into polyline segments: break wherever the next point is not the
 *  next calendar day — absence of data and zero must render differently (spec §1 band 1).
 *  A single-point segment renders as a dot (a one-point line is invisible). */
/* `segments` is co-located with the chart by the S4 interface contract (exported for reuse and
   inspection). The fast-refresh cost is one extra module reload on edit — not worth splitting
   the gap rule away from its only consumer. */
// oxlint-disable-next-line react/only-export-components
export function segments(points: ChartPoint[]): ChartPoint[][] {
  const out: ChartPoint[][] = [];
  let cur: ChartPoint[] = [];
  for (const p of points) {
    const prev = cur[cur.length - 1];
    if (prev && addDays(prev.date, 1) !== p.date) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/* ---- geometry ------------------------------------------------------------ */

// Plausible's plot: a wide left gutter for right-aligned y ticks, no axis spines, and the x
// tick row sitting just under the baseline. Its ~470px panel is mostly chart; 232px of plot
// is the app-scaled equivalent inside a page that carries two more bands below it.
const PAD_L = 48;
const PAD_R = 8;
const PAD_T = 10;
const PLOT_H = 232;
const X_LABEL_H = 26;
const SVG_H = PAD_T + PLOT_H + X_LABEL_H;

/**
 * Round the axis top up to a readable step. The ladder is finer than a plain 1/2/5 one because
 * this series is spiky (one 1.1k day against a 20-ish median) and a 2x round-up would push every
 * ordinary day into the bottom fifth of the plot.
 */
const LADDER = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = LADDER.find((s) => v <= s * mag) ?? 10;
  return step * mag;
}

/** Every calendar day in `start`..`end` inclusive — the x domain is the WINDOW, not the data. */
function calendarDays(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end && out.length < 4000) { out.push(d); d = addDays(d, 1); }
  return out.length > 0 ? out : [start];
}

/** `aug 12`, or `aug 12 2025` when the window straddles a year boundary (spec §5.10). */
const tickLabel = (date: string, withYear: boolean) =>
  withYear ? `${fmtDateOnly(date)} ${date.slice(0, 4)}` : fmtDateOnly(date);

/* ---- component ----------------------------------------------------------- */

type Plotted = { x: number; y: number; point: ChartPoint };

/**
 * The one chart on the page. Hand-rolled SVG, no library: 1.5px ink line per contiguous
 * segment, mint area under it, three hairlines, three date ticks. Days with no imported row
 * are simply not in `points`, so they break the line — a zero DIPS to the baseline, an absent
 * day draws nothing at all, and the two never look alike.
 */
export function MetricChart({ points, start, end, connectAll = false }: {
  points: ChartPoint[];
  start: string;
  end: string;
  /**
   * Post detail's capture series: the x axis is CAPTURE days, weeks apart, and the days between
   * them are not missing data — nobody exported that day, while the lifetime counter kept
   * climbing. Breaking the line there would draw two lone dots and read as broken. The daily
   * account series keeps the gap rule (default false): there, an absent day IS missing data.
   */
  connectAll?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The readout is held as a DATE, never as coordinates: a metric or range swap re-derives the
  // point from the new model (or drops it, if that day left the window) instead of leaving a
  // salmon dot parked at a stale y.
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const domain = useMemo(() => calendarDays(start, end), [start, end]);
  const spanYears = start.slice(0, 4) !== end.slice(0, 4);

  const model = useMemo(() => {
    const index = new Map(domain.map((d, i) => [d, i] as const));
    const inWindow = points.filter((p) => index.has(p.date));
    const top = niceMax(Math.max(...inWindow.map((p) => p.value), 0));
    const plotW = Math.max(width - PAD_L - PAD_R, 1);
    const stepX = domain.length > 1 ? plotW / (domain.length - 1) : 0;
    const xOf = (date: string) => PAD_L + (index.get(date) ?? 0) * stepX;
    const yOf = (v: number) => PAD_T + PLOT_H * (1 - v / top);
    const place = (seg: ChartPoint[]): Plotted[] =>
      seg.map((point) => ({ x: xOf(point.date), y: yOf(point.value), point }));
    const flat = place(inWindow);
    return {
      top, baseline: yOf(0), flat,
      segs: (connectAll ? [inWindow] : segments(inWindow)).map(place),
      byDate: new Map(flat.map((p) => [p.point.date, p] as const)),
    };
  }, [connectAll, domain, points, width]);

  const hover = hoverDate === null ? null : model.byDate.get(hoverDate) ?? null;

  const dur = useDurations();
  // The SVG renders only once the ResizeObserver has reported a width, so the first real paint
  // is a render or two after mount. A ref flipped in a plain mount effect would already be true
  // by the time the paths exist and the draw would never play — so the guard keys on the first
  // render that actually PRODUCED paths.
  const drawn = useRef(false);
  const hasPaths = width > 0 && model.segs.length > 0;
  useEffect(() => {
    if (hasPaths) drawn.current = true;
  }, [hasPaths]);
  // `dur.draw > 0` is part of the guard, not an afterthought: spec decision 3 requires charts to
  // collapse durations to zero AND SKIP their `initial` values, so a reduced-motion reader never
  // sees a frame at zero (an undrawn line, a transparent fill). `useLoadIn` does the same for the
  // bars. NOTE: the presence group's own `initial` keys off `isFirstDraw` INVERTED — flipping it
  // to {opacity: 0} here would reintroduce exactly the frame this removes.
  const isFirstDraw = hasPaths && !drawn.current && dur.draw > 0;

  const linePath = (seg: Plotted[]) => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = (seg: Plotted[]) => {
    const first = seg[0];
    const last = seg[seg.length - 1];
    if (!first || !last) return '';
    return `${linePath(seg)} L${last.x},${model.baseline} L${first.x},${model.baseline} Z`;
  };

  /**
   * Keyed on the DATA, never on the geometry.
   *
   * The plan called for a path morph on a same-shape data change. OBSERVED in motion 13.2.0
   * with `d` in `animate`: the attribute was written as the literal string "undefined" and the
   * browser rejected it (`Expected moveto path command`), on both /analytics and /analytics/1 —
   * route-smoke caught it. Adding a static `d` attribute alongside did not help. This records
   * what happened with THIS usage on THIS version, not a general claim that `d` is unanimatable.
   * So every data change is a crossfade instead: a new key remounts the marks group, the old one
   * fades out under the new one.
   *
   * Keying on the geometry would have been the obvious alternative and is wrong: a resize moves
   * every coordinate, so the group would remount on every frame of a drag. Dates and values are
   * resize-invariant, which leaves a resize to update `d` through React directly — the line then
   * tracks the gridlines frame for frame rather than lagging them.
   *
   * Pure, derived from this render alone: nothing is mutated during render, so StrictMode's
   * double-render cannot make it lie.
   */
  const dataKey = useMemo(
    () => model.segs.map((seg) => seg.map((p) => `${p.point.date}:${p.point.value}`).join(',')).join('|'),
    [model.segs],
  );

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const first = model.flat[0];
    if (!first) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = first;
    for (const p of model.flat) if (Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
    setHoverDate(best.point.date);
  };

  const ticks = [
    { date: domain[0] ?? start, anchor: 'start' as const },
    { date: domain[Math.floor((domain.length - 1) / 2)] ?? start, anchor: 'middle' as const },
    { date: domain[domain.length - 1] ?? end, anchor: 'end' as const },
  ];

  return (
    <div>
      {/* Corner readout instead of a floating tooltip: it never occludes the line and needs no
          positioning maths. Reserved height, so hovering does not shift the chart. */}
      <div className="mb-1 flex h-[18px] items-center justify-end text-[12px] lowercase tabular-nums">
        {hover && (
          <span className="text-ink">
            <span className="text-soft">{tickLabel(hover.point.date, spanYears)}</span>
            {' · '}
            {fmtNum(hover.point.value)}
          </span>
        )}
      </div>

      <div ref={hostRef} className="w-full">
        {width > 0 && (
          <svg
            width={width}
            height={SVG_H}
            role="img"
            aria-label={`${connectAll ? 'capture' : 'daily'} series, ${tickLabel(start, true)} to ${tickLabel(end, true)}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHoverDate(null)}
          >
            {[0, 0.5, 1].map((f) => {
              const v = model.top * f;
              const y = PAD_T + PLOT_H * (1 - f);
              return (
                <g key={f}>
                  <line
                    x1={PAD_L} x2={width - PAD_R} y1={y} y2={y}
                    stroke="var(--color-hairline-soft)" strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 10} y={y} dy="0.32em" textAnchor="end"
                    fontSize={11} fill="var(--color-soft)" className="tabular-nums"
                  >
                    {fmtNum(Math.round(v))}
                  </text>
                </g>
              );
            })}

            {/* Gridlines, labels and the hover crosshair stay OUTSIDE the presence group: only
                the plotted marks crossfade, so the frame never blinks. Default `initial` on
                AnimatePresence — passing initial={false} would suppress the paths' own
                first-draw `initial` on the render that mounts them. */}
            <AnimatePresence>
              <motion.g
                key={dataKey}
                initial={isFirstDraw ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: dur.fade, ease: 'linear' }}
              >
                {model.segs.map((seg) => (
                  <g key={seg[0]?.point.date}>
                    {seg.length > 1 && (
                      // The fill arrives in the final third of the draw, so the line reads as
                      // drawn rather than as a shape that was always there.
                      <motion.path
                        // `d` is a plain attribute, never an animated value — see the note on
                        // `dataKey` for what was observed when it was animated. Geometry follows
                        // React directly, which is what makes a resize track the gridlines frame
                        // for frame instead of lagging.
                        d={areaPath(seg)}
                        fill="var(--color-mint)"
                        initial={isFirstDraw ? { opacity: 0 } : false}
                        animate={{ opacity: 0.18 }}
                        transition={{
                          opacity: { duration: dur.draw / 3, delay: (dur.draw * 2) / 3, ease: 'linear' },
                        }}
                      />
                    )}
                    {seg.length > 1
                      ? (
                        <motion.path
                          d={linePath(seg)}
                          fill="none" stroke="var(--color-ink)"
                          strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
                          initial={isFirstDraw ? { pathLength: 0 } : false}
                          animate={{ pathLength: 1 }}
                          transition={{ pathLength: { duration: dur.draw, ease: EASE_STANDARD } }}
                        />
                      )
                      // A one-point run has no line to draw — a dot is the only honest mark.
                      : (
                        <motion.circle
                          cx={seg[0]?.x} cy={seg[0]?.y} r={2} fill="var(--color-ink)"
                          initial={isFirstDraw ? { opacity: 0 } : false}
                          animate={{ opacity: 1 }}
                          transition={{ duration: dur.fade, ease: 'linear' }}
                        />
                      )}
                  </g>
                ))}
              </motion.g>
            </AnimatePresence>

            {hover && (
              <g>
                <line
                  x1={hover.x} x2={hover.x} y1={PAD_T} y2={model.baseline}
                  stroke="var(--color-hairline-soft)" strokeWidth={1}
                />
                <circle cx={hover.x} cy={hover.y} r={3.5} fill="var(--color-salmon)" />
              </g>
            )}

            {ticks.map((t, i) => (
              <text
                key={`${t.date}-${i}`}
                x={i === 0 ? PAD_L : i === 1 ? (PAD_L + width - PAD_R) / 2 : width - PAD_R}
                y={SVG_H - 8}
                textAnchor={t.anchor}
                fontSize={11}
                fill="var(--color-soft)"
              >
                {tickLabel(t.date, spanYears)}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
