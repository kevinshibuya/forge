# Three engine backends, and the CLI never ships

Every model call ran as a subprocess of the `claude` or `codex` CLI on Kevin's subscriptions (ADR 0003), which a hosted product cannot do. The `Engine` seam that already exists gains a third real implementation, and the three are chosen by the deployment, never by a Tenant: `fake` for tests, `api` for the hosted product (direct Anthropic and OpenAI SDKs), and `cli` for development on the subscriptions, kept for Kevin's reason (no metered billing for routine drafting and image work while building). The `cli` backend lives in its own workspace, `@forge/engine-cli`, together with the staging service and the fences of ADRs 0015 and 0017; only the development entrypoint imports it, the hosted build excludes it, and a test walks the production bundle's import graph and fails on any reference. That test is the proof clause: the constraint "no CLI code in production" is a build fact, not a convention.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` decision 2; `docs/research/2026-09-24-r13-api-backend.md`.

## The seam changes shape

`EngineRequest` today is CLI-shaped: `prompt: string`, `cwd`, `env`, `allowedTools`, `images` as local paths for codex `-i` (`engines/engine.interface.ts:7-27`); `EngineResult.usage` has no cache fields and no cost. The v2 request carries system blocks with cache hints, user content, image references by storage key, the schema, a timeout and a tool cap; the v2 result carries the output, usage with `cache_creation_input_tokens` and `cache_read_input_tokens`, a cost priced from the registry at call time, the provider request id, and any image output as bytes or a storage key. `runs.engine` stops being the enum `claude | codex` and becomes a provider text column. `engineForKind` and the model fields in the settings row are replaced by the registry. The hybrid lane's background step, which today relies on codex writing `bg.png` into a `cwd`, is rewritten against the `ImageGenerator` interface in the image slice.

## What `api` must reproduce, and how

The Output contract as a tagged `anyOf` (ADR 0016, amended), through the Anthropic, OpenAI and Google SDKs (Google for the default image generator). An `AbortController` timeout. Usage and cost written on the Run **on every exit path**, including timeouts and failures, because the API bills them and today the runner records usage only on success or decline. The SDKs' own retries are off (`maxRetries: 0`) and forge makes one recorded retry for a 429 with `retry-after` or a 529; every attempt is a row, so invariant 6 stays true. Failure kinds map from HTTP: timeout → `timeout`; 429 after the retry, or `enforced_spend_limit_reached`, → `quota`; a refused Budget reservation → `budget` (new); network or DNS → `spawn_error`; other 4xx and 5xx → `nonzero_exit`; a parse or schema failure → `invalid_output`; an in-schema decline or a provider refusal → `declined`. Two cache breakpoints: after the Constitution and the Voice's Style docs, and after the Inputs and Research block, because a refine re-sends both. TTL 5m by default and 1h only while a Workspace session is open, since a 1h write costs twice base input and pays only when three or more calls share the prefix within the hour; hit rates are measured in the ledger before the TTLs are tuned.

## The proof clause, precisely

The api is transpiled file by file with swc and has no bundle to walk. The test runs a file trace from `dist/main.js` (node-file-trace or a short `require`/`import` walker) and fails on any edge into `@forge/engine-cli`; the Docker build keeps that workspace out of the api's production dependencies as the second belt. The staging service, the input walker and the fences of ADRs 0015 and 0017 are deleted, not moved: `cli` never serves a run with Inputs or Research, so nothing in the dev package needs them.

## Where `cli` may and may not run

It serves run kinds whose contracts are proven identical on both backends (triage, draft, refine, retro, the image lane's text steps) and image generation through a codex generator row that exists only on `cli`. The Draft score's judges are `api` models, so a `cli` run shows no score, by design and not as a bug. It never serves a run with Inputs attached or a Research run, because there the mechanism differs and not just the vendor: the CLI reads a staged directory and searches with its own tools, the api delivers documents and searches through an API (ADR 0023), and a dev run down the CLI path proves nothing about the hosted one. The eval gate runs on `api` for the same reason.

## Considered

The Vercel AI SDK as the provider layer. Not adopted: its cache-token reporting and structured-output mode were not verified, two providers is not an abstraction problem, and the audited-Run invariant needs control of retries and usage that a wrapper would have to be verified to give.

Killing the `cli` backend outright, which both S3 review legs argued. Kevin kept it on 2026-09-24 with the confinement above; the confinement is what makes the divergence bounded.

A per-Tenant "use my CLI" option. Rejected: it is bring-your-own-key by another name, which the brief deferred.

## Consequences

The subscription terms for driving `claude -p` and `codex` from an application during development are an open item (memo question 5) that no note researched.

A contract change must be probed on both backends before a kind is allowed on `cli`; the probe script from ADR 0016 is the template.

The model registry, one row per task with a pinned model and a price, is shared by the backends; a row may be pinned to a backend, which is how the codex image row exists on `cli` alone.

## Implemented (slice 2, 2026-09-25)

Slice 2 built the seam, the registry, the ledger and the package split, with five narrowings from its plan (`docs/plans/2026-09-24-forge-v2-slice-2-engine-v2.md`).

`runs.engine` holds an engine name. On `cli` that is `claude` or `codex`; on `api` it is the provider, `anthropic` or `openai`. The column is text, so the old rows keep meaning what they meant.

The output envelope stays a nested `oneOf` in shared, because the CLI is proven on it. The api engines, which land in the slice's Part C, rewrite it to `anyOf` at the provider edge in `toProviderSchema`.

The one recorded retry lives in the runner, not the engine. An api engine will report a 429 with retry-after, a 529 or a 503 on `EngineResult.retryable`; the runner writes attempt 1's ledger row, waits at most 30 s, and calls once more. Every attempt is a ledger row whatever the engine.

A 529 or 503 that survives the retry maps to `quota`, not `nonzero_exit`. The operator reads overload the same way as a rate limit.

Three fields of the spec's shapes are not fields. The request has no tool cap, because no engine exposes tools. The result has no cost, because the engine does not know the price; the runner prices the call from the registry row and writes the cost on the ledger row. Image output as bytes or a storage key waits for slice 10's `ImageGenerator`.
