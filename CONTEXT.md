# forge — LinkedIn content system

A local, single-user web app that runs one person's LinkedIn content operation end to end: idea intake → scheduling → AI-drafted post text and branded image → manual edit and approval → manual publish on LinkedIn → analytics ingest from exported spreadsheets → data-driven refinement of the writing rules. The app drafts and judges; the operator keeps final say on every word published and every rule change.

The app calls itself **forge**; the Postgres database, role and container are named `forge` and `forge-db`.

---

## Language

### The content spine

**Idea**:
A raw captured thought before it is committed to becoming a post. Carries a `source` (`work | news | evergreen | braindump`) and a `status` (`new | triaged | promoted | discarded`).
A promoted Idea's text stays live: drafting reads it at draft time, so sharpening it changes what the next draft is built from. Its status is settled at promotion and does not move again, unless the post is deleted, which returns the idea to `triaged` or `new`.
_Avoid_: topic, draft

**Triage**:
The engine run that classifies an Idea and suggests a Tier for it, flipping the idea to `triaged`.

**Promote**:
Turning a triaged Idea into a Post at a chosen Tier. The idea keeps a back-reference to its Post and goes to `promoted`.

**Post**:
The unit of publication. Moves through `queued → drafting → draft_ready → approved → published → measured`, and carries `tier`, `hook`, `body_linkedin`, `body_x` (nullable, kept for a possible second platform), `hashtags`, `linkedin_url`. A Post is deleted whole, except its Runs and its measurements, which keep their rows and lose the pointer; a measured Post is not deletable through the app.
_Avoid_: article, content piece, entry

**Tier**:
The weight class of a Post. **T1** flagship (story plus a branded image), **T2** insight (strong text-only), **T3** spark (short take or question). Tier selects the drafting model.

**Hook**:
The opening line of a Post, derived from the first line of the body when the body is written and editable by hand. (An earlier entry said drafting proposes several and one is picked; the code never did that, and no v2 decision builds it.)

**Refine**:
A Run that rewrites a Post's whole body from operator feedback. It is stored with run kind `draft`, so the run log labels it a draft.
_Avoid_: redraft, edit

**Selection refine**:
A Run that rewrites only a selected span of the body, run kind `refine_selection`. It proposes; the operator accepts or discards, and the Post does not change status.

**Degraded draft**:
A draft built from the Constitution alone because retrieval was unavailable, so it carries no Exemplars. The Workspace says so.

**Source**:
A citation a drafting Run returns (`kind` of `file` or `web`, a `ref`, a `note`) and writes onto the Post. From then on it is Post content like the hook and body: edited by hand, snapshotted into every Revision. The Run's own returned list stays on the Run as the record of what the model cited, and the two are allowed to differ. A draft that returns an empty list clears the Post's. A list backfilled from old runs has no Revision behind it.
_Avoid_: reference, link, research source, research input

**Revision**:
A full snapshot of a Post's body and Sources, written on every draft, refine, or manual save. Its `source` (singular: where the Revision came from) is either `run:<id>` or `manual_edit`; its `sources` (plural) are the Source list at that moment. Restoring a Revision restores both. Revisions are the only rollback path: the database owns content, so there is no git history behind it (ADR 0001).

**Measured**:
The terminal Post status, reached when an imported LinkedIn export links to that Post. A Post is only marked measured from `published`.

**Playbook rule**:
One learned or seeded constraint on how posts get written. Categorised `voice | structure | visual | timing | cadence | platform`, with `provenance` of `seed`, `retro:<run_id>` or `manual`, and a status of `active` or `retired`.
_Avoid_: guideline, heuristic

**Retro**:
The engine run that reads measured Posts and proposes Playbook rule additions, edits and retirements. Its output is a set of **proposals**, each individually approved or rejected before anything changes.

**Constitution**:
The always-in-prompt layer: the persona doc, the active Playbook rules the run kind takes, and every enabled Style doc that applies to the run kind. Kept small on purpose, so a missed rule can never be a retrieval accident. Where a Style doc and the persona disagree, the persona's named exceptions win. A draft takes every active rule, a Selection refine takes voice rules only, and retro and image review take none; the goal and design-language docs are added by the builders that use them.
_Avoid_: system prompt, context block

