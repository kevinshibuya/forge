# forge v2 research memo

**Written 2026-09-24** by the main session (fable), consolidating nineteen research notes
(`docs/research/2026-09-24-r01-*` to `r19-*`) gathered the same day by scouts against the research
contract in `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md`. **Amended the same day**
after the S3 adversarial wave: two `reviewer` legs (opus and fable, both at xhigh, fresh contexts).
The codex leg was not run, by Kevin's call, to keep that quota for another project; this wave is two
legs, not three. Verdicts are the main session's; every code claim a reviewer made was checked against
the tree before it was accepted.

**Status**: S2 complete; S3 applied. The brief carries the amendments marked `[S3]`; this memo carries
the record of what the wave found and how each finding was disposed of. S4 (architecture grill, ADRs,
spec) is written and reviewed; its record is the "S4 consolidation" section below, with five ratifications, all five ratified by Kevin on 2026-09-24. Five questions gate the beta, listed under "Questions only Kevin or a third party can
answer".

## Verdicts, as amended

The last column names the decision that is provisional because its note's confidence is low, so S4
treats it as a measurement obligation rather than a settled fact.

| # | Question | Verdict | Conf. | At risk if low |
|---|----------|---------|-------|----------------|
| R1 | Exemplar selection | **Not supported, untested at this scale.** No study tests QA machinery for few-shot exemplar selection; what has support is retrieval from the author's history, similarity plus diversity, a BM25 arm on some generation tasks, and a selector trained on downstream quality (Salemi 2024, +5.5%). Posts are one chunk. Imitation fidelity on informal text may be the ceiling. R1 covers Exemplars only; document retrieval for Inputs and Research is a separate, open question (S4-Q1). | medium | retrieval v2 design |
| R2 | Embeddings and rerank | gemini-embedding-001, Qwen3-Embedding-8B and voyage-context-4 lead PT-BR; text-embedding-3-small ~15th. Contextualized embeddings add nothing to a one-chunk document. No reranker at pool 50, k 5. A paired eval on forge's corpus picks the model; voyage-3.5 is delisted, the trial row is voyage-4. | medium | none |
| R3 | What forge captures | `outcome` complete; `edit` derivable but unanchored; the Hook set never existed (glossary corrected); every rejection dropped; usage tokens missing on most image runs; codex reports one session total, not an in/out split. | high | none |
| R4 | Learning from edits | CIPHER-style preference inference from (draft, edit) pairs → rule proposals; published body as positive exemplar; optimisers only through the proposal queue; all TS. Edits must be classified (style, fact, topic) before inference, and refine instructions are a stronger, already-typed preference the model must not re-infer. | high on method | decision 19 (edit validity) |
| R5 | Judging voice and fit | No validated "sounds like me" metric. Style-embedding distance with two calibrated floors plus an order-swapped pairwise judge; platform fit is a contract check plus a rubric judge. The style embedding runs per draft, inside the request, so its Node feasibility is a spike, not an assumption. | low-medium | decision 21 (fidelity) |
| R6 | Jev | Out of v1; optional gated Triage trial later. | medium | none |
| R7 | Research rebuild | Search API returning URLs plus a hosted reader, $0.02-0.05 per run; Anthropic's search tool cannot feed a quote check (its fetch tool unchecked); the fetcher reuses `url-article.ts`'s SSRF guard; **forge fetches only URLs the search API returned, never URLs the model writes**, which is the exfiltration channel ADR 0015 named. | high on price, low on quality | decision 21 (grounding) |
| R8 | Document parsing | TS extractors first, hosted OCR fallback; no Python. Parsing is solved; delivery to the model is not (S4-Q1). | medium | none |
| R9 | Post images | Hybrid lane is what the market sells; generator as a registry row; default two Candidates. **gpt-image-2's per-image price is unmeasured**: the $1 figure came from a codex session total. Background refine on the default generator unverified. | high on list prices, low on rankings | decision 23 (generator default) |
| R10 | LinkedIn | Publishing under CM scopes; no history import via API; the **per-app** cap (500/day) binds, not the per-member one; the application needs a legal entity, a domain, a privacy policy and a LinkedIn Page first; Standard tier is discretionary; the Data Storage Requirements are unread. | high / medium | decision 15, 17 |
| R11 | X | Pay-per-use; connected-user reads $0.005; decaying pull ~$12 a month for 20 users; consent rule maps onto approve; refresh tokens are single-use and rotate, so refresh must be single-flight per Connected account; credits are a per-app pool. | high | none |
| R12 | Cost per post | **Corrected.** The gpt-image-2 figure was a unit error. At default settings (Nano Banana 2 ×2, Sonnet drafting) text is the largest share of a T1, images second, and the judge design of R5/R17 adds $0.16-0.78 per T1 unless the strong judge runs only at approve. The drafting-model default is an eval decision, not a cost one. Text input tokens measured on 2026-09-26 (slice 2); images and the Inputs shape pending. Working price floor $49. | low on inputs | decision 6 |
| R13 | `api` backend | Tagged `anyOf` reproduces the Output contract; direct SDKs, retries off, one recorded retry; cache the Constitution. Length and numeric constraints cannot ride in the schema: they are a deterministic post-check (S3 amendment to decision 21). | high | none |
| R14 | Python | **No long-running Python service in v1; Python is allowed offline and per job.** "Rejected" was the wrong word: R5's style embedding and R7's paraphrase check may need an offline ONNX conversion, and if that fails inside the request path the reopening condition fires. A spike settles it. | medium | decision 21 |
| R15 | Tenancy, auth, hosting | Shared schema, `tenant_id` plus RLS; Better Auth for sign-in with platform connections in forge's own table; Supabase or Neon in São Paulo; R2; Fly or Railway. Machine size must fit an ONNX style model if R14's spike passes. | medium-high | none |
| R16 | Queue and Publish | pg-boss ≥ 12.33.7; at-most-once automatic publish via a `publish_attempts` row; reconciliation on X, `needs_review` on LinkedIn. Publish is not a Run kind. | high / medium | none |
| R17 | Eval harness | evalite on vitest; cross-vendor unlabelled order-swapped judge; hashed cache; pairwise win-rate. 40 pairs give ±15 pp, so a retrieval-v2 gate cannot detect the effects R1 and R2 expect; retrieval v2 is an experiment, not a slice. | high on bias | decision on slice order |
| R18 | Portuguese Tells | No shippable list; seed plus hypotheses; Fightin' Words over the Voice's edit pairs; fix ASCII `\b`; curly quotes and the dash do not transfer. | medium / low | decision 14 |
| R19 | Disclosure and data law | **Corrected.** forge is more likely a *provider* under Art. 50(2) (placed on the market under its own name), so the machine-readable marking duty is forge's and covers text where feasible; the human-review exemption of 50(4) protects the Tenant, not forge. Deletion timelines are per source: LinkedIn API data within 10 days, X content within 24h of removal, everything else within 30 days. Lawyer before EU users. | medium | decision 24 |

