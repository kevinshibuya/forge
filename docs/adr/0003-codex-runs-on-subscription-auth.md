# `OPENAI_API_KEY` is stripped from every codex child process

Image generation runs through the codex CLI on ChatGPT **subscription** login, never on a metered API key, because the project's spending constraint is zero beyond the subscriptions already paid for. Setting `OPENAI_API_KEY` on a codex child silently switches billing to the metered API, so the key is deliberately stripped in `codex.engine.ts`. Raster and hybrid generation working *without* a metered charge is the correct, tested behaviour.

Source: `docs/superpowers/specs/2026-07-11-forge-content-system-design.md` (§Runners — Codex); `docs/manual-testing-guide.md` §4 ("Billing invariant to spot-check").

## Consequences

- The single metered consumer in the whole system is OpenAI `text-embedding-3-small`, at roughly a cent a year.
- Image turns burn subscription plan limits three to five times faster than text turns, so the candidate batch defaults low and quota exhaustion is surfaced as its own run failure state ("plan limit reached") rather than a generic error.
- A future settings toggle could re-enable API-key billing; until someone asks for it, a missing key on a codex child is the feature.

## Amended for v2 (2026-09-24)

The spending constraint this ADR served ("zero beyond the subscriptions already paid for") was the constraint of a single-operator tool. A hosted product pays for its own model calls on product-owned keys, meters every call into a cost ledger, and enforces a per-Tenant Budget; that is ADR 0019's `api` backend. This ADR's rule survives unchanged on the `cli` backend, which exists for development only and is confined to runs without Inputs or Research: there, `OPENAI_API_KEY` is still stripped from every codex child, and image generation through codex on the ChatGPT subscription is a generator row that exists on `cli` alone. Glossary invariant 1 now reads "on the `cli` backend". The consequence that mattered here, quota exhaustion surfaced as its own failure kind, carries over: on `api` it is a 429 with `enforced_spend_limit_reached`, recorded as `quota` with no retry.