**Style doc**:
A named, operator-editable block of writing constraints applied to model-generated text, toggleable per Run kind. The first one is the `unslop` doc, a tailored copy of the operator's unslop skill. Style docs are the "always" layer; Playbook rules are the "learned" layer, so a style pattern is never a rule.
_Avoid_: style guide, preamble, unslop rules (the doc is one instance, the term is the mechanism)

**Tell**:
One mechanically detectable writing pattern a Style doc bans (an em dash, a word from the AI-vocabulary list, the negate-then-assert contrast frame). The lint finds Tells in any human-readable text, generated or typed, and marks their exact characters; a Tell is a warning, never a failure, and never blocks save or approve.
_Avoid_: lint error, violation, slop (the phenomenon, not the unit)

**Exemplar**:
A retrieved neighbour: a prior Post or Idea pulled by pgvector similarity to the idea text, with its performance stats attached. The optional counterpart to the Constitution.

### Tenancy (v2 terms, settled in the 2026-09-24 brief, not yet in code)

**Tenant**:
One paying account. Owns its Voices, its Posts, its measurements and its connected platform accounts; nothing a Tenant owns is visible to another. The operator who built forge is tenant 1, and their existing records migrate in rather than reset.
_Avoid_: user (a person who signs in; a Tenant may later have several), workspace, organisation

**Voice**:
One person or brand whose posts forge writes: the persona doc, the Style docs and Playbook rules that apply to it, the corpus its Exemplars are drawn from, and the platform accounts it publishes through. A Tenant has one Voice in v1; the entity exists so that a ghostwriter's several clients are several Voices under one Tenant, not several Tenants.
_Avoid_: persona (the persona doc is one part of a Voice), profile, brand (a Voice may be a person)

**Connected account**:
One platform account attached to a Voice with the permissions forge needs there: to publish, to read the account's own metrics and, where the platform allows it (X does, LinkedIn does not), to import its history. One per platform per Voice, connected and revoked on its own; its tokens are refreshed one flight at a time. Connecting an account is not signing in; a person signs in to the Tenant by email or Google, then connects.
_Avoid_: integration, social account, login

**Platform**:
Where a Post is published: `linkedin` or `x` in v1, with `reddit` known to the model and out of scope. In v2 a Post belongs to exactly one Platform; the second body field a Post carries today goes away with it.

**Sibling posts**:
Two or more Posts promoted from the same Idea for different Platforms. Siblings know each other; each has its own body, Hook, schedule, status, Candidates and measurements.
_Avoid_: variant, cross-post, version

**Adapt**:
The Run that derives a new Post on one Platform from an existing Post on another, producing a Sibling. It may carry the source Post's selected Candidate across as a Reference image for the target Platform's shape.
_Avoid_: repurpose, cross-post, translate

