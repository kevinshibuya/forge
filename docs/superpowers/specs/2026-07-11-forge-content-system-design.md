# forge — LinkedIn content system (design)

**Date:** 2026-07-11 · **Status:** shipped. Superseded on cadence by ADR 0006 and on the analytics schema by ADR 0007.

## Purpose

A local single-user web app that runs Kevin's LinkedIn content operation end-to-end: idea intake → weekly planning → AI-drafted posts (text + branded image) → manual edit/approval → manual publish on LinkedIn → analytics ingest → data-driven playbook refinement. Claude does the drafting and judgment via headless `claude -p`; Kevin keeps final say on every word published and every rule change.

**Primary goal encoded in the system:** the operator's goal document, with audience growth as a secondary signal. Analytics views must surface the audience's seniority and geography mix so drift from the goal is visible.

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Platforms | LinkedIn now; schema X-ready (`body_x` nullable) |
| Cadence | 3 posts/week, default Mon/Wed/Fri, one morning slot |
| Post tiers | T1 flagship (story + branded image) · T2 insight (strong text-only) · T3 spark (short take/question) — one of each per week |
| Idea intake | All four lanes: own work/projects, AI-news reactions, evergreen lessons, anytime brain-dumps |
| Interface | Local web app (React SPA + NestJS API), invoking project intelligence through `claude -p` |
| RAG | Real embeddings — OpenAI `text-embedding-3-small` (1536d) + pgvector |
| Source of truth | DB-first: Postgres owns all content/state; `claude -p` is pure prompt→JSON; files only for rendered PNGs and uploaded xlsx |
| Post images | Three candidate lanes side by side — HTML→Playwright (branded schematics), gpt-image-2 via codex exec (illustrative raster), hybrid (raster background inside HTML) — consolidated later from usage data |
| Build order | Web app first; architecture-first build — invest in a solid foundation (schema, module boundaries, runner abstraction, testing) before feature velocity; early posting through the app is NOT a goal |

## Stack

TypeScript everywhere. NestJS API · React + Tailwind SPA (Vite) · Postgres 16 + pgvector in Docker · Playwright (app-side image rendering) · OpenAI embeddings API · Claude Code headless (`claude -p --output-format stream-json`, tools disabled) · Codex CLI headless (`codex exec`, gpt-image-2) for raster image generation.

Repo layout: this repo gains `app/` (api + web + docker-compose). Existing `post.md`, `post-assets/`, `research/`, `HANDOFF.md` remain as seed-data sources.

## Data model (Postgres)

- **ideas** — raw_text, source (`work|news|evergreen|braindump`), status (`new|triaged|promoted|discarded`), suggested_tier, news_expiry (nullable), notes, promoted_post_id.
- **posts** — tier (`T1|T2|T3`), status (`queued|drafting|draft_ready|approved|published|measured`), hook, body_linkedin, body_x (nullable), hashtags[], topic_tags[], scheduled_slot (timestamptz), published_at, linkedin_url.
- **post_revisions** — post_id, full body snapshot, source (`run:<id>|manual_edit`), created_at. Drafts are diffable/rollbackable; DB-first means no git safety net for content.
- **assets** — post_id, lane (`html|raster|hybrid`), image HTML source (text, nullable — html/hybrid lanes), generation_prompt (text, nullable — raster/hybrid lanes), rendered PNG path, dimensions, candidate_group_id, is_selected (bool), review_score + review_notes (nullable, from image_review runs), created_at.
- **analytics_snapshots** — post_id, captured_at, impressions, members_reached, reactions, comments, shares, saves, follows_gained, profile_views, demographics (jsonb: job titles, locations, seniority, industries, company sizes), raw_file_path. Multiple snapshots per post (day-2 vs day-7).
- **playbook_rules** — category (`voice|structure|visual|timing|cadence|platform`), rule (text), rationale, provenance (`seed|retro:<run_id>|manual`), status (`active|retired`), created_at, retired_at.
- **inspirations** — author, url, body text, optional image path, why_it_works notes, approx metrics (jsonb). Style exemplars from other creators.
- **runs** — engine (`claude|codex`), kind (`draft|triage|image_html|image_gen|image_review|retro`), model, prompt (full text), output (full text), parsed_ok (bool), status (`running|succeeded|failed|timeout`), error, started_at, finished_at, post_id (nullable).
- **embeddings** — source_type (`post|idea|inspiration|retro_note`), source_id, chunk_text, embedding vector(1536), model (text — e.g. `text-embedding-3-small`; recorded per row so a future model swap is a re-embed migration, not a redesign), updated_at. Unique on (source_type, source_id, chunk index). Query-time embedding must always use the same model as the indexed rows.
- **settings** — singleton row: cadence config (posts/week, weekdays, publish window TZ=America/Sao_Paulo), model assignment per run kind, run timeout, k for retrieval.