## The premise, answered (as amended)

1. **"Change how our RAG works."** Half-confirmed. For Exemplars the QA machinery is unsupported and
   untested, and the paired eval decides; the selector idea (Salemi 2024) and a BM25 arm stay as eval
   arms. For **Inputs and Research** the review found a hole the research contract never asked about:
   today a document reaches the model only through the CLI's `Read` over a staged directory
   (`drafting/research-prompt.ts:61-66` lists paths, never text), and ADR 0017 allows 500 files and
   20 MB per run. On the `api` backend that is passage selection over long documents, which *is*
   document-QA-shaped retrieval. S4 decides between inline text under a hard cap, a forge-side read tool
   loop, or chunked retrieval with quote verification (S4-Q1).
2. **"Python and FastAPI."** No long-running Python service in v1; Python allowed offline and per job.
   The one live pull is the precision score's style embedding and paraphrase check, which run inside
   the request; a spike (transformers.js inference of mStyleDistance plus a multilingual NLI model on the
   target machine, measuring latency and memory) decides whether that stays in Node. If it does not,
   the Python ADR is written then, with a per-job function costed.
3. **"The reference RAG project's architecture."** Transfers as infrastructure and habits, not as retrieval shape,
   with one addition from finding 1: its chunking and quote-verified citations may be the right tool
   for Inputs after all, which is the opposite of what the brief's stance said. S4-Q1 decides.
