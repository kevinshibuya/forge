# R12. Cost per post at production prices

Research note for the forge v2 brief (research contract R12). Token counts measured by a scout on
2026-09-24 against the live `forge` database and the prompt builders; prices from vendor pages fetched
that day; reading by the main session (fable).

## Correction after the S3 review (2026-09-24)

Both review legs caught a unit error, verified against `app/api/src/engines/codex.engine.ts:6-7`: the
33,538 "output tokens per image" is the codex CLI's session-wide "tokens used" total (the agent's
prompt, reasoning and tool calls), filed under `outputTokens` by convention. It is not gpt-image-2's
image-output token count, and multiplying it by $30 per 1M has the wrong units. Everything below that
rests on "$1.00 per high-quality image" is withdrawn: the $4.50 premium T1, "images are ~90%", the
$99 tier, and the claim that the text model barely matters.

What stands: unit prices, output token counts on text runs, and the method. What replaces the verdict:

- **gpt-image-2's per-image price is unmeasured** until the image slice makes one direct API call per
  quality and size and records `usage.output_tokens_details`. gpt-image-1's high-quality 1024x1024
  was on the order of 4-6k output tokens (from memory), which would put the real price several times
  under $1.
- **At the memo's default settings** (Nano Banana 2 at $0.067 ×2, Sonnet-class drafting at ~$0.20,
  X publish and reads ~$0.05) a T1 is about $0.38 and **text is the largest share, images second**.
  Once images are cheap, the drafting model is the main lever: Opus 5.5 turns a $0.40 T1 into about
  $0.62. The registry default for drafting is therefore an eval decision (R17), not a cost one.
- **The judge design of R5 and R17 was not counted.** A strong cross-vendor pairwise judge run twice
  (order swap) plus a cheap rubric judge on every draft and refine adds about $0.16 per T1 with a
  gpt-6-sol judge and about $0.78 with astra. Either the strong judge runs only at approve or the
  ceiling moves; S4-Q7 decides.
- **Also uncounted**: the variator run, Research runs ($0.02-0.05 API plus 15-30k input tokens of
  fetched pages), preference inference per edit pair (R4), Retro monthly, the Voice profile, X history
  import (up to $16 per user), and infrastructure (~$40-60 a month shared, R15). R10 assumes 5 posts a
  week and this note assumed 28 a month; S4 fixes one volume assumption and the run composition per
  Tier.
- **Working price floor**: $49 for the solo tier, not $29-49.

The original text follows unchanged, for the record.

## Verdict

Images set the cost of a post, and the text model barely moves it. A T1 with four gpt-image-2
Candidates at high quality costs about $4.3-4.5 whichever model drafts it, about 90% of it images; a
text-only post costs $0.07-0.33. At 12 T1 + 8 T2 + 8 T3 a month, a Tenant costs about $59 on premium
models, $54 balanced, $15 with medium-quality images. The brief's round-1 guess of $0.30 per T1 was off
by an order of magnitude *if* the image lane keeps gpt-image-2 at high quality and four Candidates; with
Nano Banana 2 and two Candidates (R9) a T1 lands near $0.40, and the guess holds. Input tokens are
estimates, because the repo does not record real input size.

## Measured (live DB, docker up, read-only)

- **Input tokens are not usable.** `app/api/src/engines/claude.engine.ts:60-77` keeps `input_tokens` and
  drops `cache_creation_input_tokens` and `cache_read_input_tokens`; recorded inputs are 2-6 tokens, the
  uncached tail of a CLI run. Input was estimated from `length(runs.prompt) / 4` plus assumed context.
- Runs (count / output median / p90 / prompt chars median / p90): draft sonnet-5 21 (17 with tokens) /
  5,062 / 9,179 / 9,795 / 13,342 chars; draft opus-4-8 9 (1 with tokens, 1,755 out); triage 5 / 630 /
  1,376 / 2,557 / 4,257; refine_selection 6 / 322 / 1,083 / 3,998 / 8,286; image_hybrid 51, image_html
  3, image_variate 7: no tokens; image_gen and image_refine (gpt-image-2): `run_steps.tokens_output`
  median 33,538 per image; retro, image_plan, image_review: no rows.
- Embeddings: 4 post chunks (~946 chars) and 11 idea chunks (~82 chars); 1-2 calls per post under 300
  tokens each.
- Assumed per-call inputs for a direct API run: triage 4k in / 0.6k out; draft 20k / 5k; refine 5k /
  0.3k; image plan 8k / 2k; image review with 4 images 8k / 1.5k; judge 8k / 1k.

