# Model runs stay in the api process; the queue carries everything else; the renderer stands alone

Three processes, and a rule for what runs where. **Model runs execute in the api process**, as today:
the launchers pass closures (`stage`, `finalize`, the managed run's `call`) that cannot be put on a
queue, and the run console is an in-process `RunEventsHub` that a second machine cannot see. With two or
more Fly machines a Run records the machine that holds it (`runs.machine_id`) and the SSE console route
replays to that machine with `fly-replay`; a 15-30 s heartbeat keeps the proxy open; deploys drain with
a kill timeout at least as long as the run timeout, and auto-stop is off for the api. Moving model runs
onto the worker needs a cross-process event bus (a polled `run_events` table or LISTEN/NOTIFY on a direct
connection) and the launchers rewritten without closures; that is a later ADR, and until then a
pg-boss retry can never duplicate a model call and its spend. **The worker runs queue jobs only**
(ADR 0024): Publish, pulls, imports, embeddings, sweeps, the reaper. **The renderer is its own Fly
app**: it takes HTML in and PNG out over an internal endpoint, runs Playwright with the sandbox on, holds
no secrets, and aborts with `page.route` every request that is not `data:` or an allowlisted font host.
Today the renderer launches Chromium in-process with `--no-sandbox` and renders HTML a client submits
(`images/render.service.ts:22`, `images.controller.ts:129`); in a multi-tenant api that is a page any
Tenant can point at Fly-internal addresses from inside the process that holds the database URL, the
token key and every provider key. This changes the answer Kevin gave in S4 round 1 Q15 ("the Playwright
container that exists"; none exists); he ratified the change on 2026-09-24.

Source: the S4 review (both legs, findings on the SSE hub, the closures, the shared deploy and the
renderer); `runner/run-events.hub.ts:7`, `runner/runner.service.ts:81-86`.

## Considered

Runs on the worker from day one. Rejected for v1: the console and the launchers would both be
rewritten before the beta, for a benefit (api machines that do no long work) the beta does not need.

The renderer inside the api with `page.route` alone. Rejected: the process boundary is what keeps a
renderer exploit away from the secrets; the route filter is the second belt, not the first.

Cloudflare Browser Rendering as the renderer. Kept as the fallback if the renderer app's cold start
hurts; the app is the same Playwright code forge already has.

## Consequences

Chromium leaves the api machine, so the api's memory budget is the ONNX spike's to measure without it,
and the renderer app's is measured on its own.

A deploy during a ten-minute run waits for it. Fly's kill timeout is set accordingly, and a deploy is
not the moment a run is lost.

The localhost audit (spec, S4-Q5) gains a fifth item: the renderer.