## Runners (Claude + Codex)

Two headless engines behind one runner service, both persisted to `runs`:

**Claude** — NestJS service spawns `claude -p` as a child process per run:

- Flags: `--output-format stream-json`, `--model <from settings>`, tools disabled (pure text→JSON; the app never lets a headless run touch the filesystem or shell).
- Streamed progress → SSE to the UI; full prompt + output persisted in `runs`.
- Structured output: each run kind has a JSON schema; response parsed and validated. Malformed JSON → run marked `parsed_ok=false`, raw output shown in UI with a re-run button. Never crashes the workspace.
- Timeout default 10 min (configurable); stderr captured on failure; nothing fails silently.
- Exception to "tools disabled": `image_review` runs get read-only access to the candidate PNG paths so Claude can see the images it scores.

**Codex** — the same runner service spawns `codex exec` for `image_gen` runs (gpt-image-2, native in Codex CLI since 2026-04):

- Prompt instructs generation of candidate PNGs at 1200×1200 into the app's assets directory (gpt-image-2 supports 2K, aspect 3:1–1:3, batch ≤10/call).
- **Auth/billing: ChatGPT subscription login (`codex login`), NOT an API key.** Kevin's constraint: zero spend beyond existing GPT + Claude subscriptions. `codex exec` works headlessly on subscription auth; `OPENAI_API_KEY` must NOT be set on the child process (setting it silently switches billing to the metered API). An optional settings toggle can enable API-key billing later if ever wanted.
- Because image turns consume plan limits 3–5× faster than text turns, the default candidate batch is 3–4 (configurable up to 10). Quota-exhaustion errors from codex are detected and surfaced as a distinct run failure state ("plan limit reached — retry after window resets"), never a generic error.
- Same discipline as Claude runs: timeout, stderr capture, full prompt/output in `runs`, generated file paths validated before asset rows are created. A codex run with no readable output files = failed run.

Model assignment defaults (editable in settings, per the global model-selection table — user-facing copy requires taste ≥ 7):

| Run kind | Model | Rationale |
|---|---|---|
| draft (T1/T2) | opus-4.8 | the copy is the product |
| draft (T3) | sonnet-5 | short-form, sufficient taste |
| image_html | opus-4.8 | visual taste against design language |
| image_gen | gpt-image-2 (via codex exec) | raster generation — the only engine that can |
| image_review | opus-4.8 | visual judgment scoring candidates vs playbook rules |
| triage | sonnet-5 (low effort) | mechanical classification |
| retro | opus-4.8 (high effort) | judgment-dense rule refinement |

