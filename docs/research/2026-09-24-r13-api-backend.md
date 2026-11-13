# R13. The `api` backend

Research note for the forge v2 brief (research contract R13). Evidence gathered by a scout on
2026-09-24 from Anthropic and OpenAI primary docs plus one read of the engine code; verdict and reading
by the main session (fable).

## Verdict

Both providers reproduce the CLI's payload-or-decline Output contract as an `anyOf` inside a root
object with a `const` tag per branch (no `oneOf` discriminators), validated afterwards with forge's own
Zod schema. Direct provider SDKs behind forge's existing Engine seam, with the SDKs' own retries turned
off so every attempt is a recorded Run, is the design the audited-Run invariant asks for. Vercel AI SDK
v7 is a live option that was not checked on cache-token fidelity and structured-output mode.

## What the backend must reproduce (code)

- `engines/claude.engine.ts:104, 142-143`: argv `-p --output-format stream-json --verbose --model X
  --json-schema <JSON>`; `:45` the CLI fulfils the schema via its own tool call; `:212` the answer is the
  `result` line (`subtype`, `is_error`, `result`, `usage`, `structured_output`); `:208` a missing result
  line is `invalid_output`; `:68` usage parsing fails open and drops cache tokens.
- `engines/process-engine.ts:5, 32, 70, 90`: `EngineEnded` of `timeout | cap`; the tool-call cap is
  enforced per stream line and kills the child; the first reason to end wins.
- So the api engine needs an AbortController timeout, a tool-call cap counted from stream events, usage
  with cache fields, and the full failure taxonomy mapped from HTTP errors.

## Evidence

1. Anthropic structured outputs are GA through `output_config.format`, no beta header (`output_format`
   deprecated); tools accept `strict: true`; supported on Opus 5.5, Opus 5, Opus 4.x, Sonnet 5, Sonnet
   4.x, Haiku 4.5, Fable 5.x, Mythos 5.x.
   [https://platform.claude.com/docs/en/build-with-claude/structured-outputs, 2026-09-24]
2. Anthropic schema limits: supported `anyOf`, `allOf` (not with `$ref`), `const`, primitive `enum`,
   local `$ref`/`$defs`, `required`, `additionalProperties: false`, string formats (date-time, date,
   time, duration, email, hostname, uri, ipv4, ipv6, uuid); not supported recursive schemas, `oneOf`
   discriminators, `minimum`/`maximum`, `minLength`/`maxLength`, `minItems` above 1. The TS SDK strips
   unsupported keywords into descriptions and validates against the original schema. [same]
3. Grammar compiled on first request, cached 24h, invalidated by schema or tool-set changes; works with
   streaming, JSON parsed once complete. [same]
4. Prompt caching: one automatic top-level `cache_control` or up to 4 breakpoints; TTL "5m" or "1h";
   writes 1.25x (5m) or 2x (1h) base input; reads 0.1x, but 0.05x on Opus 5.5 and 0.025x on Fable 5.1;
   Opus 5.5 example $4 base, $5 5m write, $8 1h write, $0.20 hit per MTok; minimum prefix 512 tokens on
   Opus 5.5 and Fable, 1,024 on Sonnet 5; usage splits `input_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`. [https://platform.claude.com/docs/en/build-with-claude/prompt-caching]
5. Rate limits: token bucket per model class (RPM, ITPM, OTPM); Start tier Opus 5.5 1,000 RPM, 2M ITPM,
   400k OTPM; Fable 1,000 RPM, 500k ITPM, 100k OTPM; cache reads do not count toward ITPM; 429 carries
   `retry-after`; spend caps Start $500, Build $1,000; hitting the cap returns 429 with
   `error.details.error_code = "enforced_spend_limit_reached"` and no retry-after. Batch: up to 100k
   requests. [https://platform.claude.com/docs/en/api/rate-limits]
6. OpenAI Responses API: `text.format: {type: "json_schema", strict: true, schema}`; root must be an
   object, every property required, optionals as `T | null`, `additionalProperties: false` mandatory;
   `anyOf` supported; a safety refusal arrives as a separate `refusal` output; streaming supported.
   [https://developers.openai.com/api/docs/guides/structured-outputs]
7. OpenAI images: the guide lists `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`; R9 confirms the
   `gpt-image-2` model page still exists, resolving the scout's doubt. Streaming via `partial_images`.
8. Vercel AI SDK v7: `generateObject` listed, not deprecated; Anthropic cache control via
   `providerOptions`; OpenTelemetry via `experimental_telemetry`; middleware and callbacks. Landing page
   only; provider pages unread. [https://ai-sdk.dev/docs/introduction]

## Equivalence

- Anthropic: `{type: "object", properties: {outcome: {anyOf: [{…payload, kind: {const: "payload"}},
  {kind: {const: "declined"}, reason: string, question?: string}]}}}`. Numeric and length constraints
  are lost to the SDK rewrite and caught by the post-hoc Zod check.
- OpenAI: same shape; every field in `required`, optionals nullable, every object closed, root wrapped.
- Both have a provider-level refusal (OpenAI `refusal` item; Anthropic believed `stop_reason: "refusal"`,
  unverified) distinct from the in-schema decline; both map to `declined`.

## Reading

The seam already exists: `Engine` is an interface with `claude`, `codex`, `process` and `fake`
implementations, and the `api` engine is one more. The brief's decision 2 (no CLI code in the hosted
build) is a package boundary around `claude.engine.ts`, `codex.engine.ts` and `process-engine.ts`, with
`fake` and `api` in the shipped package. The one design point that changes behaviour: the SDKs retry
silently by default, which would hide attempts from the Run; `maxRetries: 0` and one retry in forge's
layer, recorded, keeps invariant 6 true. Caching is the single largest lever on text cost (R12): the
Constitution and Style docs are a stable prefix per Voice and belong under one `cache_control`.

## Decision fed

- ADR 0003 amendment and the engine backend design: direct SDKs (Anthropic, OpenAI) behind `Engine`;
  contract as tagged `anyOf`; post-hoc Zod validation; `maxRetries: 0` plus one recorded retry honouring
  `retry-after`; Run row created before the call, usage written with cache fields, cost column from the
  registry.
- Failure kinds: AbortController timeout → `timeout`; 429 with retry-after or 529 → retry then `quota`;
  429 `enforced_spend_limit_reached` or a 400 usage-limit error → `quota`, no retry; network or DNS →
  `spawn_error` (or a new `transport`); other 4xx/5xx → `nonzero_exit` (or `http_error`); parse or
  schema failure → `invalid_output`; in-schema decline or provider refusal → `declined`.
- Prompt caching: one breakpoint after the Constitution, 1h TTL for the drafting session.
- AI SDK v7: not adopted until its cache-token reporting and structured-output mode are verified.

## Open items

- Anthropic TS SDK `toolRunner` / `betaZodTool` signatures and beta status; web search and code
  execution server tools (pricing, compatibility with `output_config.format`); exact stream event names
  for structured output; batch discount (50% recalled); the `refusal` stop reason.
- OpenAI prompt caching rate and `Idempotency-Key`.
- AI SDK v7 Anthropic provider: mode for objects, cache tokens in usage, stream parts onto SSE.

## Confidence

High on Anthropic structured outputs, caching and rate limits (primary). Medium on OpenAI structured
outputs. Low on AI SDK details.
