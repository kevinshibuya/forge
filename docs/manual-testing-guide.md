# Forge — Manual Testing Guide

> **Stale, 2026-09-24.** Most of this guide describes the app as of July. Only J8 and §4 are current. The web runs on port 5174, not 5173; the fixed cadence, the html and raster buttons, the structured brief and `analytics_snapshots` are gone. A full rewrite is tracked in issue #24. Until then, trust the code over this page.

A hands-on, click-through QA guide for everything shipped in `main` as of 2026-07-12
(content system Plans 1+2, image lanes, and the orchestrated hybrid lane).

The philosophy: **become the operator.** A green test suite (140 tests) proves the
pieces work in isolation — it says nothing about whether *you clicking through the real
app* get a working flow. The bugs live in the seams (persistence, AI engines, SSE
streams, env config), reachable only by driving the whole thing. For each journey you
watch **three layers** and reconcile them:

1. **What you see** — the UI.
2. **What the browser emits** — keep DevTools **Console + Network** open from the first page load. This is the highest-yield, zero-cost bug detector.
3. **What the system recorded** — query Postgres / read the Runs log. A flow that *looks* right on screen but wrote the wrong row (or none) is a bug only this layer reveals.

Tick the boxes as you go.

---

## 1. Launch it yourself

Three processes: **DB** (already running), **API** (`:3001`), **web** (`:5173`). Use three terminals.

### 1.1 Prerequisites (all currently satisfied on this machine)

- [ ] **Docker DB** — `forge-db` is already `Up (healthy)` on `:5433`. Only if it's not:
  ```bash
  cd app
  docker compose up -d db
  ```