Xlsx parsing is plain TypeScript (no LLM). Image rendering is an app-side Playwright service: stored HTML → 1200×1200 PNG (same pipeline that produced post #1's image).

## RAG / context assembly

Two layers, deliberately:

1. **Constitution (always in prompt):** persona/voice doc + ALL active playbook_rules + tier requirements + cadence context. Small corpus; a missed rule must never be a retrieval accident.
2. **Exemplars (retrieved):** pgvector top-k (default 5) by cosine similarity to the idea text, over embedded posts (with their performance stats appended: ER, reactions, comments, audience mix), inspirations, and retro notes.

Draft prompt = constitution + exemplars + idea + tier spec → JSON: `{ hooks: [3 options], body_linkedin, hashtags, image_brief? (T1) }`.

Embeddings are written on create/update of any embeddable entity. Embedding API failure → queued retry; drafting degrades to constitution-only with a visible warning banner.

## Screens

- **Dashboard** — week plan vs cadence rule (3 slots, tier mix), streak tracker, pending actions ("ingest analytics for post #2", "Wednesday slot undrafted").
- **Backlog** — quick-add idea box, triage output (source/tier suggestion), news expiry countdowns.
- **Week planner** — assign ideas to slots; tier-mix constraint (1×T1, 1×T2, 1×T3) warns but never blocks.
- **Post workspace** (core) — hook picker (3 options), body editor (manual edits saved as revisions), "refine with feedback" re-run, image panel (below), approve → copy-to-clipboard → mark published (URL + timestamp). Publishing itself stays manual on LinkedIn by design.

### Image panel (three candidate lanes)

For T1 posts (or any post Kevin adds an image to), candidates can be produced through any mix of three lanes, shown together in one candidate grid:

1. **HTML lane** (proven winner) — Claude generates HTML per the design-language reference → Playwright renders 1200×1200 PNG. Deterministic brand precision: exact tokens, real Plus Jakarta Sans.
2. **Raster lane** — codex exec + gpt-image-2 generates candidates (default batch 3–4, subscription-frugal) from an image brief. For illustrative/conceptual visuals HTML can't produce.
3. **Hybrid lane** — a gpt-image-2 raster is generated first, then embedded as a background layer inside a Claude-built HTML composition (typography/pills/labels rendered on top) → Playwright render.

Flow: pick lane(s) → generate candidates → optional `image_review` run (Claude scores each candidate against active visual playbook rules, score + notes shown on the card) → Kevin picks one (`is_selected`) → attached to the post. Lanes stay separate options for now; consolidation into a single smarter workflow is deferred until real usage data shows which lanes earn their keep (a retro concern, not a launch concern).
- **Analytics** — per-post snapshot detail + cross-post trends: ER by tier / hook style / topic; seniority & geo mix over time (goal drift monitor).
- **Playbook** — active rules grouped by category with provenance; retro proposals rendered as rule diffs with approve/reject per item.
- **Runs log** — all executions: kind, model, duration, prompt/output viewer.

## The refinement loop

1. Upload LinkedIn xlsx (PT-BR export format, as in post #1's file) or paste numbers → parser validates → snapshot stored → post `measured`.
2. Every 3 newly measured posts (≈ weekly) or on demand: **retro run** (opus, high) receives measured posts + the rules they were drafted under + the goal definition → proposes rule additions/edits/retirements, each with data-backed rationale.
3. Kevin approves/rejects per rule in the Playbook screen. Approved changes carry `provenance: retro:<run_id>` — every rule traceable to evidence.
4. Subsequent drafts use the updated constitution automatically. The system compounds; nothing is ever auto-applied.

## Seed data (migration of existing knowledge)

- Post #1 (2026-07-02) inserted as `measured`, with its analytics snapshot (impressions, reach, reactions, comments, followers and demographics from the xlsx) and an HTML/PNG pair as its asset.
- HANDOFF "worked / didn't work" → ~12 seed playbook_rules (structure: hook→story→bullets→aphorism→question; timing: one morning slot, reply first hour, never edit first hour; visual: ink canvas + portfolio palette, no JetBrains Mono, no periwinkle-on-dark secondary text, padding rules; platform: English only, no auto-translate).
- `research/kevinshibuya-design-language.md` → stored as the visual reference document injected into image-HTML runs.
- Persona/voice doc: written once at seed time from post.md + portfolio copy tone (lowercase aesthetic, `·` separators, em-italic accents, numbers as credibility anchors, feelings as spine).

## Error handling

- Runs: timeout, stderr capture, retry button, malformed-output quarantine (raw view + re-run).
- Xlsx: shape validation against the known LinkedIn PT-BR export; errors name the missing/unexpected field.
- Embeddings: retry queue; graceful constitution-only degradation.
- Playwright render failures: surfaced with HTML preserved for manual inspection.

## Testing

- Unit: xlsx parser (fixture = post #1's real export), prompt assembly (constitution + retrieval composition), retrieval ranking, run-output JSON validation.
- E2E (one happy path): create idea → triage → plan → draft (mocked claude -p) → approve → mark published → ingest fixture xlsx → retro proposes → approve rule.

## Implementation phasing (for the plan)

Architecture-first: each phase lands a *complete, tested layer*, bottom-up. Posting through the app early is explicitly not a goal — a foundation that won't need rework is.

1. **Foundation:** repo/app scaffolding (monorepo layout, api + web + shared types package), docker-compose (pg+pgvector), full schema + migrations for ALL tables (not just early features), config/settings module, module boundaries drawn (content, runner, retrieval, analytics, playbook as separate NestJS modules with explicit interfaces), test harness wired (unit + e2e skeleton).
2. **Runner core:** the engine abstraction (claude + codex behind one interface), process spawning, streaming, timeout/error taxonomy, structured-output validation, runs persistence, SSE channel — fully tested with fake engines before any real prompt exists.
3. **Retrieval core:** embedding pipeline (write-path hooks, retry queue, model recorded per row), pgvector search, context assembly (constitution + exemplars) as a pure, unit-testable function.
4. **Content domain:** ideas, posts + revisions, playbook rules with provenance, seed-data migration (post #1, analytics, HANDOFF rules, persona doc).
5. **Workflows + UI:** backlog, week planner, post workspace (draft/refine/approve), analytics ingest (xlsx parser) + screens, retro loop + playbook diff UI.
6. **Images:** Playwright render service, three candidate lanes, image_review scoring, candidate grid.
7. **Polish:** inspirations, trends dashboard, X variant field.

## Out of scope (explicitly)

- Auto-publishing / LinkedIn API integration (manual publish is a feature: final human gate).
- Multi-user, auth, deployment beyond localhost.
- X posting workflow (schema-ready only).
- Comment tracking/reply management.