4. **"A lot needs to go."** The Killed list grew: the `html` and `raster` lanes as launchable lanes,
   the `inspirations` table, `hook_pick`, predicted performance in the score, and the `cli` backend for
   any kind that uses Inputs, Research or images. The kept api still carries localhost-era
   consequences (a 12 MB body limit, hand-fixed stuck runs, tolerated orphan uploads, retrieval serving
   deleted posts) that S4 audits one by one.

## S3 consolidation: findings and dispositions

Fifty-five findings across two legs, deduplicated to the amendments below. "Verified" means the main
session checked the code or the arithmetic itself. Each amendment names where it landed.

| # | Finding (legs) | Verified | Disposition |
|---|----------------|----------|-------------|
| 1 | Inputs and Research have no path to the model on `api`; premise 1 answered without them (both, blocking) | yes: `research-prompt.ts:61-66` | Rebuilt list gains "Input and Research delivery"; premise 1 half-confirmed; S4-Q1; R12 must cost a draft that carries Inputs. |
| 2 | Poll schedule exceeds the per-app cap; memo merged R10's alternatives (both, blocking) | yes: 429 + 100 + 15-45 = 544-574 > 500 | Decision 17: poll days 1, 3, 7, 28 with 5 metrics; `me` weekly; beta ceiling about 30 members derived from the cap (the S4 review corrected 17, which was 350 calls divided by 20 members read as a member count); xlsx is the path beyond it; metric set fixed in S4. |
| 3 | The LinkedIn application has deliverables as prerequisites (fable, blocking); self-serve "Share on LinkedIn" publishing unchecked (opus) | n/a | Decision 15: an application pack (entity, domain, privacy policy with provisional sub-processor list, LinkedIn Page) precedes everything platform-bound; beta is X-first with LinkedIn reminders and xlsx until approval; S4-Q3 checks the self-serve route. |
| 4 | gpt-image-2 $1 figure is a codex session total; "images are 90%" inverts at defaults; judge calls uncounted; Opus-vs-Sonnet reasoning backwards (both, blocking for cost) | yes: `codex.engine.ts:6-7` | R12 note corrected; decision 6 and 23 amended; price floor $49; drafting default is an eval decision; strong judge at approve only unless costed. |
| 5 | forge is a provider, not a deployer, under Art. 50 (fable, major) | reasoning | R19 note corrected; decision 24 gains text marking where feasible. |
| 6 | Platform data retention terms unread; deletion timelines disagree; Run prompts embed metrics (both, major) | n/a | Blocking question 4; decision 24 timelines per source; X removal sweep in the outcomes slice; Run prompt retention ruled in S4. |
| 7 | Publish defined as a Run kind; "exactly-once" unachievable (both, major) | n/a | Decision 16, glossary and constraints rewritten: `publish_attempts`, at-most-once automatic, `needs_review`. |
| 8 | "No Python" overstated; style embedding is in the request path (both, major) | n/a | Premise 2 reworded; spike in the precision-score slice. |
| 9 | Premise 1 reads absence as a negative result; BM25 arm dropped from the memo (both, major) | n/a | R1 row and premise 1 reworded; BM25 as an eval arm. |
| 10 | ADR 0002's reasoning is the live gate, not dead (fable, major) | n/a | Killed → Amended, conditional on question 1. |
| 11 | Standard tier is discretionary; no plan B (both, major) | n/a | Decision 15 records the decision point and the paid product without it; claim 5 reworded. |
| 12 | Fact model is export-shaped; export parser is pt-BR only (both, major) | yes: `xlsx-parser.ts:114-116` | Fact model moves to Rebuilt (platform column, pull provenance, pull idempotency key; invariant 7 amended); per-locale label map; history outcomes on LinkedIn exist only via xlsx. |
| 13 | `edit` anchored at publish, which the LinkedIn majority never triggers; refine instructions are an unmodelled signal; CIPHER on factual edits yields noise (both, major) | yes: `posts.service.ts:273-287` | Decision 19: `edit` = last Run's Revision vs the `approved` Revision; new kind `instruction`; `hook_pick` retired; decision 20: classify, style-only, weekly cap, dedupe; validate offline on the 29 manual edits first; claim 2 pending. |
| 14 | The `cli` dev backend diverges from `api` exactly where it matters (both, major) | n/a | Decision 2: `cli` confined to text kinds with proven-identical contracts; never Inputs, Research or images; the eval gate runs on `api`; subscription-terms check is question 5. Reviewers' stronger position (kill it) is Kevin's call. |
| 15 | X credit pool vs per-Tenant budget; concurrent refresh kills tokens (both, major) | n/a | Decision 5: app-level credit floor pauses Publish and alarms; Connected account: single-flight refresh, new refresh token stored before use. |
| 16 | Form limits cannot ride in the API schema; `invalid_output` semantics break (both) | yes: R13 item 2 | Decision 21: length and structure are a deterministic post-check feeding platform fit, shown, with a shorten refine offered; never `invalid_output`. |
| 17 | Predicted performance has no method (fable) | n/a | Dropped from the v1 score. |
| 18 | Hook set never existed; retire `hook_pick` (both) | yes | Glossary Hook corrected; Signal kinds are `edit`, `instruction`, `verdict`, `outcome`. |
| 19 | Kill `html`/`raster` lanes, `inspirations`; canvas storage is a rebuild; localhost-era ADR consequences; tenant 1 migration unplanned, old Run prompts carry harness content (both) | n/a | Kept/Killed/Rebuilt rewritten; S4 gains a localhost audit and a migration slice with a scrub ruling. |
| 20 | Retrieval v2 cannot be measured as a slice (opus) | n/a | Demoted to an eval experiment; the needed changes fold into the tenancy and Signal slices. |
| 21 | Cost omissions (variator, Research, CIPHER, judges ×2, Retro, infra) and inconsistent volumes (both) | n/a | R12 note lists them; S4 fixes run composition per Tier and one volume assumption. |
| 22 | Minor contradictions: "five signals" title, `document` vs carousels, Connected account scopes, Measured circularity, day-30 vs 30-day window, voyage-3.5 delisted, one-model reason void, decision 17 misquotes ADR 0018 (opus) | yes on 0018 | All fixed in the brief and glossary. |
| 23 | claims.md marks voidable claims settled; Gemini's unpaid tier trains on data (opus) | n/a | Claims 2, 6, 10, 12 pending; claim 11 needs a no-training column on the sub-processor list; Nano Banana 2 only on a paid tier. |
| 24 | Background refine on Nano Banana 2 unverified; Anthropic web fetch tool unchecked (opus) | n/a | Open items for the image and Research slices. |

