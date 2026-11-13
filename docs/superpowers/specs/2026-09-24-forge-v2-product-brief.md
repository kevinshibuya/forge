# forge v2: product brief

**Written 2026-09-24** by the main session (fable) from a four-round grill of Kevin, 28 questions,
every one answered with the recommended option or a stated amendment. Kevin approved the tree at the
close of round 4. Starts from `ai-staging` at `d2863a0`.

**Status**: brief approved; S2 research complete (`docs/research/2026-09-24-forge-v2-research-memo.md`);
S3 adversarial wave applied the same day (two `reviewer` legs, opus and fable; the codex leg was not
run, by Kevin's call). Amendments from S3 are marked `[S3]` in place. Two of them touch decisions Kevin
approved; he ratified both on 2026-09-24 (memo, question 2). The S4 architecture spec and ADRs 0019 to 0027 are written and reviewed, and Kevin ratified the five further amendments listed in the memo's "S4 consolidation" the same day. Nothing in `app/` changes on the strength of
this brief alone.

This is the first of five phases that take forge from a local, single-user LinkedIn tool to a hosted
product. It settles *what the product is* so that research (S2), the adversarial review of the
premise (S3), the architecture spec (S4) and the slice plans (S5+) all aim at the same thing. It
decides nothing about stack, libraries or languages: every such question is deferred to evidence,
and the questions are numbered at the end.

## What was verified before deciding

Facts gathered by three read-only scouts on 2026-09-24. Paths are relative to the repo root unless
stated.

- **forge's retrieval is one mechanism with one job.** `app/api/src/retrieval/retrieval.service.ts:23-57`
  runs cosine top-k over a pgvector `embeddings` table (`db/schema.ts:271`, `vector(1536)`, HNSW,
  source types `post | idea | inspiration | retro_note`), embedded with OpenAI `text-embedding-3-small`
  in fixed 4000-character chunks (`embeddings.service.ts:12-16`). No rerank, no lexical arm, no join to
  `posts` (issue #24). Its only caller is `drafting.service.ts:334`, which uses the neighbours as
  Exemplars. What the app calls research is a different mechanism: the `claude` CLI reading a staged
  snapshot of `~/.claude` with `Read`, `WebSearch` and `WebFetch` inside a fence (ADR 0015, 0017).
- **Every model call is a CLI subprocess on Kevin's subscription** (ADR 0003): `engines/claude.engine.ts:143`
  spawns `claude -p --output-format stream-json --model … --json-schema`, `codex.engine.ts` spawns codex
  with no schema. No SDK, no API keys, no per-call cost. The only metered call is the embedding.
- **Engagement enters by hand.** ADR 0002 rejected the LinkedIn API on User Agreement §8.2; analytics come
  from uploaded xlsx exports into a two-grain fact model (ADR 0007, 0008). The learned layer is Playbook
  rules from Retro runs, plus Exemplar stats.
- **Tenancy does not exist.** No users table, one `settings` row, `posts.body_linkedin` and `posts.body_x`
  with no platform column, no auth, no deployment target. The 2026-07-11 founding spec lists
  "multi-user, auth, deployment beyond localhost" and "X posting workflow" as non-goals.
- **Size.** 413 tracked files; 19.0k lines of TS in `api`, 13.6k in `web`, 1.6k in `shared`; 109 spec
  files across the three workspaces.
- **The reference RAG project (the architecture Kevin admires) is TypeScript.** Its RAG is generic
  infrastructure: structure-aware chunking, contextualized embeddings, a vector arm and a lexical arm fused
  by RRF, quote-verified inline citations, a content-addressed ingestion cache, a Postgres job queue, a
  per-task model registry with a cost ledger, and a golden set that gates rerankers.
- **Platform APIs, 2026-09-24.** LinkedIn member post analytics exist through the official API since
  2025 (`memberCreatorPostAnalytics`, scope `r_member_postAnalytics`), but only with Community Management
  API approval: Development tier by default (500 calls per app per day, 100 per member per day, 12 months
  to graduate), Standard tier by separate application at LinkedIn's discretion. Posting as a member
  (`w_member_social`) is self-serve. §8.2 bans scrapers and browser plugins; Taplio reads stats through
  one. X is pay-per-use with no tiers (post $0.015, $0.20 with a URL; owned reads $0.001; own-post
  impressions via user-context OAuth for 30 days). Reddit requires manual pre-approval for all API access
  since November 2025 and negotiates commercial use from a reported ~$12k/month floor. Items marked
  secondary in the scout's sheet are re-verified under research question R10 and R11.
- **Jev** is TypeSafe's `jev-1.13.0` classifier (released 2026-09-15): context plus closed typed
  questions in, calibrated confidence out, 70-500 ms, $0.042 per 1M input tokens, no prose. The reference RAG project
  measured it on four tasks: 5/5 on document type; 0/29 on unsupported citations in real pairs; missed
  every sufficiency bar; a net loss as a reranker against Voyage `rerank-3`.

## The product

forge (a working title) is a hosted, multi-tenant service that writes and publishes one Voice's posts on
LinkedIn and X, with a branded image when the Form calls for one, learns from every edit its owner makes,
and lets that owner approve every rule that changes how it writes. It drafts and judges; the owner keeps
the final say on every word published and every rule change. That sentence is the 2026-07-11 founding
line with the platform count and the tenancy changed, and nothing else.

The first external users are solo professionals and founders building one personal brand. Kevin is
tenant 1 and his records migrate in.

## Decisions

Each decision names the grill question that settled it (Q1 to Q28), what it kills or reopens, and the
reason that carried it. Terms in bold are defined in `CONTEXT.md`.

### Product and scope

1. **Hosted, multi-tenant SaaS; the local app dies as a product** (Q1). Self-hosting sells to developers;
   two profiles double every test matrix. Reopens the founding spec's non-goals.
2. **The CLIs stay as the development backend** (Q1, Q8, Q13). `fake` for tests, `cli` for local
   development on Kevin's subscription, `api` on product-owned keys in production. The backend is chosen
   by the deployment, never by the tenant. **The production build contains no CLI code**: the `cli`
   backend is its own package the hosted build never imports, and a test proves the absence. Amends
   ADR 0003 and glossary invariant 1. The Output contract stays engine-enforced on both real backends
   (ADR 0016 holds): `--json-schema` on the CLI, structured output on the API.
   `[S3]` The `cli` backend serves run kinds whose Output contracts are proven identical on both
   backends (triage, draft, refine, retro, the image lane's text steps) and image generation through a
   codex generator row that exists only on `cli` (decision 23 makes the generator a registry row, so the
   lane code is shared and only the row differs). It never serves a run with Inputs attached or a
   Research run, because there the mechanism differs, not the vendor: the CLI reads a staged directory
   with `Read` and searches with its own tools, the api delivers documents per S4-Q1 and searches through
   an API, and a dev run down the CLI path proves nothing about the hosted one. The eval gate (R17) runs
   on `api`. Both reviewers argued to kill `cli` outright; Kevin kept it on 2026-09-24 for its reason
   (no metered billing for routine drafting and image work in development), with the confinement above.
   The subscription terms for driving `claude -p` and `codex` from an application are memo question 5.
   Kevin ratified the `hook_pick` → `instruction` replacement the same day.
3. **Solo persona; Voice as an entity** (Q2). One **Voice** per **Tenant** in v1, modelled so that a
   ghostwriter's clients are several Voices under one Tenant later. No seats, no roles in v1.
4. **LinkedIn and X in v1; Reddit known to the model, out of scope** (Q3). Two platforms force the
   abstraction honestly. Reddit is out on facts: pre-approval at Reddit's discretion and a negotiated
   commercial contract.
5. **Free, invite-only beta with a per-Tenant post budget; billing at public launch** (Q26). The cost
   ledger and the budget get exercised by real usage before a price is set on them. `[S3]` Images and
   platform API calls are metered separately from text. X credits are a per-app pool, so an app-level
   credit floor pauses Publish and alarms Kevin before the pool empties; a per-Tenant budget alone
   cannot see that failure coming (R11).
6. **Price and cost ceiling come from the cost model** (Q9). `[S3]` R12's first cut mispriced images
   by an order of magnitude (a codex session token total was read as image-output tokens). Working
   assumptions until the `api` ledger has a month of data: a T1 at or under $0.50 on default settings
   (Nano Banana 2, two Candidates, Sonnet-class drafting, strong judge at approve only); a price floor of
   $49 for the solo tier, with premium image generation shown with its price per post. The drafting
   model's default is an eval decision (R17), not a cost one: once images are cheap, text is the
   largest share of a post.
7. **Speed is the only schedule** (Q12). No time or quota tracking; slices are ordered by shortest
   path to a beta with a handful of users Kevin can talk to.
8. **Intake stays typed capture plus URL paste** (Q25). Extension, email-in and share sheet are parked.
9. **The public name is decided after the beta** (Q28). Code and database keep `forge`.

### The model

10. **A Post is one publication on one Platform** (Q15). `posts` gains a platform; `body_x` dies; an
    Idea may promote to several Posts. **Sibling posts** know each other. Rejected: one Post with N
    per-platform variants, because it moves status, hook, schedule and measurement off Post and guts the
    state machine, Planner, Workspace and analytics link for no gain over siblings.
11. **Adapt makes the sibling, on demand** (Q19). Promote creates one Post on one Platform; **Adapt** is
    an action on that Post's Workspace. The edited, approved body is a better source than a parallel
    draft from the Idea, and Ideas that never earn a second platform cost nothing extra.
12. **Tier stays the weight class; Form is the shape** (Q20). **Form** picks the Output contract per
    (Platform, Form): `linkedin` `text | text_image | document`, `x` `post | post_image | thread`. Tier
    suggests a Form; the user may override. `document` is modelled and out of v1; `[S3]` when it enters
    it is LinkedIn's Documents API (PDF), because organic carousels do not exist in the Posts API (R10).
13. **Sign-in and connecting are separate acts** (Q14). Email or Google signs a person into the Tenant;
    a **Connected account** attaches one platform account to a Voice with the scopes to publish, read
    its metrics and, where the platform permits (X, not LinkedIn), import its history, revocable on its
    own. `[S3]` Token refresh is single-flight per Connected account, the new refresh token stored
    before the access token is used: X refresh tokens are single-use, and a publisher and a metrics
    poller refreshing concurrently would kill the connection (R11, R16). Rejected: sign-in with LinkedIn or X, which
    ties the account's existence to a revocable platform token and cannot serve several Voices.
14. **One language per Voice; English and Portuguese in v1** (Q24). Tells and Style docs are per
    language. A bilingual person is two Voices.

### Publication

15. **Publish through APIs where a platform allows it; export upload as the fallback** (Q4). A
    scheduler that cannot publish is half a product. Amends ADR 0002 and ADR 0006.
    `[S3]` The LinkedIn Community Management application cannot start "on day one": it needs a
    registered legal organization, a business email, a domain with a privacy policy (which needs the
    sub-processor list, which needs S4's vendor choices) and a LinkedIn Page under a super admin; a
    rejected app cannot re-apply; approval takes 4-8 weeks at best (R10). So an **application pack**
    is the first platform-bound slice, and the beta is **X-first**: LinkedIn runs on reminders, manual
    URL entry and xlsx analytics until approval lands. Whether the self-serve "Share on LinkedIn"
    product covers text and image publishing without CM approval is memo question 3. The Development
    tier's per-app cap serves about 30 members (decision 17); Standard tier is granted at LinkedIn's
    discretion, so the paid product is defined without it: X in full, LinkedIn reminders plus xlsx.
    LinkedIn API analytics is beta-scale until Standard lands.
16. **Approved plus a time plus a live account means Armed** (Q21). **Publish** posts an **Armed**
    Post at its time; a failure emails the Tenant and shows a Failure strip. A date without a time, or a
    missing or revoked account, leaves a reminder that says why. Rejected: a separate "schedule
    publish" act, because `approved` already says the text is final.
    `[S3]` Publish is not a Run kind: it makes no model call and has no payload for an Output contract.
    It is a `publish_attempts` row per (Post, Platform) with states `intent → in_flight → published |
    failed | needs_review`, at most one automatic post per row, and the Failure strip reads from it
    (R16). A crash between the platform POST and the commit is reconciled on X by listing the user's
    recent posts; on LinkedIn it cannot be (the listing scope is unavailable), so it lands in
    `needs_review` for the user to check. The Workspace shows the platform's rendering of the body
    before approval, which is X's consent rule (R11).
17. **Measured means outcomes have landed and keep landing; a measured Post is deletable** (Q22).
    Deleting in forge never unpublishes. Amends ADR 0018. `[S3]` ADR 0018's reason was not re-import
    cost: it was that facts "cannot be regenerated, and with the post gone there is no URL left to heal
    them against". v2 accepts that loss: a deleted Post's outcomes stay as unlinked facts on every
    source. Outcomes arrive within a day, not hours. The pull schedule is fixed by LinkedIn's per-app cap
    (500 calls a day, one metric per call, no batch): each post is polled on days 1, 3, 7 and 28 for a
    fixed set of five metrics (S4-Q2 names them), the member-level `me` aggregate weekly; that is about
    350 calls a day for 20 members with publishing included, and it caps the beta at about 30 members
    on the API path, with xlsx upload as the analytics path beyond that. X `non_public_metrics` are
    readable for 30 days, so the last poll is day 28. Retention follows the strictest applicable term
    per source (decision 24).
18. **forge never posts the same body twice to one Platform.** Adapt produces siblings across
    platforms, not duplicates within one; X's automation rules ban near-duplicates. `[S3]` Delivery is
    at-most-once automatically (decision 16); an ambiguous outcome goes to `needs_review`, never to a
    blind retry.

### Learning

19. **Four Signal kinds feed adaptation; the edit is primary** (Q5). **Signal** has four kinds:
    `edit`, `instruction`, `verdict`, `outcome`. Imported history is corpus (Exemplar material), not a
    Signal. `[S3]` `hook_pick` is retired: the code never proposed a Hook set (R3), and building one
    adds a gate before approve for a signal too sparse to read at beta volume. In its place,
    `instruction` records the text a user types into a Refine or Selection refine, which is a
    preference already stated and today survives only inside `runs.prompt`. `edit` is the difference
    between the last Run's Revision and the **`approved`** Revision (Approve writes it; Publish may add
    a later one), because approval is the event every Post reaches and publishing is not. "Primary"
    means mechanically: `edit` and `instruction` feed proposals; the approved body is the retrievable
    text; `verdict` and `outcome` are weights.
20. **Signals steer selection silently and feed proposals explicitly; nothing rewrites the Constitution
    unasked** (Q17). Layer one: Exemplar selection prefers the approved body and weights neighbours by
    `verdict` and `outcome`. Layer two: Retro reads Signals as well as measurements and proposes
    Playbook changes, each approved or rejected. Rejected: silent rewriting of persona or Style docs.
    Optimisation is allowed over selection and proposals, never over the Constitution. `[S3]` The
    proposal path classifies each edit (style, fact, topic) and infers a preference from style edits
    only, capped per week, deduplicated against active rules, so factual corrections do not become
    proposal fatigue (R4). It is validated offline on tenant 1's 29 existing manual edits before it is
    built for anyone else.
21. **Precision is a measured, shown, per-draft score and never a gate** (Q6, Q27). Four measured parts:
    voice fidelity against the Voice's corpus, grounding of factual claims in Sources, platform fit
    against the Form contract, Tells. `[S3]` Predicted performance is dropped: no method supports it
    (R4), and an unvalidated number contradicts the honesty this decision rests on. Fidelity is shown
    as a position between two floors computed from the same corpus (the author's held-out posts; other
    authors' posts), never as a percentage (R5). Grounding is the fraction of factual claims with a
    verified quote in a fetched Source, paraphrases labelled as such (R7). Platform length and
    structure cannot ride in the API's JSON schema (R13), so they are a deterministic post-check that
    feeds platform fit and offers a shorten refine; an overrun is never `invalid_output`, which keeps
    ADR 0016's meaning (a broken contract is a bug). The style embedding runs inside the request, so
    its Node feasibility (ONNX in transformers.js, memory on the target machine) is a spike at the
    start of the precision-score slice; Portuguese fidelity may be judge-only until an embedding is
    validated for pt-BR.
22. **Onboarding imports history and drafts the Voice** (Q10, Q23). Connect accounts, import history,
    then a **Voice profile** run drafts the persona doc and initial Playbook rules as proposals; the
    user edits and approves before the Voice drafts anything. A new account with no posts answers a
    short form. `[S3]` On X the import is one API call sequence (up to 3,200 posts, depth shown with its
    cost). On LinkedIn the API cannot list a member's posts under any scope forge can get, so history
    is the member's own export (Shares.csv, 24-72 hours to arrive): a two-visit onboarding. Imported
    LinkedIn history carries no outcomes unless the user also uploads the xlsx analytics export;
    outcome weighting otherwise applies only to posts published after onboarding (R10).

### Images

23. **Images ship in v1** (Q7). The hybrid lane and the canvas editor stay; the generator moves off the
    codex CLI to an API. Adapt may carry the source Post's selected Candidate across as a Reference
    image for the target Form's aspect. `[S3]` The generator is a model-registry row (default Nano
    Banana 2 at 1K on a paid tier, since Google's unpaid tier trains on inputs; gpt-image-2.5 as the
    premium choice shown with its price); the default batch is two Candidates with more on demand; the
    `html` and `raster` lanes are retired as launchable lanes (the web never launched them, and raster
    was the codex path). gpt-image-2's per-image price is unmeasured until one direct API call per
    quality and size records `output_tokens_details` (R12). Whether Background refine works on the
    default generator is unverified; if not, it routes to the premium generator with its price shown
    (R9). Candidate storage and the canvas save path move to object storage (R15).

### Data promise

24. **Per-Voice learning only; a Tenant deletes whole** (Q18). No cross-tenant training, anonymised or
    otherwise; deletion revokes tokens and removes everything the Tenant owns, the way ADR 0018 deletes a
    Post whole. Both go on the marketing page. `[S3]` Timelines follow the strictest applicable term per
    source: LinkedIn API data within 10 days of a request or departure (Marketing API Terms §4.2), X
    content within 24 hours of a removal (Developer Policy, which also needs a removal sweep in the
    outcomes slice), everything else within 30 days (GDPR Art. 12(3)); sub-processors receive the
    deletion request, and each one's no-training terms are a column on the sub-processor list (R19).
    Under the EU AI Act forge is more likely a provider than a deployer, so machine-readable marking of
    generated images (keep the generator's C2PA through the composite step) and, where feasible, text
    is forge's duty; the approve step is logged as the Tenant's human-review record (R19). X's
    revocation is programmatic; LinkedIn's is a link to the member's settings, and the claim says so.

## Kept, killed, rebuilt

`[S3]` This list was rewritten by the review; the original is in git.

**Kept**: the design system and palette; the content spine (Idea → Triage → Promote → Post → Revision,
with Promote now taking a Platform); Runs as the audited unit with Output contracts and Failure kinds;
Style docs and Tells (per language); Playbook and Retro; the grain discipline of ADR 0007; the hybrid
image lane, the variator and the canvas editor; the Planner; Sources and Inputs (`file`, `url`) as
concepts; `inputs/url-article.ts`'s SSRF guard.

**Killed**: the CLI engines in production, and the `cli` dev backend for any kind touching Inputs,
Research or images; the Staged root's harness snapshot of `~/.claude`; the `path` Input kind;
`posts.body_x`; the single `settings` row as the persona's home; the `html` and `raster` lanes as
launchable lanes; the `inspirations` table and embedding source type; `hook_pick`; predicted
performance in the score.

**Amended, not killed**: ADR 0002. Its reasoning (the API is gated behind a registered organization, a
business email, a verified Page and a discretionary tier promotion) is confirmed by R10 and is the live
gate; what changed is that a company can apply. The export stays the primary LinkedIn analytics path
until Standard tier, which may never come.

**Rebuilt**: engine backends; Research (a search API returning URLs, a hosted reader over the existing
SSRF guard, quote verification; the per-Post toggle and Sources stay; forge fetches only URLs the search
API returned); **Input and Research delivery to the model on `api`** (S4-Q1: today a document reaches
the model only through the CLI's `Read` over a staged directory, and ADR 0017's caps of 500 files and
20 MB per run cannot become prompt text); the analytics fact model's keys and provenance (a platform on
`dim_post`, pull provenance beside Source file, a pull idempotency key of (post, metric, as_of) so
invariant 7 stops being "the file hash"); the export parser (per-locale label maps: today it reads
only a pt-BR export); onboarding; Candidate storage and the canvas save path (object storage); Publish
(a `publish_attempts` state machine); tenant 1's migration (`body_x`, re-embedding, `dim_post`
platform, settings → Voice, and a ruling on old Run prompts that hold `~/.claude` snapshot content and
`path` Input manifests).

**Audited in S4** (S4-Q5): every ADR consequence that rests on "single operator on 127.0.0.1": the
12 MB api body limit (ADR 0017), stuck `running` runs fixed by hand and tolerated orphan upload
directories (ADR 0018), retrieval serving a deleted Post's text (issue #24).

## Constraints the architecture inherits

- No CLI code in the production build (decision 2), proven by a test.
- Every model call is still an audited Run with its full prompt and output (invariant 6).
- Tenant isolation is absolute: nothing a Tenant owns is readable by another (decision 24).
- Per-Tenant budget enforced by a cost ledger on every metered call (decision 5).
- The Output contract is enforced by the engine on every backend (ADR 0016); constraints the backend
  cannot enforce (length, ranges) are post-checks that feed a score, never `invalid_output` `[S3]`.
- At most one automatic post per (Post, Platform); an ambiguous outcome goes to `needs_review`, never
  to a blind retry (decisions 16, 18) `[S3]`.
- Research fetches only URLs the search API returned for the run's queries, never URLs the model
  writes; model-written search queries are capped in length (the exfiltration channel ADR 0015 named)
  `[S3]`.
- Token refresh is single-flight per Connected account (decision 13) `[S3]`.
- Tells never block; the precision score never gates (decision 21).

## The premise under review

Kevin's opening request named three things the S3 adversarial review must attack, alongside the main
session's initial stance on each. Neither side is decided here.

1. *"Change how our RAG works."* Stance: forge's retrieval is Exemplar selection for few-shot prompting,
   not document QA, and the precision Kevin wants lives mostly in signals, contracts and judging, not in
   chunking. R1 to R3 test this.
2. *"Introduce Python and its RAG ecosystem with something like FastAPI."* Stance: a second runtime is
   justified only by a named library whose absence costs more than a second deploy, test suite and
   contract. Candidates so far: DSPy (R4), docling or unstructured (R8). If one enters, it enters as a
   narrow sidecar for that job, not as the home of the RAG. R14 frames it.
3. *"The reference RAG project's architecture."* Stance: its generic parts (contextualized embeddings, hybrid RRF,
   content-addressed ingestion, model registry with cost ledger, golden-set gating) transfer to forge as
   TypeScript; its retrieval shape is built for long documents and may not fit a corpus of 200 posts of
   1,500 characters. R1 and R2 test this.
4. *"A lot needs to go."* Stance: 19k lines of working api and 109 spec files are the product; what
   goes is listed under Killed and it is small. The S3 review is asked to name anything else that should
   go, with a reason.

`[S3]` The wave's verdict on each, in full in the memo: (1) half-confirmed, because Inputs and Research
delivery on `api` is a document-retrieval problem the contract never asked about; (2) held, reworded
to "no long-running Python service", with a spike that can reopen it; (3) transfers as habits, and its
chunking and quote verification may serve Inputs after all; (4) the Killed list grew by six items and
the kept api gets a localhost audit.

## S2 research contract

**Method.** One research agent per question, with web access, returning: a verdict in one sentence,
the evidence with URLs and page dates, what was measured by whom on what data, and the decision the
verdict feeds. Primary sources over blog posts; a claim from a vendor's own page is marked as such.
Each note lands at `docs/research/2026-09-<dd>-<slug>.md`; a memo at
`docs/research/2026-09-<dd>-forge-v2-research-memo.md` carries every verdict with its confidence and
the open items. The S3 review reads the memo and this brief together. Every question below is aimed at
a decision this brief left open; a finding that does not change a decision is noted and not pursued.

**R1. Exemplar selection for generation.** Does document-QA retrieval machinery (structure-aware
chunking, contextualized embeddings, hybrid lexical arms, reranking) improve few-shot example selection
for text generation over plain dense similarity, on corpora of a few hundred short texts? What does the
few-shot example selection literature say (similarity, diversity, performance-weighted, learned
selectors)? Feeds: retrieval v2 design; whether chunking exists at all for posts under ~3,000 characters.

**R2. Embedding model for short bilingual social text.** Voyage (`voyage-3.5`, `voyage-context-4`),
OpenAI `text-embedding-3-large`, Gemini embedding, Cohere embed v4, open models: quality on short
English and Portuguese texts, price, dimensions, rate limits, contextualized-chunk value when a document
is one chunk. Feeds: embedding provider ADR; decision on reranking (does `rerank-3` or Cohere rerank
help when k is small and the corpus is tiny?).

**R3. What forge already captures.** A code fact-find, not web research: is the proposed Hook set kept
alongside the chosen one; what `post_revisions` allows the `edit` signal to compute; what the Retro
prompt reads today. Feeds: Signal capture slice.

**R4. Learning from edits and outcomes for generation.** Methods that turn user edits into better
drafts: learning latent preferences from edits (Gao et al. 2024 and successors), DSPy optimisers (MIPROv2,
GEPA), TextGrad, edit-conditioned few-shot, outcome-weighted selection. What is measured to work on
personalised writing; which are Python-only. Constraint from decision 20: optimisation may act on
selection and proposals, never on the Constitution. Feeds: adaptation design; Python entry (R14).

**R5. Judging voice fidelity and platform fit.** LLM-judge designs for style and authorship (pairwise
versus rubric, calibration, judge model size), authorship-verification embeddings (LUAR, StyleDistance
and the like), reference-based scoring against a corpus; cost per judgement. Feeds: the precision score
(decision 21); judge model in the registry.

**R6. Jev on forge's tasks.** Any external measurement of `jev-1.13.0` on tier-style classification,
rubric scoring and pattern flagging; what a labelled sample and confidence threshold must look like
before wiring, following the reference RAG project's method. Feeds: whether Jev enters Triage, platform-fit scoring or
Tell pre-filtering. Not voice fidelity (text-against-text is where it failed).

**R7. Research without a home directory.** Web search APIs (Exa, Tavily, Brave, Perplexity Sonar,
Anthropic's web search tool, OpenAI's) on price, quality, terms of use for content generation;
sandboxed fetch and readability (Jina Reader, Firecrawl, self-hosted); citation verification for short
posts (quote-in-source checking as the reference RAG project does). Feeds: the Research rebuild; grounding part of the
precision score.

**R8. Document parsing for Inputs.** PDF and URL to Markdown: docling, unstructured, Mistral OCR,
LlamaParse, pdf.js and pdf-parse; quality on the input types forge takes; TS availability versus
Python-only. Feeds: Inputs pipeline; Python entry (R14).

**R9. Post images.** How Taplio, Typefully, Buffer, Canva, Predis, ContentStudio, Supergrow and
AuthoredUp produce post images (templates, generative, hybrid); generative image APIs with reliable text
rendering (gpt-image-2 API, Imagen 4, Flux, Ideogram, Recraft) on price and latency; HTML-to-image
rendering services versus Playwright; brand-consistency methods. Feeds: image lane rebuild (decision 23).

**R10. LinkedIn, from primary sources.** Community Management API approval: what the Development tier
asks for, reported timelines and rejections, whether the tier's 100 calls per member per day serve a
beta; Posts API image and document publishing for members; token lifetime and refresh (60-day tokens,
refresh-token eligibility); reading a member's own posts for history import; reports of LinkedIn
blocking or throttling API publishing; whether a user may upload their own data export to a third party;
Shares.csv format. Feeds: publish path (decision 15), onboarding import (22), ADR 0002 amendment.

**R11. X, from primary sources.** Pay-per-use terms: per-user and per-app caps, OAuth 2.0 user-context
posting, media upload, thread creation, owned reads for history import, the 30-day `non_public_metrics`
window, the automation and duplicate-content rules, any AI-content rule; X archive format. Feeds: as R10
for X; the fetch cadence for outcomes (decision 17).

**R12. Cost per post at production prices.** Token counts of the current prompts per run kind (triage,
draft T1 to T3, adapt, image plan, generation and review, retro, voice profile, judge, embeddings) times
2026 API prices for Anthropic, OpenAI, Voyage and the image APIs; caching effects; platform API cost per
publish and per metrics pull. Feeds: price point and cost ceiling (decision 6), the model registry, the
per-Tenant budget (decision 5).

**R13. The `api` backend.** Anthropic Messages API structured output (JSON schema, tool use) and OpenAI
structured outputs as equivalents of `--json-schema`; streaming to the existing SSE console; direct SDKs
versus the AI SDK the reference RAG project uses; retries and rate-limit handling. Feeds: engine backend design
(decision 2), ADR 0003 amendment.

**R14. Python, framed as libraries.** For each Python-only candidate R4 and R8 surface: the cost of a
FastAPI sidecar (deploy, tests, contract, latency) against a TS port or a hosted API offering the same.
Feeds: the Python decision, one ADR either way.

**R15. Tenancy, auth and hosting.** Postgres multi-tenancy with pgvector (RLS, schema-per-tenant,
app-level scoping); managed Postgres with pgvector (Supabase, Neon, others); auth providers for email
and Google sign-in with separate platform OAuth (Auth.js, Clerk, Supabase Auth, WorkOS); object storage
for Candidates and Inputs. Feeds: tenancy and auth ADRs (decisions 1, 13, 24).

**R16. Queue and scheduler for Publish.** pg-boss, graphile-worker, a Postgres advisory-lock queue as
in the reference RAG project, BullMQ with Redis: exactly-once semantics for Armed posts, retry, visibility. Feeds:
Publish infrastructure (decisions 16, 18).

**R17. Eval harness for content.** Golden-set design for voice and platform fit; judge frameworks in TS
(promptfoo, Braintrust, evalite) versus Python (ragas, deepeval); how to keep a per-Voice eval cheap.
Feeds: the eval slice, which precedes retrieval v2 in the plan order.

**R18. Portuguese Tells.** Existing lexicons of AI-tell patterns in Portuguese; whether the English list
transfers; how to build one from a labelled corpus. Feeds: per-language Tells (decision 14).

**R19. Disclosure and data law.** EU AI Act Article 50 transparency duties for AI-generated content
(applicable from August 2026), platform AI-label rules, LGPD and GDPR duties for storing platform tokens
and a user's corpus, deletion timelines. Feeds: the data promise (decision 24), any disclosure UI.

## The split ahead

- **S2**: done 2026-09-24; nineteen notes and the memo in `docs/research/`.
- **S3**: done 2026-09-24; two `reviewer` legs (opus, fable), consolidated inline on Fable; the codex leg
  was not run. The amendments are in this file, marked `[S3]`; the record is in the memo.
- **S4**: `grill-with-docs` on this brief and the memo, starting from the memo's questions for Kevin and
  its S4 open questions; ADRs (amend 0002, 0003, 0006, 0016, 0017, 0018; new ones for backends, tenancy
  and auth, platform model, Signals, Input and Research delivery, Publish, Python); the architecture
  spec; one review wave, one fix pass.
- **S5+**: one plan per slice, executed on Opus, ordered by shortest path to an X-first beta. `[S3]`
  The dependency graph now reads: the LinkedIn application pack (a week of paperwork that starts a
  4-8-week clock, so it goes first); `api` backend with usage capture and cost ledger; eval harness and
  golden set with the ONNX spike; Signal capture (Approve writes the Revision; `instruction` stored);
  platform model, Forms and Promote-with-Platform; Connected accounts (X), Publish and outcomes, with
  the removal sweep; Input and Research delivery; image lane on the registry; tenancy, auth, storage
  and deploy; tenant 1 migration; web adaptation last, against a stable api. Retrieval v2 is an eval
  experiment inside the Signal slice, not a slice: at 40 pairs the harness cannot detect the effects
  R1 and R2 expect. S4 settles the order.