**Signal**:
One observation of how a Voice's owner behaves toward what forge produced. Four kinds: `edit` (the difference between the last Run's Revision and the approved Revision), `instruction` (the text typed into a Refine or Selection refine), `verdict` (an explicit approve or reject with an optional note on a Run's output), `outcome` (a platform metric landing on a published Post). Signals may steer Exemplar selection silently and feed Retro proposals; they never rewrite the Constitution on their own. An imported historical post is corpus, not a Signal.
_Avoid_: feedback (the verdict is one kind), event, telemetry, hook pick (retired before it was built)

**Form**:
The shape a Post takes on its Platform, and the thing that picks its Output contract: on `linkedin`, `text`, `text_image` or `document`; on `x`, `post`, `post_image` or `thread`. Tier stays the platform-independent weight class and suggests a Form; the user may override it. `document` is in the model and out of v1.
_Avoid_: format, type, template

**Armed**:
An `approved` Post with a scheduled date and time (read in the Voice's time zone) on a Platform whose Connected account is live. Derived, never stored: forge publishes it at that time. A date without a time, or a missing or revoked Connected account, leaves the Post a reminder, and the Workspace says which. Any change to an approved Post's content returns it to `draft_ready` and disarms it; a time already past at approval asks "publish now or reschedule".
_Avoid_: scheduled (every dated Post is scheduled; only some are armed), queued for publish

**Publish**:
The act of posting an Armed Post through its Connected account and recording the platform's id and URL on it. Not a Run: no model is called. Each attempt is one numbered row, `intent → in_flight → published | failed | needs_review`, with at most one live attempt per Post; a thread is one attempt with a row per segment. forge posts at most once on its own: a failure before the request was sent is retried as a new attempt, and any error after it was sent is treated as a crash, reconciled on X and sent to `needs_review` on LinkedIn, never retried blind. A failure emails the Tenant and shows a Failure strip, which in v2 reads from the Post's last Run or its last attempt, whichever is newer. Publishing by hand stays possible on any Post.
_Avoid_: publish run, post job

**Measured (v2)**:
A published Post on which at least one platform metric has landed. No longer terminal in meaning: metrics keep arriving on a fixed schedule (days 1, 3, 7 and 28 after publishing, then a weekly account-level aggregate). A measured Post can be deleted in forge, which never unpublishes it on the Platform; its metrics stay as unlinked facts, as Runs already do.

**Voice profile**:
The Run that drafts a new Voice's persona doc and an initial set of Playbook rules as proposals, from the imported history or, when there is none, from a short form. The user edits and approves before the Voice drafts anything; that approval is the Voice's first `verdict` Signal.
_Avoid_: onboarding run, persona generation

A Voice writes in one language. Tells and Style docs are per language; v1 ships English and Portuguese. A person who posts in two languages has two Voices.

**Discard**:
Setting a draft aside with an optional one-line reason before a new draft replaces it. Records a negative `verdict` Signal; approving records a positive one. Neither changes the Post's status by itself.
_Avoid_: reject (the act on a Retro proposal), delete (the act on a Post)

**Budget**:
A Tenant's monthly ceiling on metered spend, held in dollars by the cost ledger and shown to the user as an estimate of posts left. A call that would cross it is refused before it runs, and the Failure strip says so. Images and platform API calls count against it separately from text so the estimate can say which is running out.
_Avoid_: quota (the platforms' word for their own caps), credits, allowance

**Draft score**:
The four measured parts shown on every draft: voice (a position between two floors computed from the Voice's own corpus), grounding (the share of factual claims with a verified quote in a Source), fit (the Form's length and structure rules, checked after the fact), tells. The cheap parts run on every draft; the voice judgement runs at approve, so a draft's score reads "provisional" until then. Never a gate.
_Avoid_: precision score (the product statement's word, not the code's), quality score, grade

**Run (v2)**:
Still one audited execution of an engine, persisted whole: the rendered prompt the model saw, the output, usage with cache tokens and cost on every exit path, plus a context row beside it (Exemplar Revision ids and their stats, a hash of the Constitution snapshot, the Inputs' text, the fetched Research text, the Idea text and any instruction). Platform data a term requires deleted is redacted from the context row and from a delimited stats block in the prompt (ADR 0026). A Run records which api machine holds it, because model runs execute in the api process (ADR 0027).

**Corpus item**:
One post imported at onboarding from a Connected account's history or the member's own export: the text the Voice was already writing before forge. Exemplar material and the source of the voice floor, never a Post: it counts toward no goal, sits on no Planner, and is checked against the platform's deletions.
_Avoid_: historical post, imported post (as if it were a Post), sample

**Rule proposal**:
A Playbook rule change waiting for a decision: from a Retro run, from a style edit the system inferred a preference from, or from an instruction the user typed. Accepted or rejected one by one; a rejection is recorded like an acceptance. The only way a rule ever changes.
_Avoid_: suggestion, auto-rule, learned rule (a rule is learned only once it is accepted)

**Input (v2)**:
`file` or `url` only. Parsed to text at attach; a draft carries every Input's text inline, up to a cap per run, and an Input that would break the cap is refused at attach with the reason. Passage retrieval over long documents is the recorded successor, not a v1 feature.

### Images

**Lane**:
Which generator produced an image: `html` (model-authored HTML rendered by Playwright), `raster` (gpt-image-2 through the codex CLI), or `hybrid` (a raster background composited under an HTML text layer). The web launches only `hybrid`; the other two are reachable through the api (ADR 0004).
_Avoid_: pipeline, generator, mode

**Candidate**:
One generated image asset competing for selection on a Post. Many exist per Post; at most one is selected.
_Avoid_: variant, option

**Candidate group**:
One generation batch of Candidates, sharing a group id and an on-disk directory.

**Brief**:
The prose art direction for a Post's image. Every lane is gated on a non-empty brief (ADR 0010).
_Avoid_: image prompt, concept

**Hybrid plan**:
The structured output of the hybrid lane's first step: the background prompt, the headline and subtext, the text zone, the palette, and what was learned from a Reference image.

**Direction**:
One of N short, mutually distinct visual angles the **variator** derives from a single Brief so that a batch produces genuinely different Candidates instead of near-copies. Directions vary composition, metaphor, mood and palette emphasis, never the copy (ADR 0011).

**Reference image**:
An existing Candidate pinned to a Post to steer later generations. The plan step reads it as direction and records what it extracted in the Hybrid plan; the layout is never copied.

**Background refine**:
A Run (kind `image_refine`) that repaints a Candidate's background from an instruction, inside a Canvas editor session.

**Origin**:
How a Candidate came to exist: `generated`, `bg_refined` (a canvas save that included a Background refine), or `canvas_edited` (a layout-only canvas save).

**Canvas editor**:
The in-app direct-manipulation editor for a Candidate: absolute-positioned elements, drag, resize, text edit, add and delete, layer order, undo/redo, and Background refine folded into the same session. One save produces one new Candidate (ADR 0012).

### Engine execution

**Run**:
One execution of an engine, persisted whole: engine name (`claude | codex` on cli, `anthropic | openai` on api), kind, model, the full prompt, the full output, status (`running | succeeded | failed | timeout`), usage and cost. Every model call in the system is an audited Run.
_Avoid_: job, task, call

**Engine backend**:
`api` or `cli`, chosen by the process entry file. `main.ts` is `api`, the provider SDKs; `main.dev.ts` is `cli`, the claude and codex CLIs on the operator's subscriptions. `fake` is a test engine, not a backend.
_Avoid_: mode, provider (a provider is one engine on the api backend)

**Model registry**:
One row per task and backend: the engine, the model, the effort, the output cap and the prices. Replaces `settings.models`, `settings.pricing` and `engineForKind`. A row is data; changing a model is an edit on `/settings`, never a code change.
_Avoid_: model config, model settings

**Ledger**:
One row per model call and attempt: backend, engine, model, category, the call's exit, usage with cache tokens, cost. Written on every exit path; it survives the Run it describes. Slice 3 adds the Budget's reserved and settled columns.
_Avoid_: cost log, usage table

**Run kind**:
What a Run was for. The list is the `run_kind` enum; the names that need a definition have their own entry here.

**Managed run**:
A single Run row that drives several engine sub-calls in sequence (plan → background → text, for the hybrid lane). The sub-calls are recorded as **run steps** and stream into that one Run's console; there are no per-step Run rows.

**Output contract**:
The payload shape a structured Run kind must return, enforced by the engine rather than parsed after the fact. Inside it the model either delivers the payload or declines (ADR 0016).
_Avoid_: schema, JSON format

**Failure kind**:
The classified reason a Run died: `timeout | quota | spawn_error | nonzero_exit | invalid_output | declined | other`. Nothing is left in limbo; an interrupted Run records its failure and cleans up its files. Because the Output contract is enforced, `invalid_output` means a broken contract, a bug to fix, never the model talking back.

**Declined run**:
A Run whose engine answered inside the Output contract that it would not or could not produce the payload: no real substance to draw from, an instruction it should not follow, a fact it would have to invent. Stored as `status: failed`, failure kind `declined`, with the reason and any question for the operator on the Run. Writes no Revision. Any structured Run kind may decline, the same way.
_Avoid_: refusal error, parse failure, invalid output

**Failure strip**:
The one row on a surface that says what its last Run did: the failure label, a decline's reason and question, a link to the Run, and a relaunch control. It goes away when a newer Run of the same kind succeeds.

**Input**:
A document the operator attaches to a Post: a dropped or pasted file (`file`, stored as a copy) or a pasted link (`url`, fetched once at attach and stored as text). Every Input is previewed before attach. From slice 2 until slice 9 no Run reads an Input, so the api refuses a draft, refine or selection refine on a Post that has one. An Input is what the model was given; a Source is what the model cited. On a measured Post the list is read-only, like everything else on it.
_Avoid_: research input, upload, attachment, context file, document

### Analytics

**Source file**:
One uploaded LinkedIn export spreadsheet, identified by the hash of its bytes and classified `aggregate` or `single_post`. Every fact points back to the file it came from.

**dim_post**:
A LinkedIn post as the exports know it, which may or may not correspond to an app Post. Keyed on **post URN**, and separately holding whichever other URN types have been learned.
_Avoid_: external post, remote post

**Post URN**:
The canonical typed identifier `urn:li:<type>:<N>` extracted from an export URL. The same LinkedIn post carries **different numeric ids under different URN types**, which is why the URL is the strong key and the URN is the fallback (ADR 0008).

**Grain**:
The time shape a metric is true at: daily, lifetime-to-date, window-scoped, or snapshot. The same LinkedIn label ("Impressões") is a different grain on different sheets, and separate fact tables exist so those never get coerced into one another (ADR 0007).
_Avoid_: granularity, resolution

**Link**:
Associating a `dim_post` with an app Post. Ingestion never fails for want of a match: an unlinked import still lands, and the link can be healed later by re-uploading the file once the Post has its URL.
_Avoid_: attach (the UI affordance is called "attach"; the operation is a link)

### Planning

**Scheduled date / scheduled time**:
A Post's planned day, plus an optional time of day. Null time means "sometime that day". The schedule is a plan and a reminder; publishing to LinkedIn stays manual (ADR 0006).

**Weekly goal**:
An optional "aim for N posts this week" target in settings. Only **published** posts count toward it, so a post keeps counting after it becomes measured.

**Streak**:
Consecutive weeks that met the weekly goal, derived from the Posts that exist; a deleted Post recounts its week.

**Unscheduled queue**:
The rail of Posts with no scheduled date, the source side of click-first assignment on the Planner.

### Pages

**Overview**:
The app's home page (route `/`), built to a transcribed reference anatomy: a dark hero band over a light lower band.
_Avoid_: Dashboard, home

**Backlog**:
The page of Ideas (route `/backlog`), where they are captured, triaged and promoted.

**Planner**:
The calendar page (route `/planner`) where Posts get their scheduled dates.

**Workspace**:
One Post's page (route `/posts/:id`): its body, hook, Sources, Inputs, images and the Runs that act on it.
_Avoid_: editor, post detail

### Visual language

**bone / ink / soft / salmon / mint / paper**:
The palette token names, taken from the "Bench — studio hours" reference. `bone` is the page ground, `ink` the foreground, `soft` secondary text, `paper` raised panels; **salmon and mint are the only two accents**. Failure reads salmon.

**Skeleton**:
The layout-shaped placeholder a region shows while it has no data for the current page yet. It replicates the final region's structure and dimensions; the page's static chrome (title, range tabs, section headings) is never skeletonised. A spinner is not a skeleton and never gates a page or section (ADR 0014).
_Avoid_: loading state, placeholder, spinner

**Load-in**:
The once-per-mount grow animation of a graph: bars grow from their baseline, lines draw left to right. Data changes on a mounted graph transition between values and never replay the load-in.
_Avoid_: enter animation, intro, reveal

**Warm / cold navigation**:
Arriving on a page with its queries already in the cache (warm) or without (cold). Only a cold navigation shows a Skeleton; a warm one paints from cache and refetches silently. Prefetching exists to make navigations warm.
_Avoid_: cached / uncached

### Retired language

These terms are everywhere in the archived records and no longer exist in the code. Do not reintroduce them.

- **Cadence, week slot, publish window, off-cadence, tier-mix warning**: the fixed "3 posts/week on Mon/Wed/Fri" model, replaced by free-form scheduling (ADR 0006). `cadence` survives as a Playbook rule category, a different thing.
- **`analytics_snapshots`**: the flat per-post store, migrated into the fact tables and dropped (ADR 0007).
- **Structured brief, `image_brief` run kind, localization, verification badge**: the hybrid v2 subsystem, removed code and schema alike (ADR 0010).
- **Inspiration**: someone else's post kept as a style reference. The `inspirations` table exists but has no writer, route or UI.
- **Fenced run**: a draft or selection refine confined to a Staged root by a tool allowlist, CLI deny settings and a tool-call audit (ADR 0015). Replaced by ADR 0023's managed Research run in slice 9; the columns are read-only until slice 12.
- **Research run (v1)**: a Fenced run with the research toggle on, reading a harness snapshot and the web. Replaced by ADR 0023's managed Research run in slice 9; the columns are read-only until slice 12.
- **Staged root**: the per-run directory a Fenced run could read, holding the harness snapshot and one folder per Input. Replaced by ADR 0023's managed Research run in slice 9; the columns are read-only until slice 12.
- **Tool call**: one `Read`, `WebSearch` or `WebFetch` a Fenced run made, audited on the Run. Replaced by ADR 0023's managed Research run in slice 9; the columns are read-only until slice 12.
- **`path` Input**: a place on this machine, re-read at every Run. ADR 0017 amended retired it; the two live rows stay until slice 12 converts them.

---

## Invariants

Each of these has been violated at least once and has a guard, a test, or a scar behind it. Process traps live in `CLAUDE.md`.

1. **`OPENAI_API_KEY` never reaches a codex child** on the `cli` backend. Raster and hybrid generation working without a metered charge is the correct behaviour there; embeddings are the only metered consumer (ADR 0003). In production every model call reserves its cost against the Tenant's Budget first and settles on every exit path (ADR 0019).
2. **Image bytes never enter a prompt.** The hybrid text step writes a placeholder token; the real pixels replace it at render time (ADR 0005).
3. **At most one selected Candidate per Post.** Selecting another moves the selection; deleting the selected one leaves no orphaned selection.
4. **Grain is never coerced.** Daily facts never receive window totals, lifetime facts never receive windowed numbers, window facts always carry their bounds (ADR 0007).
5. **A Run's row, not its stream, decides completion.** Navigating away mid-stream and back converges without a reload and creates no duplicate run.
6. **Every model call is an audited Run** with its full prompt and output, usage with cache tokens and cost, on every exit path.
7. **Re-importing the same export is a no-op.** The file hash (per Tenant, in v2) is the idempotency key; `?force` and `?postId` are the deliberate overrides (ADR 0007). Re-pulling the same outcome through an API is a no-op by `(voice, post, metric, as_of)`.
8. **Ingestion never fails for lack of an app Post.** An unmatched export lands unlinked with a warning (ADR 0008).

---

## Where the record lives

- **`CLAUDE.md`**: the traps, the sacrificial records, and the design choices that are deliberate.
- **`docs/adr/`**: the decisions behind the current shape, each amended in place when a later one changes it.
- **`docs/superpowers/specs/`**: one design per arc, each with a status line saying what became of it. The founding design is `2026-07-11-forge-content-system-design.md`.
- **`docs/plans/`**: plans not yet executed. Executed plans leave the tree; git keeps them.
- **`docs/research/`**: research notes and memos, each with its verdicts and the URLs behind them.
- **`docs/marketing/claims.md`**: what the product may say about itself, each claim traced to a decision.
- **GitHub issue #24**: parked work, not yet designed.
- **`research/`, `post-assets/`**: the extracted design language and post #1's image, both seed inputs.
