# Chart load-in + skeleton-first loading

**Date:** 2026-09-02. **Status:** approved in chat (grilled on Fable, 23 questions over two rounds, all answered); plan written and reviewed 2026-09-02 (one wave: opus, fable, codex), decisions 3, 14 and 16 amended from the review as marked. Decision record: `docs/adr/0014-motion-library-and-skeleton-first-loading.md`. Glossary terms (Skeleton, Load-in, Warm/cold navigation) are in `CONTEXT.md` §Visual language.

## Problem

Every graph in the web app paints at its final size the instant it mounts, and every page loads behind the same 16px spinner. Route changes therefore read as a flicker: spinner, blank, content. The operator asked for (1) a load-in on every graph, where the graph grows into place when its component renders, and (2) a skeleton on every page that replicates the loaded layout, plus (3) data warmth so most navigations never show a loading state at all.

## Decisions locked

### Motion system

1. **One library: `motion`** (`motion/react`, 13.x; framer-motion's current name). No CSS keyframes are added; the two existing Tailwind chart transitions (comparison bars, weekday bars) migrate onto `motion` values so a page never runs two systems.
2. **Tokens stay the existing ones.** `--dur-standard` 240ms, `--dur-slow` 360ms, ease `cubic-bezier(0.2, 0, 0, 1)`. They are defined once in a TypeScript module (`app/web/src/lib/motion-tokens.ts`) and the CSS variables in `index.css` mirror it. Two new durations join them: `load-in` 500ms (bars) and `draw` 700ms (line chart), plus a `stagger` of 40ms and a `fade` of 150ms.
3. **Reduced motion.** The app is wrapped in `MotionConfig reducedMotion="user"`. Because `motion` only suppresses transform and layout animation under that flag, chart components also read `useReducedMotion()` and collapse their durations to 0 and skip their `initial` values, so bars and lines appear at final size without a frame at zero. The skeleton pulse is static under reduced motion. The `Spinner` and drafting pulse keep moving (existing rule: status indicators must move).

### Load-in

4. **Every graph grows in once per mount**, including warm navigations. Bars grow from their baseline (left edge for horizontal bars, right edge for the previous-window bar in the comparison chart, bottom for vertical bars). Duration 500ms, ease standard, stagger 40ms per bar within one chart. Comparison pairs (previous and current of one row) share a stagger slot.
5. **The metric line chart draws left to right** (`pathLength` 0 to 1, 700ms); the area fill fades in over the final third (starts at 470ms, 230ms long). Hover crosshair behaviour is unchanged.
6. **Data changes on a mounted graph transition, never replay the load-in.** Bars interpolate width/height (360ms `slow`). The line crossfades old and new (150ms `fade`) on **every** data change. **(Amended 2026-09-02 during implementation, commit `76b7d08`.** The original wording promised a path morph when the point count was unchanged. Observed in motion 13.2.0: animating `d` writes the literal string `"undefined"` into the attribute and the browser rejects it — route-smoke caught this on `/analytics` and `/analytics/1`. The marks group is therefore keyed on the data, so every data change crossfades; a resize does not change the key, which leaves the line tracking the gridlines frame-for-frame rather than the 360ms lag the plan had accepted.)
7. **What counts as a graph:** comparison bars, weekday bars, tick meter, bar lists (Analytics bands and post detail), status ratio bars on Overview, the metric line chart. **Not graphs:** hero numbers (static, no count-up), the planner mini-month (a calendar), the canvas editor.

### Skeleton

8. **Every routed page has a skeleton** that replicates its loaded layout: same regions, same heights, same column structure. Static chrome (page title, range tabs, section headings, nav) renders real immediately; only data regions are skeletonised.
9. **Skeleton fill token `--skeleton`**: `color-mix(in oklab, var(--ink) 7%, transparent)` in light, 10% in dark and inside `[data-surface='dark']`. Blocks pulse opacity between 1 and 0.55 on a 1.6s cycle, ease-in-out, looping. No shimmer sweep.
10. **Handoff**: the real region fades in over 150ms in the skeleton's footprint; the load-in starts at the same moment. On a cold query the skeleton appears immediately, no delay.
11. **Lists show 5 skeleton rows** sized like a real row. Workspace and Settings show form-shaped skeletons (label + field blocks matching the real form). Analytics, Post analytics and Planner (single-payload pages) show one structured skeleton for the whole body. Section-level gating stays where queries are already separate: Overview (hero band vs lower band), Workspace (post vs runs).
12. **`Spinner` survives only as in-place status**: inside buttons, "retro running", "loading the canvas", "loading earlier". It never gates a page or a region.

### Data warmth

13. **react-query defaults**: `gcTime` 30 minutes, `staleTime` unchanged at 5s, `refetchOnWindowFocus` and `retry` unchanged.
14. **Every filter- or range-keyed query keeps previous data** (`placeholderData: (prev) => prev`), so a range, month or filter change is a transition and never a skeleton. **Id-keyed queries do not** (post, post analytics, post runs): the previous record is a different post, and the Workspace seeds its editable body from the query, so keeping it would let a save write one post's text under another's id. Navigating between two posts shows the skeleton for the new id. Skeleton means "no data for this key has ever arrived". (Amended during the 2026-09-02 plan review; the original wording said "every param-driven query".)
15. **Prefetch**: hooks export `queryOptions` factories. The shell prefetches a nav target's default queries on link hover and focus, and warms every nav target once on idle after the shell mounts (`requestIdleCallback`, falling back to a 1s timeout).

### Tests and verification

16. Under ADR 0013: one pending-state component test per skeletonised page, asserting the skeleton renders (via `data-probe`) and no `Spinner`. No animation-timing tests. Route-smoke stays as-is (known gap, accepted: its `networkidle` + non-empty `#root` check passes a page whose skeleton never resolves; a skeleton-count assertion is a possible follow-up, not part of this work). Motion quality is verified by eye in both themes and with reduced motion on.

## Out of scope

- Splitting single-payload endpoints. API untouched.
- Count-up numbers, page-level choreography (sections fading in sequence), route transitions between pages.
- Canvas editor, lightbox, run console.
- CI.