**Checked and found sound by both legs, not to be re-litigated in S4**: R2's no-reranker and one-chunk
findings; R13's contract mapping and retry policy; R15's tenancy and the Better Auth linking trap; R16's
at-least-once ceiling and `publish_attempts`; R17's judge rules; R18's boundary bug; R7's rejection of
the encrypted search tool; R11's prices and consent mapping; brief decisions 3, 10, 13 and 24; the
Killed list's original content.

## Questions only Kevin or a third party can answer

These gate S4 and the beta; the first two this week.

1. **Does Kevin have, or can he register, a legal organization** with a business email, a domain and a
   LinkedIn Page under a super admin? LinkedIn's Development tier requires all four, a rejected app
   cannot re-apply, and approval takes 4-8 weeks at best (R10). Without it the beta is X-first with
   LinkedIn reminders and xlsx analytics, which is now the written plan B.
   **Answered 2026-09-24:** Kevin has no CNPJ. The recommended path, pending his go, is an Inova Simples (Empresa Simples de
   Inovação, LC 167/2019): free, same-day CNPJ, but with no legal personality (gov.br FAQ Q21), so
   LinkedIn acceptance is unproven. A rejection closes the app, not the organization (Microsoft Learn,
   Community Management App Review); the fallback is conversion to an SLU and a new app. Kevin holds the
   step-by-step rundown with form drafts as a Claude doc ("Inova Simples rundown").
   **Update 2026-09-26:** Kevin cannot open a CNPJ for now, Inova Simples included. So plan B is the plan.
   The beta is X-first, LinkedIn runs on reminders, manual URL entry and xlsx analytics, and slice 1,
   the application pack, is parked until an entity exists. Question 3's "Share on LinkedIn" answer
   now decides whether forge can publish to LinkedIn at all before then.