- [ ] **`claude` CLI** logged in — drives draft / refine / triage / retro / HTML-text / hybrid-plan / image-review. (v2.1.206 present; run 9 succeeded today, so it's working.)
- [ ] **`codex` CLI** logged into your **ChatGPT subscription** — drives raster generation and hybrid backgrounds. (v0.144.1 present; runs 10/11/13/14 succeeded today, so it's authenticated. The repo is codex-`trusted`, so no `--skip-git-repo-check` is needed.)
- [ ] **Playwright chromium** installed — renders the HTML & hybrid lanes to PNG. (chromium-1228 present.)

### 1.2 Terminal A — API (`:3001`)

```bash
cd app/api
npx nest start                   # compiles from source, listens on 127.0.0.1:3001
# add --watch if you'll edit API source: npx nest start --watch
```

The API **auto-loads `app/api/.env` via dotenv** on boot (`src/env.ts` → `loadEnv()`, called
before Nest builds the providers) — no manual `set -a && . ./.env` step. `.env` supplies
`OPENAI_API_KEY` (embeddings only); `DATABASE_URL` falls back to the running container
(`postgres://forge:forge@localhost:5433/forge`) when absent. If `.env` is missing or its key
is blank, everything still works **except** embeddings/retrieval, which fail closed and show a
"degraded" banner on drafts (see §6).

- [ ] Health check passes:
  ```bash
  curl -s localhost:3001/api/health     # → {"ok":true}
  ```

### 1.3 Terminal B — web (`:5173`)

```bash
cd app/web
npm run dev                       # Vite dev server, proxies /api → 127.0.0.1:3001
```

- [ ] Open **http://localhost:5173** → the `forge.` shell renders with the left nav (dashboard, backlog, planner, posts, analytics, playbook, runs) and **zero console errors**.

> Note on surface fidelity: this is Vite's **dev** server. For a click-through QA it's the
> right surface (the API always compiles the same source either way). The one known
> dev-vs-prod trap in this repo — Vite not prebundling the linked CJS `@forge/shared`
> workspace dep — is already handled by a source alias in `vite.config.ts`, so the SPA
> mounts cleanly. If you ever want the true production bundle: `npm run build && npm run preview -w web`.

### 1.4 A DB-inspection shortcut (paste into any terminal)

```bash
fdb() { docker exec forge-db psql -U forge -d forge -At -c "$1"; }
fdb "select id,tier,status from posts order by id;"
```

Used throughout as the "what the system recorded" layer.

---

## 2. Your starting state (what's in the DB right now)

| Entity | Count | Detail |
|---|---:|---|
| **posts** | 1 | post **#1**, T1, status **`measured`** — the seeded "the idle transaction" example, full lifecycle already complete |
| **ideas** | 0 | backlog is **empty** — you'll create one to exercise the spine |
| **assets** (post #1) | 9 | 2 `html` (1 selected), 5 `raster`, 2 `hybrid` — no review scores yet |
| **playbook_rules** | 13 | seeded voice/structure/etc. rules |
| **analytics_snapshots** | 1 | post #1's LinkedIn export |
| **embeddings** | 1 | post #1's `text-embedding-3-small` vector |
| **runs** | 7 | image-lane runs #8–14; **#8 and #12 are `failed`** — these are *historical/known* (run 12 = the old base64-in-prompt hybrid bug, since redesigned). Not something to debug. |

**Implication:** post #1 is a finished specimen you can inspect (images, analytics), but it's
already `measured`, so to test the **draft → approve → publish** spine you promote a *new*
idea (§4, J1). To reset to this pristine state later, see §7.

---

## 3. The journeys

Seven journeys. Each has a **happy path** (confirms it works) and **probes** (abandon /
error / empty / garbage — where the bugs actually are). Drive both.

> Throughout: keep an eye on the **`/runs`** page and DevTools **Network** tab. Every AI
> action returns a `runId` immediately (HTTP 202-style) and streams progress over SSE
> (`/api/runs/:id/events`); completion is decided by the **run row's status**, not the SSE close.

---

### J1 — Idea → Post spine (the core loop)

This is the spine: **backlog → planner → workspace (draft → hook → edit → refine → approve → publish)**.

**Happy path**
- [ ] **Backlog** (`/backlog`): type an idea, pick a source (braindump/work/news/evergreen), **add idea**. → card appears; textarea clears.
  - Reconcile: `fdb "select id,status,source from ideas order by id desc limit 3;"` → a `new` row.
- [ ] **Triage** the idea → button spins, then the card shows a suggested **tier** badge + status flips to `triaged`. (Real `claude` call, ~10–30s.)
  - Reconcile: a `triage` run appears on `/runs` as `succeeded`; idea row status = `triaged`.
- [ ] **Promote** (pick a tier in the dropdown, **promote**) → you're navigated to `/posts/:id`. The new post is `queued`.
  - Reconcile: `fdb "select id,tier,status from posts order by id desc limit 1;"` → new post, `queued`. Idea status → `promoted`.
- [ ] **Planner** (`/planner`): the new post shows in **unscheduled queue**. Use a slot's **assign a post…** dropdown → **assign**. → the post fills that Mon/Wed/Fri slot.
  - Reconcile: post row now has a `scheduled_slot`.
- [ ] **Workspace** (`/posts/:id`): click **draft with claude**. → the dark "drafting" console streams live engine output; status shows `drafting`; when it finishes the body fills in and status → `draft_ready`. (Real `claude`, ~30–90s.)
  - Reconcile: a `draft` run `succeeded` on `/runs`; `post_revisions` gains a row; post `status=draft_ready`.
- [ ] **Pick a hook**: the draft proposes several hooks — click one (it highlights blue). Approve is blocked until a hook is picked.
- [ ] **Edit the body**: change text → the **save revision** button un-greys → save. → "saved".
  - Reconcile: another `post_revisions` row; `revisions` list at the bottom grows.
- [ ] **Refine with feedback** (only shows when `draft_ready` + a body exists): type feedback (e.g. "tighten the middle"), **refine**. → console streams; body updates. (Real `claude`.)
- [ ] **Approve** → status → `approved`; the **mark published** panel appears.
- [ ] **Mark published**: paste any `https://…` URL → **mark published**. → status → `published`; a **copy to clipboard** button appears.
- [ ] **Copy to clipboard** → button flips to "copied ✓". (Browser may prompt for clipboard permission — grant it; that's not a product bug.)

**Probes**
- [ ] **Add idea** with only whitespace → the **add idea** button stays disabled (can't submit empty).
- [ ] **Discard** an idea → it leaves the `new,triaged` list. Reconcile: idea `status=discarded`.
- [ ] **Approve while the body is dirty** (edit but don't save) → approve is disabled with a "save the body first" tooltip. Same if no hook is picked.
- [ ] **Mark published** with a non-URL (e.g. `foo`) → button disabled (must start with `http`).
- [ ] **Re-draft** an already-drafted post → button reads **re-draft**; confirm it overwrites and adds a revision (old body recoverable via **restore**).
- [ ] **Restore** an older revision from the revisions list → body reverts; a new revision is recorded.
- [ ] **Abandon a live draft**: start a draft, then navigate away mid-stream and come back. The post keeps polling and converges to `draft_ready` without a reload (the run row, not the SSE, is the source of truth). Confirm no duplicate draft run was created.

---

### J2 — Image lanes (per post)

Three generators (**HTML**, **raster**, **hybrid**), plus **score / select / delete**. The
panel lives at the bottom of any post workspace (`/posts/:id`). Test on **post #1** — it
already has candidates, or generate fresh ones.

> Timing (real AI): **HTML** ~30–90s · **raster** ~90–120s/image · **hybrid** ~2–4 min (it's a
> 4-step orchestration). The console streaming + spinner means it's working, not hung.

**Happy path**
- [ ] The **image brief** field is prefilled from the draft's `image_brief` (may be empty on a hand-written post — type one, e.g. *"bold serif headline on a warm gradient, senior-engineer tone"*).
- [ ] **generate html** → console streams; ~1 min later a new `html` candidate tile appears. It's a Playwright render of AI-authored HTML in Plus Jakarta Sans.
  - Reconcile: `fdb "select id,lane,is_selected from assets where post_id=1 order by id desc limit 3;"`; a `succeeded` **image_html** run on `/runs`. The PNG serves from `/api/images/:id/file`.
- [ ] **generate raster** (set the **batch** number 1–10 first, default 4) → codex's built-in image tool produces N 1200×1200 PNGs. (**Start with batch = 1** for your first run — batch>1 is the slower, less-exercised path.)
  - Reconcile: N new `raster` assets; an **image_gen** run `succeeded`.
- [ ] **generate hybrid** → the 4-step orchestration: claude plans a composition → codex generates a text-aware background (`bg.png`) → claude renders typography with a `__HYBRID_BG__` placeholder → the app composites and renders one `hybrid` candidate with legible text on an on-brand background.
  - Reconcile: one new `hybrid` asset; an **image_hybrid** run `succeeded`. Inspect the group dir — the background persists as a **sibling `bg.png`**, and the stored `htmlSource` holds the **placeholder token, never base64**:
    ```bash
    ls app/api/uploads/assets/1/*/            # expect bg.png + the rendered PNG as siblings
    ```
- [ ] **score these** (appears once ≥1 candidate exists) → an **image_review** run has `claude` score every candidate. Tiles then show a numeric score + hover notes.
  - Reconcile: `assets.review_score` populated; an `image_review` run `succeeded`.
- [ ] **select** a candidate → blue ring + "selected ✓"; selecting another moves the selection (only one selected per post).
  - Reconcile: exactly one `assets.is_selected=true` for the post.
- [ ] **delete** a candidate → tile disappears.
  - Reconcile: row gone from `assets`; its file removed from `uploads/`.

**Probes**
- [ ] Empty brief → all three generate buttons are disabled.
- [ ] **Double-click** a generate button fast → only **one** run fires (the whole panel goes `busy` from the moment the mutation starts, before the runId even lands). Confirm one run on `/runs`, not two.
- [ ] While a run is live, confirm every other lane button + select/delete is disabled.
- [ ] **Delete the *selected* candidate** → confirm the post no longer reports a selected image (no orphaned selection).
- [ ] Set **batch** to something out of range (e.g. type 99 or 0) → it clamps to 1–10.
- [ ] Force a failure signal: if any generation fails (e.g. codex not logged in), the panel surfaces a red `generation failed (<kind>): <reason>` note and the run shows `failed` on `/runs` — confirm the failure is legible and lands **no partial candidate** (atomicity).

---

### J2b — Hybrid image v1 (plan → freeform background → typography-only composite)

> **Restart the API first** — the running process still executes old compiled code, and
> this journey depends on the restored `launchHybrid` plan-first flow: Ctrl-C in the API
> terminal, then `cd app/api && npx nest start`. The web dev server picks up its changes
> via HMR automatically, no restart needed.

**Happy path**
- [ ] **Workspace panel** (`/posts/:id`): the **generate hybrid** button uses the same
  prose brief as **generate html** / **generate raster** — it is gated on `proseBrief`
  (derived from the structured brief if one exists, else the legacy brief), not on the
  structured-brief editor. The structured-brief editor still renders (it's shared with
  `image_brief`/html/raster) but nothing about it is a prerequisite for hybrid.
- [ ] **generate hybrid** → watch `/runs`: there is **ONE** managed `image_hybrid` run
  driving three sub-calls in order — plan (`claude image_plan`, produces
  `{backgroundPrompt, headline, subtext, textZone, palette}`) → background (`codex
  image_gen` paints the **entire** 1200×1200 image from the freeform `backgroundPrompt`,
  textless, text-zone calm) → text (`claude image_html`, typography-only composition
  referencing the `__HYBRID_BG__` placeholder). All three stream into that **single
  run's** live console output; there are **no per-step run rows**.
  - Reconcile: `fdb "select id,kind,status from runs order by id desc limit 5;"` → one
    new `image_hybrid` row, `succeeded`.
- [ ] **Candidate badge**: new hybrid candidates carry **no badge** — there is no
  localize, verify, or repair step in this flow, so nothing is scored or flagged.
  (Older candidates generated under the since-rolled-back v2/v3 flows keep whatever
  `verified`/`flagged · N` badge was stored for them at the time — that's stored
  verification data rendering as before, not new behavior.)

**Probes**
- [ ] Empty brief (`proseBrief` blank) → **generate hybrid** is disabled, same gating as
  html/raster.
- [ ] **Where did my run die?** If a run is interrupted (session limit, killed API,
  engine crash), the managed run records the failure — nothing is left in limbo:
  `fdb "select id,kind,status,failure_kind,error from runs order by id desc limit 3;"`.
  A `failed` `image_hybrid` row means no candidate landed and the run's files were
  cleaned up; `failure_kind`/`error` name the failing step's exit (e.g. `nonzero_exit`
  / "exit 1" = a `claude -p` or `codex` call died, typically a hit session limit). Safe
  to just relaunch from the panel.

---

### J3 — Analytics ingest & trends

**Happy path**
- [ ] **Analytics** (`/analytics`): the page shows post #1's measured numbers (ER-by-tier bars, goal-drift seniority/geo panels, a per-post list). Note "best er", "total impressions", "measured posts" tiles.
- [ ] Click a post row → **Post Analytics** (`/analytics/:postId`) shows impressions/reactions/comments/shares tiles + demographic breakdowns (seniority, locations, job titles, industries, company sizes, companies).
- [ ] **Ingest analytics**: choose the bundled fixture and **upload xlsx**:
  ```
  app/api/test/fixtures/post1-analytics.xlsx
  ```
  → "snapshot #N attached to post #1". (Import matches the post by the **post URL inside the xlsx** — the fixture's URL maps to post #1, so re-uploading adds another snapshot to post #1.)
  - Reconcile: `fdb "select count(*) from analytics_snapshots;"` increments; trends refresh.

**Probes**
- [ ] Click **upload xlsx** with no file chosen → nothing happens (no crash).
- [ ] Upload a non-matching / garbage `.xlsx` (any random spreadsheet) → expect a legible error note, not a white screen. (Import matches by URL; an export whose URL matches no post should fail cleanly.)
- [ ] Visit `/analytics/:postId` for a post with **no** snapshot (e.g. your new J1 post) → the empty state "no snapshots — upload this post's export" shows, not an error.
- [ ] To take a *new* post all the way to `measured`, you need an export whose post URL matches the LinkedIn URL you entered at publish. The bundled fixture only matches post #1, so end-to-end "measured" for a fresh post requires a real matching export — note this rather than expecting the fixture to work on post #2.

---

### J4 — Playbook & retro (propose → decide)

**Happy path**
- [ ] **Playbook** (`/playbook`): 13 seeded rules grouped by category (voice/structure/…). 
- [ ] **Add a rule manually**: pick a category, type a rule + optional rationale → **add rule**. → it appears in its category group with a `manual` provenance pill.
  - Reconcile: `fdb "select count(*) from playbook_rules;"` increments.
- [ ] **Retire** an active rule → it goes struck-through and leaves the active grouping.
- [ ] **Run retro now** → the retro eligibility line shows "N measured since last retro (threshold …)". Click it → a dark console streams while `claude` analyzes measured posts and proposes rule add/edit/retire changes. (Real `claude`, ~30–90s.)
  - Reconcile: a `retro` run `succeeded` on `/runs`; the run then loads as **proposals**.
- [ ] **Decide**: each proposal has **approve / reject** toggles. Set some, then **apply decisions** → "applied X, rejected Y ✓". Approved *add* proposals become new rules; approved *retire* proposals retire their target.
  - Reconcile: `playbook_rules` reflects exactly the approved changes; rejected ones leave no trace.
- [ ] **Past retros**: the `#N` buttons re-open a prior retro's proposals read-only-ish.

**Probes**
- [ ] Add a rule with an empty rule field → **add rule** disabled.
- [ ] Run retro, then **apply decisions with everything left on reject** → "applied 0, rejected N"; no rules change.
- [ ] A retro that proposes nothing shows "this retro proposed no changes" rather than an empty void.
- [ ] Watch the eligibility banner: after a retro, "measured since last retro" should reset relative to the new `lastRetroAt`.

---

### J5 — Runs log (the engine ledger)

**Happy path**
- [ ] **Runs** (`/runs`): every engine execution, newest first, with kind pill + status dot + failure kind. Filter chips: all / draft / triage / image_html / image_gen / image_review / retro.
- [ ] Click a run → its prompt and output are viewable (this is the "prompt to output" ledger; useful to confirm, e.g., a hybrid text-step prompt is ~16K chars, **not** ~1.9M — i.e. no base64 leaked into a prompt).
- [ ] After doing J1–J4, confirm each action you took produced exactly one corresponding run with the right kind and a `succeeded` status.

**Probes / observations**
- [ ] The filter chips **don't** include `image_hybrid` or `image_plan` — those run kinds exist (you'll create them in J2) but only appear under the **all** filter. Expected today (minor UI gap), not a bug — but confirm your hybrid runs are visible under **all**.
- [ ] Runs **#8** and **#12** are pre-existing `failed` rows. Confirm they render cleanly with a failure kind; don't mistake them for something you broke.

---

### J6 — Dashboard & cross-cutting (streak / cadence / warnings)

**Happy path**
- [ ] **Dashboard** (`/`): "streak" (weeks meeting cadence), "this week N/M slots filled", "pending actions" count. The three Mon/Wed/Fri slot cards link to their posts or to the planner if empty.
- [ ] **Pending actions** list → each links to the thing needing attention (e.g. a `draft_ready` post to approve). After you clear one in J1, confirm it drops off.
- [ ] **Planner** week nav: **← prev / today / next →** move weeks; the "week of …" label tracks.
- [ ] **Posts** (`/posts`): filter chips (all / by status) narrow the list; each links to its workspace.

**Probes**
- [ ] **Tier-mix warnings**: the cadence is one T1 + one T2 + one T3/week. Assign two same-tier posts into one week (Planner) → a **warn banner** appears on both Planner and Dashboard ("the mix warns, never blocks") — and confirm it still lets you assign (warn, not block).
- [ ] **Unassign** a slotted post (Planner) → it returns to the unscheduled queue; the slot re-opens its assign dropdown.
- [ ] Navigate to a **non-existent post** (`/posts/9999`) → expect a graceful loading/empty state, not a crash.
- [ ] Empty states: a fresh week with nothing scheduled, an empty backlog, a status filter with no matches — each should show its friendly empty message.

---

### J7 — Settings (API-only, no UI page)

Settings (persona doc, goal doc, **design-language doc**, cadence, model routing) has **no
web page** — it's seeded and exposed only over the API. The design-language doc is what
steers image generation, so it's worth confirming it's populated.

- [ ] Inspect: `curl -s localhost:3001/api/settings | head -c 400` → JSON with non-empty `designLanguageDoc`, `personaDoc`, `goalDoc`, plus cadence + models.
- [ ] (Optional) `PATCH /api/settings` with a tweaked cadence and confirm the Planner/Dashboard slot logic reflects it.

---

### J8 — A declined run

The engine enforces every structured run's output shape, and inside that shape a run may decline:
no real substance to draw from, an instruction it should not follow, a fact it would have to
invent. A decline is a failed run that honoured the contract, and the app treats it as a question
for you, not as a bug.

- [ ] Promote an idea whose text is a placeholder (post #5's is one: "placeholder, safe to delete"), open its workspace, click **draft with claude**.
- [ ] Expect the run console's failure card to read **declined** in the ink tone (not salmon), with the reason first and the question set apart beneath it. No `Error:` prefix.
- [ ] Expect the same reason and question on the **failure strip** above the body editor, with a **relaunch** control. The post is back to `queued`; no new revision on the history tab.
- [ ] Click **open run →** on the card: `/runs?run=<id>` lands with that row expanded, kind filter at **all**.
- [ ] Sharpen the idea's text (the promoted idea stays live), relaunch from the strip, expect a body. The strip goes away once the newer draft succeeds.
- [ ] Triage a placeholder idea on the backlog: the row shows the same strip with the question. It lasts until reload; persisting it needs an idea key on `runs`, so it is its own future slice.

---

## 4. Engine, cost & timing map

Know which flows spend what, so slow ≠ broken and cost is expected.

| Action | Engine | Auth / cost | Rough time |
|---|---|---|---|
| triage, draft, refine, retro, HTML-text, hybrid-plan, image-review | **`claude`** CLI | your Claude subscription | 10–90s |
| raster generation, hybrid background | **`codex`** built-in image tool | **ChatGPT subscription** (metered `OPENAI_API_KEY` is deliberately **stripped** from codex) | ~90–120s per image; hybrid whole run 2–4 min |
| post embedding (for retrieval/exemplars) | OpenAI **`text-embedding-3-small`** | metered `OPENAI_API_KEY` — **the only** metered consumer (~$0.01/yr) | seconds |

**`invalid_output` now means a broken contract.** The engine enforces the output shape (ADR 0016), so an `invalid_output` run is no longer the model talking back: it is no structured result, the CLI giving up on the schema, a wrapper without `result`, or a zod-only refinement the schema cannot carry. File it as a bug; do not retry it hoping for a better answer.

**Billing invariant to spot-check:** `OPENAI_API_KEY` must **never** reach a codex child.
It's stripped in `codex.engine.ts`. Raster/hybrid working *without* a metered charge is the
correct, tested behavior.

---

## 5. Known non-bugs — don't file these

- **"retrieval was unavailable — used the constitution only" banner** on a draft. Expected if `app/api/.env` is missing or its key is blank, or if the retry queue hasn't embedded enough posts. Only post #1 is embedded today; backfilling the rest is a known, non-blocking follow-up. Drafts still work (constitution-only).
- **`image_hybrid` / `image_plan` missing from the Runs filter chips.** They show under **all**. Known minor gap.
- **Runs #8 and #12 already `failed`.** Historical; #12 is the retired base64-in-prompt hybrid bug.
- **Long silences during raster/hybrid.** It's real image generation — watch the streaming console; 2–4 min for hybrid is normal.
- **Clipboard / permission prompts** in the browser — the harness/browser gating, not the app.
- **Batch > 1 raster** is the less-exercised path (only batch = 1 has been live-verified). If something's off there specifically, note it — it's genuinely under-tested.

---

## 6. Reset to a clean slate (optional)

Everything you create (ideas, posts, assets, runs) persists in the `forge-db` volume. To
get back to the pristine "post #1 only" starting state:

```bash
# nuke and re-seed (destroys ALL local data, re-creates post #1 + rules + snapshot):
cd app
docker compose down -v          # drops the pgdata volume
docker compose up -d db         # fresh DB; migrations run on API boot
# then, with the API able to reach the DB:
cd api && npm run db:seed        # auto-loads .env via dotenv (embeds post #1 if the key is set)
```

The seed is **idempotent** — it skips if post #1's URL already exists — so running it against
a non-empty DB won't duplicate. Uploaded asset files live under `app/api/uploads/assets/`
(gitignored); clear that dir if you want a truly clean filesystem too.

---

## 7. One-glance smoke (if you only have 5 minutes)

1. `curl -s localhost:3001/api/health` → `{"ok":true}`, open `:5173`, no console errors.
2. Backlog: add → triage → promote an idea. (proves claude + the write path)
3. Workspace: draft → pick hook → approve → mark published. (proves the spine + SSE)
4. Image panel on post #1: **generate html**, then **score these**. (proves Playwright render + review)
5. `/runs`: confirm a draft, a triage, an image_html, and an image_review all `succeeded`.

If those five are green, the system is standing up end-to-end.
