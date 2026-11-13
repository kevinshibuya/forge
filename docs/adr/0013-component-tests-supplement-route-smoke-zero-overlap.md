# Component tests supplement route-smoke; zero overlap, reachability is the line

`app/web` gets a vitest/jsdom suite, but it is deliberately not a second rendered-surface gate. `route-smoke.mjs` (real Chromium, real API, real dev server) remains the sole proof that the app boots, routes match and render, and no console errors fire. The vitest suite owns only what route-smoke *cannot reach*: pure `lib/` logic, the `client.ts` error-shaping, and component branches that require **injected state the live server never presents** — failures (a healthy dev server can never make `isError` true) and data states the smoke's real database cannot stage (an empty backlog, an all-linked attach picker, a run with no steps). The boundary is reachability, not directory: a page-level branch (a failing query must show an `ErrorNote`, not a reassuring `EmptyState`) is in scope; a happy-path rendering or interaction test — anything provable by visiting the healthy app — is not, in any directory.

## Considered options

- Page-level tests with mocked network for full coverage: rejected — they re-prove what route-smoke already proves against the real stack, at higher maintenance, and their green is weaker evidence (jsdom, mocked data).
- Class-contract tests as legibility proxies (e.g. "salmon only on the semibold lead"): rejected — legibility bugs in this codebase (the palette sweep, the SettingsPage salmon body copy) are caught by *reading the rendered page*, and a structural assertion passing is exactly the kind of green gate that has lied here before. Human eyes own legibility.

## Consequences

- Do not "fill the coverage gap" with happy-path page or navigation tests; the gap is intentional. If route-smoke can prove it, no spec here may re-prove it.
- The mocking seam is the `api` object in `app/web/src/api/client.ts`; hooks and react-query run real in component tests (`retry: false`). The error-shaping (`parse`) is proven once at the client layer with a stubbed `fetch`, not re-proven per component.

## Negative controls

Two of the five `tokenSummary` cases assert states a healthy server does
present (a claude run's split; a managed run that stayed on one engine). They are not happy-path
tests smuggled in: each is the control that gives the guard beside it teeth — without the first, a
`tokenSummary` that always returned a total would still pass the codex case; without the second,
hard-coding `splitIsHonest = false` for managed kinds would still pass the mixed-engine case. A
control that makes a neighbouring assertion falsifiable is in scope. A rendering asserted for its
own sake is not.

Open gaps found by the 2026-09-01 review are tracked in issue #24, not here.