2. **Ratify or reverse two S3 amendments that touch approved decisions**: the `cli` backend confined
   to text kinds (reviewers argue to kill it outright), and `hook_pick` replaced by `instruction`. Kevin ratified both on 2026-09-24.
3. **Ask LinkedIn Developer Support**: refresh-token eligibility at Development tier; whether the 2022
   API Terms' "must not automate posting" binds Community Management apps; whether "Share on LinkedIn"
   (self-serve `w_member_social`) covers text and image publishing without CM approval and can coexist
   with a CM app.
4. **Read**: LinkedIn's Data Storage Requirements and restricted-use-cases pages (retention caps decide
   whether `outcome` Signals and Run prompts may keep LinkedIn metrics); X's automation rules page in a
   browser.
5. **Terms of the Claude Code and codex subscriptions** for driving `claude -p` and `codex` from an
   application during development (no note asked).
6. **A lawyer, before EU users**: provider status under Art. 50(2), the ANPD DPO waiver, the
   sub-processor list.

## S4 open questions (not research; the grill settles them)

- **S4-Q1** How an Input and a fetched page reach the model on `api`: inline under a hard cap, a
  forge-side read tool loop, or chunked retrieval with quote verification. Caps in ADR 0017 shrink either
  way.
- **S4-Q2** The LinkedIn metric set on the API path (which five), and the beta member ceiling.
- **S4-Q3** Whether LinkedIn publishing runs on the self-serve product before CM approval.
- **S4-Q4** Per-locale export parsing (en, pt-BR) and which locales the beta accepts.
- **S4-Q5** The localhost-era audit: every ADR consequence resting on "single operator on 127.0.0.1"
  (12 MB body limit, hand-fixed stuck runs, tolerated orphan uploads, retrieval serving deleted posts).
- **S4-Q6** Tenant 1 migration: `body_x`, re-embedding, `dim_post` platform, settings → Voice, and
  whether old Run prompts holding harness snapshots and `path` Inputs are scrubbed.
- **S4-Q7** Run composition per Tier and the judge schedule (every draft, or strong judge at approve),
  so R12 can be re-run with one volume assumption.
- **S4-Q8** Retention of Run prompts that embed platform metrics, against the platform terms.

## Open items carried forward

Per note; the ones that change a decision if they turn out badly:

- Real input token counts and the gpt-image-2 per-image grid (R12): measured by the first slices.
- mStyleDistance pt-BR coverage, ONNX conversion, and memory on the target machine (R5, R14, R15).
- Brave's storage clause against a stored quote (R7); the Anthropic web fetch tool's output shape.
- pg-boss v12 CJS status (R16).
- Whether `dms-uploads` PUTs count against LinkedIn's cap (R10).
- Background refine support on Nano Banana 2 (R9).

## S4 consolidation: the architecture review