## Prices (per 1M tokens unless stated; fetched 2026-09-24)

- Anthropic (input / output / 5-min cache write / cache read): Fable 5.1 10 / 50 / 12.50 / 0.25; Opus
  5.5 4 / 20 / 5 / 0.20; Sonnet 5 2 / 10 / 2.50 / 0.20; Haiku 4.5 1 / 5 / 1.25 / 0.10; batch 50% off.
  [https://claude.com/pricing]
- OpenAI text (in / out): gpt-6-astra 10 / 50; gpt-6-sol 2 / 10; gpt-6-luna 0.10 / 0.50; gpt-5.6-sol
  4 / 20; gpt-5.6-terra 2 / 12; gpt-5.6-luna 0.20 / 1.20; cached input 90% off; batch and Flex 50% off.
  [https://developers.openai.com/api/docs/pricing]
- gpt-image-2: per token (image output $30, image input $8, cached $2, text input $5); at 33.5k output
  tokens per image about **$1.00 high**, about $0.25 medium (assumed). Per-image grid not found.
- Nano Banana 2 (Gemini 3.1 Flash Image): $0.067 per 1K image (R9). Nano Banana 2 Lite $0.0336.
- text-embedding-3-small: $0.02 from memory, unverified, negligible.
- Voyage: voyage-4 $0.06, voyage-4-lite $0.02, voyage-4-large $0.12, voyage-context-4 $0.12, rerank-3
  $0.05; first 200M tokens free; batch 33% off; voyage-3.5 no longer listed.
  [https://docs.voyageai.com/docs/pricing]
- Google text: Gemini 3.8 Flash $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50; 3.5 Flash-Lite
  $0.30 / $2.50. [https://ai.google.dev/gemini-api/docs/pricing]
- X: create $0.015 ($0.20 with URL); read $0.005 per connected-user post (R11 corrects the scout's
  $0.001 owned-read assumption used in the table below).
- LinkedIn CM Development tier: free, capped (R10).

## Cost table (USD per post; X publish plus 30 daily reads assumed at $0.03 by the scout)

| Post | Premium (Opus 5.5, gpt-image-2 high ×4) | Balanced (Sonnet 5, same images) | Cheap (Haiku 4.5, medium images ×4) |
|---|---|---|---|
| T1: triage, draft, 2 refines, plan, 4 images, review, judge, embeddings, X | 0.45 + 4.00 + 0.05 = **4.50** | 0.23 + 4.00 + 0.05 = **4.27** | 0.11 + 1.00 + 0.05 = **1.16** |
| T2: triage, draft, 1 refine, judge | **0.33** | **0.17** | **0.09** |
| T3: triage, draft | **0.25** | **0.13** | **0.07** |
| Adapt: one restyle call, 8k in / 3k out | **0.14** | **0.09** | **0.07** |
| Month, 12 T1 + 8 T2 + 8 T3 | **≈ 58.6** | **≈ 53.6** | **≈ 15.2** |

Premium T1 text breakdown: draft $0.18, triage $0.028, two refines $0.052, plan $0.072, review $0.062,
judge $0.052. Not applied: prompt caching of the Constitution and style context (cache reads at 5% of
input on Opus 5.5 cut repeated input cost 60-80%); batch pricing for retro and embeddings.

## Reading

Re-run the T1 row with R9's defaults (Nano Banana 2 at 1K, two Candidates, one review): images $0.13,
text on Sonnet $0.20, X and reads $0.05, about **$0.40 per T1** and about **$11 per Tenant-month** on the
same post mix. The premium image path stays available per post as an explicit, metered choice. That
makes the pricing question tractable: COGS of $11-15 per active Tenant supports a $29-49 tier with a
budget of roughly 30 posts, and the $99 tier is for Tenants who want gpt-image-2.5 on every flagship.
The number that must be measured before any of this is set is the real input token count, which needs
the `api` backend's usage capture (R13) and is the first slice's job.

## Decision fed

- Price point (decision 6): set after one month of the `api` backend's ledger; working assumption
  $29-49 for the solo tier with images metered.
- Cost ceiling: one T1 at or under $0.50 on default settings; a premium image choice shown with its
  price before the batch runs.
- Model registry: Sonnet 5 for drafting by default (Opus 5.5 saves nothing visible against it once
  images are cheap); judge rows per R5; image rows per R9.
- Budget (decision 5): images and platform API calls metered separately from text.
- Engine (R13): record `cache_creation_input_tokens` and `cache_read_input_tokens`; write a cost column
  at call time from the registry's prices.

## Open items

- gpt-image-2 per-image price grid; text-embedding-3-small price; Google Pro and Imagen prices.
- Real input tokens on every run kind, including the 58 image runs with none recorded.
- The composition of T1, T2, T3 and Adapt runs is the scout's assumption; S4 fixes it.

## Confidence

High on unit prices and output token counts. Low on input token counts (estimated) and the gpt-image-2
per-image price (assumed); monthly totals could move ±50%, almost all through the image price.

## Measured on the api backend (slice 2, 2026-09-26)

`app/api/scripts/r12-measure.mjs` against `start:api` on a second port, on the registry rows as
seeded. Triage runs on Haiku 4.5 with no effort. Drafts run on Sonnet 5, at effort `medium` for T3
and `high` for T2 and T1. Scratch ideas, one run per Tier, no Inputs, no Research. The refine goes through
`POST /posts/:id/refine`, which records its run as kind `draft`.

| run | kind | model | in | cache write | cache read | out | cost_usd |
|---|---|---|---|---|---|---|---|
| 145 triage #1 | triage | claude-haiku-4-5 | 1,169 | 0 | 0 | 83 | 0.001584 |
| 146 triage #2, 30 s later | triage | claude-haiku-4-5 | 1,169 | 0 | 0 | 74 | 0.001539 |
| 147 draft T3 | draft | claude-sonnet-5 | 667 | 0 | 2,404 | 443 | 0.006245 |
| 148 draft T2 | draft | claude-sonnet-5 | 664 | 0 | 2,404 | 1,099 | 0.012799 |
| 149 draft T1 | draft | claude-sonnet-5 | 1,165 | 0 | 2,404 | 2,112 | 0.023931 |
| 150 refine T1 | draft | claude-sonnet-5 | 1,714 | 0 | 2,404 | 1,696 | 0.020869 |

**Cache.** Triage never caches: its whole prompt is 1,169 tokens, under Haiku 4.5's 4,096-token
minimum, so the second triage paid full input again 30 seconds later. The draft's cached prefix is 2,404 tokens.
Every draft above read it, because earlier runs in the same five minutes had written it. The cold
case is C4's run 139, a T3 draft with 882 in, 2,404 written, 548 out, $0.013254. The refine read
2,404 of its 4,118 input tokens from the cache, 58.4%.

**Per run**, per million tokens: Sonnet rows `in×2 + cw×2.5 + cr×0.2 + out×10`, the Haiku row
`in×1 + cw×1.25 + cr×0.1 + out×5`. Two checks: run 149 is 1,165×2 + 2,404×0.2 + 2,112×10 =
2,330 + 480.8 + 21,120 = 23,930.8 per million, $0.023931; run 145 is 1,169×1 + 83×5 = 1,584 per
million, $0.001584.

**Text cost per Tier**, warm cache as measured:

- T3 = draft + triage = 0.006245 + 0.001584 = **$0.0078**
- T2 = draft + triage = 0.012799 + 0.001584 = **$0.0144**
- T1 = draft + triage + one refine = 0.023931 + 0.001584 + 0.020869 = **$0.0464**

A cold first draft writes the 2,404 tokens instead of reading them, which adds
2,404 × (2.5 − 0.2) per million = $0.0055: T3 $0.0134, T2 $0.0199, T1 $0.0519.

**Against the table above.** The note assumed 20k in / 5k out for a draft. Measured input is
3.1k to 3.6k per draft, uncached and cached together, and output 0.4k to 2.1k with adaptive thinking
included.
Text on the balanced column is an order of magnitude under the estimate: $0.13 → about $0.01 for a
T3, $0.17 → about $0.02 for a T2. Three limits on those numbers: one sample per Tier, short scratch
ideas, and output that varies run to run. The CLI history had a draft output p90 of 9,179 tokens.

**Still unmeasured.** Images wait for slice 10. The Inputs-plus-Research shape, about 80k input
tokens per ADR 0023, waits for slice 9. At Sonnet's input price 80k uncached tokens is $0.16 per
draft, more than three times the whole T1 text measured here, so that shape, not the drafting model, will set text cost
once Inputs return. Decision 6's ceiling stays provisional.

The measurement and the C4 probe together spent $0.156 across 14 ledger rows, runs 137 to 150. Five
of those runs belong to a first attempt that stopped on a race: the run row goes terminal a moment
before the post leaves `drafting`, and the refine got a 409. The script now waits for `draft_ready`.
C4's OpenAI triage, run 138, carries the Haiku row's rates because the probe swaps only engine and
model. At gpt-5.6-terra's list price of 2 / 12 it cost $0.0036, not the recorded $0.0016.