Two `reviewer` legs (opus and fable, xhigh, fresh contexts) on the spec, ADRs 0019 to 0025 and the six
amendments; 60 findings, deduplicated to the amendments below; every code claim verified against the
tree (`db/migrate.ts:19`, `schema.ts:35, 51-52, 137-145, 282`, `posts.service.ts:203, 336`,
`render.service.ts:22`, `images.controller.ts:129`, `engine.interface.ts:7`, `run-events.hub.ts:7`,
`nest-cli.json`). The spec was rewritten; ADRs 0020, 0022, 0023, 0024 rewritten; 0019, 0021, 0025
corrected; 0001, 0007, 0015, 0018 amended; ADRs 0026 and 0027 added.

| # | Finding (legs) | Disposition |
|---|----------------|-------------|
| 1 | RLS would not enforce: the api connects as the owner role; per-transaction settings need a transaction every query lacks; session `SET` leaks under the pooler; the worker has no way through; composite `SET NULL` would null the tenant column (both, blocking) | ADR 0020 rewritten: three roles (`forge_migrate`, `forge_app` NOBYPASSRLS with FORCE, `forge_system` BYPASSRLS for scanners), one transaction per request with `set_config(…, true)`, `prepare: false`, exempt tables named, column-list `SET NULL (post_id)`, Data API disabled, a sabotage test. |
| 2 | ADR 0024 retried 5xx after send, a blind retry that double-posts on LinkedIn; "unique per (Post, Platform)" and "every attempt a row" contradicted; threads had no table (both, blocking) | ADR 0024 rewritten: retry only pre-send failures; post-send errors are crashes; numbered attempts with a partial unique index on live states; `publish_segments`; compare-and-set claim. |
| 3 | The X removal sweep was unpriced: up to $9,600 a month at the import cap (both, blocking) | 12-hour sweep; mechanism fixed by measurement in the Publish slice (batch compliance jobs first); billed to the app; recorded in ADR 0024 and the spec. |
| 4 | The beta opened before the surfaces it needs; slice 3 needed a corpus that arrives in slice 10; tenancy after slices that create per-Tenant tables; every migration's backfill misplaced (both, blocking) | Slice graph rewritten: tenancy schema third, corpus and eval fourth with a one-off import of Kevin's history, every slice ships its web surface and keeps the smoke green, the physical move is its own slice, expand/contract migrations. |
| 5 | The member ceiling was 350 calls divided by 20 read as members; the cap serves about 30 (fable, major) | Corrected in the brief, ADR 0002, ADR 0024 and this memo's S3 table. |
| 6 | "Template plus context row" reconstructs nothing (no template or Constitution versions; Exemplar ids point at changing bodies; three readers of `runs.prompt`) (both, major) | ADR 0026: the rendered prompt stays as the audit, a context row sits beside it, deletion terms met by redaction of a delimited stats block. Invariant 6 unchanged. |
| 7 | Siblings had no data model; `ideas.promoted_post_id` breaks with two Posts (both, major) | `posts.idea_id`; the Idea returns when its last Post is deleted; ADRs 0021 and 0018 amended. |
| 8 | An approved body stays editable and would publish unseen (both, major) | Any content change to an approved Post disarms it and returns it to `draft_ready`; a past time at approval asks. ADR 0022, glossary Armed. |
| 9 | Model runs on the worker had no cross-process console; closures cannot be queued; a shared deploy kills runs (both, major) | ADR 0027: model runs stay in the api process, `runs.machine_id` plus `fly-replay`, drain on deploy, auto-stop off; the worker runs queue jobs only. |
| 10 | The renderer runs client HTML in an unsandboxed in-process Chromium with network access, inside the process holding every secret; no container exists (opus, blocking) | ADR 0027: a separate Fly app, sandbox on, no secrets, `page.route` aborting all but `data:` and fonts; fifth item of the localhost audit. |
| 11 | "`Engine` unchanged in shape" was false; Google SDK missing; `runs.engine` is an enum; the hybrid lane depends on codex writing files (both, major) | ADR 0019 corrected: v2 request and result shapes, provider text column, Google SDK, the background step rewritten against `ImageGenerator`. |
| 12 | The Research loop contradicted itself: who generates queries, who fetches, and a cache argument that was wrong (both, major) | ADR 0023 rewritten: a managed Run (`research_plan` step, forge fetches through its own guard with local extraction, then the draft); Jina dropped. |
| 13 | Imported history had no table; the "other authors" floor had no permitted source under decision 24 (both, major) | `corpus_items`; the negative corpus is a fixed public or licensed set per language (ADR 0025). |
| 14 | The fact model could not take pulls or X posts (NOT NULL URN, URL, file); keys collide across tenants (both, major) | ADR 0007 amended with the explicit schema; the collided keys listed in ADR 0020. |
| 15 | A Budget that refuses would block compliance reads and Armed publishes; output tokens are unknown before a call; failed calls unrecorded (opus, major) | Reserve-then-settle under a row lock; compliance, pulls and Armed publishes billed to the app; usage on every exit path; failure kind `budget`; invariant 1 split. |
| 16 | `outcome` Signals came only from API pulls, so export-path Voices never learned; Retro's trigger assumed slow measurement (opus, major) | An `outcome` Signal on every fact, pull or export link; Retro trigger "N measured or a week". |
| 17 | Local times stored as UTC break on zone or DST change; the columns were missing (fable, major) | Local wall-clock columns kept, `voices.time_zone`, the poll computes. |
| 18 | The Constitution's parts had no home; rule proposals had no status (fable, major) | `style_docs`, `playbook_rules.voice_id`, `rule_proposals`. |
| 19 | C2PA cannot survive a screenshot (opus, major) | forge signs its own manifest or the disclosure is the optional label; a spike in the image slice; claim 14 stays pending. |
| 20 | Retrieval v2 cannot be measured at 40 pairs (opus, major) | An eval experiment, not a slice. |
| 21 | Minor: `document`/carousel wording; "decision 26"; Adapt cross-Voice wording; invites global; PITR is an add-on; `gru` unverified; renderer "container" did not exist; the bundle test had no bundle; vocabulary drift on Failure strip, segments, Armed; the $12 X figure was six polls; `cli` shows no score; the ledger survives deletion; the 1h TTL pays only with three calls an hour; the sweep cadence; refresh crash recovery; allowlist oracle; presigned PUT conditions and pending-upload rows; Sentry scrubbing; expand/contract; `Linkedin-Version` alarm; X length rules by tier; shared rate limits; the X app as a single point of suspension; S4-Q3, Q4, Q7 stated; Supabase Data API (both) | All fixed in the spec, the ADRs and the glossary. |

**Checked and found sound by both legs**: the Output contract mapping and retry policy for model
calls; the Input caps; the `cli` confinement; search-returned URLs only with the 200-character query
cap; the Signal kinds and the no-rewrite rule; the Better Auth linking trap; the minute poll over
enqueue-at-arm; the day-28 X poll; the deletion timelines; ADR 0018's four audit items.

### Ratification: five amendments change answers Kevin gave in the S4 rounds

Kevin ratified all five on 2026-09-24.

1. **Run storage** (round 1, Q2): the rendered prompt is kept as the audit and a context row sits
   beside it; deletion is by redaction, not a row delete (ADR 0026).
2. **The fetcher** (round 2, Q14): forge fetches itself through its own guard with local extraction;
   Jina Reader is dropped, because a reader on its own network makes the guard moot (ADR 0023).
3. **The renderer** (round 1, Q15): a separate Fly app with no secrets, not "the Playwright container
   that exists", which does not exist (ADR 0027).
4. **Where model runs execute**: in the api process with `fly-replay` for the console, not on the
   worker (ADR 0027).
5. **An approved Post that changes is disarmed** and returns to `draft_ready` (new rule, ADR 0022).

The slice order also changed (finding 4); it was a spec statement, not a grill answer, and needs no
ratification.
