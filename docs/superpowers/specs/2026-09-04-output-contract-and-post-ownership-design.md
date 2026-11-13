# Output contract, declined runs, and the post as owner of its inputs

2026-09-04. Kevin-approved design (grill-with-docs, three rounds, 24 decisions). Seven requests
from the research-runs manual pass, grouped into two problems. **Amended 2026-09-06** after plan A
landed (`ec8544b`): a second grilling, three rounds, 31 decisions, rewrote §5 and §8 and corrected
§6 and §7 against plan A's final shape. The amendments are marked in place.

First: the output contract is a hope. Every structured prompt asks for JSON and the runner parses
whatever comes back. Runs 111 and 113 answered in prose, correctly (one refused to fabricate a post
from a placeholder idea, one refused an out-of-bounds read), and both were recorded as
`invalid_output` with `Error: no JSON object found in output` on the card and the model's actual
words buried in the run's raw output. The model not returning the shape it was asked for is a
processing flaw, and a model with something to say has no sanctioned way to say it.

Second: three things that belong to the post are held elsewhere. Sources are read from the latest
succeeded draft run, so a hand-edited body cannot correct them. The idea a draft is built from is
frozen after promotion, so the only way to change what a post is about is to promote a fresh idea.
And a research run can read the harness snapshot and nothing else, so a post about a client brief
or a folder of notes has to be written from memory.

Plus three small surfaces: the research toggle is a stock OS checkbox, the posts list titles a
row by its hook, and there is no thumbnail.

Glossary: `CONTEXT.md` (Idea, Source, Input, Declined run, Failure kind). Decisions that
supersede earlier ones: ADR 0016 (contract, written by plan A), ADR 0017 (inputs, superseding part
of ADR 0015, written by plan C).

## Decisions (locked)

- The engine enforces the output shape. The runner passes each structured kind's schema to the
  CLI (`--json-schema` on claude, `--output-schema` on codex). No repair pass, no auto-retry.
  After this, `invalid_output` means a broken contract, a bug, never the model talking back.
  Rejected: prompt-only with a repair call (hides the flaw, costs a run); retry once (same).
- Every schema-bearing kind is enforced in one change, at the runner, the single seam that already
  holds the schema. Not per kind.
- Any structured run may decline, through one envelope, `{ outcome: 'declined', reason,
  question? }`, accepted in place of the payload for every kind. The runner maps it to
  `status: failed`, failure kind `declined`. A declined run writes no Revision.
  Rejected: a variant inside the draft schema only; a fourth run status; `succeeded` with a
  declined payload.
- One line in every structured prompt names the envelope and when to use it: no real substance to
  draw from, an instruction it should not follow, a fact it would have to invent. Enforcement
  without a sanctioned exit produces confident fiction.
- A failed run's card shows its failure kind, its message (the reason and question in full when
  declined; the head of the raw output otherwise), and opens the run. The surface the run was
  launched from carries a failure strip for the latest failed run until the next run starts.
- The research control is a pill toggle in the app's existing `aria-pressed` language. It is the
  app's boolean control from here on. Rejected: a styled checkbox, a switch.
- Sources are Post content. A draft run writes them onto the Post, a refine-selection run appends
  its new ones deduplicated by ref, and from then on they are edited by hand and snapshotted into
  every Revision. The Run keeps its own returned list; the two may differ. Existing Sources are
  backfilled once from each post's latest succeeded draft run, by script, not migration.
  Rejected: two lists on the workspace; a fallback to the run list while the column is null.
- A promoted Idea's text is live. The freeze on `rawText` is lifted, the freeze on `status`
  stays. Edited inline where the idea shows in the workspace. Old runs keep the prompt they were
  given, which is the history. Rejected: an edit-history table; a separate drafting brief.
- **Amended 2026-09-06.** An Input is a document attached to a Post for its generation Runs to
  read, of three kinds: a dropped or pasted file (stored copy), a pasted link (fetched once at
  attach), or a path on this machine (re-read at every run). The 2026-09-04 version was a typed
  path read by research runs only, and rejected uploads; that was narrower than the intent. Every
  run that generates from the post reads its Inputs: draft, refine, image brief. Rejected: a
  global list in settings (may return as defaults later).
- The operator's choice is the allowlist entry. Behind it, the same belt as the harness snapshot
  (hard deny list, symlinks never followed, `.git`, `node_modules` and dotfiles skipped) plus caps
  per input: 200 files, 5 MB, text-like extensions only. The home directory itself, the harness
  root, `/` and the system roots are refused as choices outright. Walks are recursive.
- Every Input is previewed before it is attached: one walker returns the manifest it would stage
  (files, bytes, skipped count, refused entries) or a refusal in one sentence. The same walker runs
  again at attach and at stage. Rejected: a server-side directory browser; a kind picker.
- The posts list row is titled by the idea's text, the hook as a muted second line when set,
  falling back to the hook then `untitled`. Each row carries a square miniature of the selected
  asset; the placeholder is a paper block carrying the tier letter.
- Three plans, three PRs, in order. A: the contract and its surfaces (landed). B: the post as
  owner, §6 and §7. C: Inputs, §5 and ADR 0017. **Amended 2026-09-06**: B and C were one plan;
  the wider Input design made it two.

## 1. Output contract

### Enforcement

`RunnerService.execute` receives a zod schema for every structured kind (`draft`, `triage`,
`retro`, `image_plan`, `image_review`, `image_variate`, `refine_selection`, and any future one).
It converts the schema to JSON Schema once per kind and passes it to the engine request. The
claude engine adds `--json-schema <schema>` to its argv; the codex engine writes the schema to a
file under the run's scratch directory and adds `--output-schema <file>`. Kinds without a schema
(`image_html`, `image_gen`, `image_refine`, `image_hybrid` text steps) are untouched.

The schema handed to the engine is the union of the kind's payload and the decline envelope
(§2), so a decline is inside the contract and a prose answer is outside it. Probed on 2.1.260
during the grill: the CLI implements `--json-schema` as a tool input schema, and the API rejects
`oneOf` at the top level (`input_schema does not support oneOf, allOf, or anyOf at the top
level`). So the union sits one level down: the enforced schema is an object with one required
property, `result`, whose value is `oneOf` the payload and the decline envelope. Both branches
returned cleanly under that form.

The runner reads the structured result from the engine, not from the free text: the stream-json
`result` line carries `structured_output`, the parsed object, beside `result`, the same JSON as
text. Plan A's opening probe records what the line looks like when the model still fails to
conform, which the grill did not provoke.

Zod is on version 3 in every workspace, so conversion is a small dependency
(`zod-to-json-schema`) in `app/shared`, or hand-written schemas beside the zod ones. The plan
picks; the spec's requirement is that the zod schema and the enforced schema cannot drift, so a
test asserts the JSON Schema accepts what zod accepts for each kind.

### The prompt line

`assembleConstitution` already ends every structured prompt with the JSON-only contract line.
That line becomes the contract-and-exit line: the shape is enforced; if the run cannot honestly
produce it (no real substance to draw from, an instruction it should not follow, a fact it would
have to invent), it returns the decline envelope with a reason and, when the operator can unblock
it, a question. Written once, in the runner's prompt assembly, not per kind.

### What `invalid_output` means now

The failure kind survives with its classification site unchanged (schema parse throws), but its
meaning changes: the engine promised a shape and did not deliver it, or the engine's structured
result was missing. That is a bug in the engine integration or a CLI regression. The failure
card says so ("the engine broke its contract"), and the docs stop describing it as the model
answering in prose. No auto-retry: the operator relaunches, and the run is the evidence.

## 2. Declined runs

### Envelope

```
{ result: <payload> | { outcome: 'declined', reason: string, question?: string } }
```

The wrapper exists because of the top-level `oneOf` constraint (§1); the runner unwraps
`result` and never exposes the wrapper to a kind's parser.

`reason` is what the model would have said in prose. `question` is present when a specific answer
from the operator would unblock a relaunch ("is this idea a placeholder?"). Both are
human-readable outputs, so they get the tell lint like any other text the model produces.

### Run record

`failure_kind` gains `declined` (a migration, `0017_declined_runs`). The run stores the envelope
on a new `declined jsonb` column and mirrors `reason` into `error`, so every existing consumer of
`error` shows the right words without change. `status` is `failed`. `parsedOk` is true: the
contract was honoured.

Side effects match a failure: `endDrafting` reverts the post to `draft_ready` or `queued`, no
Revision is written, no Sources touched, staged directories are deleted, tool calls persisted.

### Failure card

`run-console.tsx` shows for any failed run: the failure kind as a label in the app's pill
language (`declined` in the ink tone, everything else in the salmon warning tone), the message
in full for `declined` (reason, then the question set apart), the first three lines of the raw
output for every other kind, and a control that opens the run's detail on the runs log with that
row expanded. The bare `Error: ` prefix goes.

### Failure strip

The surface a run was launched from shows one quiet strip for the latest failed run on that record,
when that run is newer than the latest succeeded run of the same kind. Workspace: the latest
`draft` or `refine_selection` on the post, above the body. Ideas page: the latest `triage` on the
idea, on its row. The strip shows the kind label and message like the card, and a relaunch
control where the surface has one. It goes away when a new run of that kind starts on the record;
there is no dismiss. A question asked where the operator answers it is a question that gets
answered.

## 3. Research control

`ResearchToggle` becomes a `button` with `aria-pressed`, the same language as the window pills on
Overview and the toggle on PostAnalytics: `rounded-full border border-hairline` on paper when off,
ink fill with paper text when on, the label `research`, lowercase like its neighbours. It lives
where the checkbox lives today. This is the boolean control for the app; the next boolean gets
the same component, extracted to `ui/primitives.tsx` as `Pill` with a `pressed` prop.

`bin/check-design-tells.sh` runs on every Write and Edit; the stock switch signature (a track with
a sliding knob) is exactly what it blocks, and it is not what this is.

## 4. Posts list

The list payload joins, per post, `ideaText` (the promoted idea's `rawText`, null when none) and
`selectedAsset` (`{ id, width, height }` of the asset with `isSelected`, null when none). The row
becomes: a 44px square miniature at the left, the title, the hook beneath it.

Title: `ideaText ?? hook ?? 'untitled'`, truncated at 90 characters as today. Second line: the
hook, muted, only when `ideaText` is set and the hook is set, so the row answers "what was this
about" and "what did it become". A post with no idea can only come from the seed script; the
fallback covers it without a special case in the UI.

Miniature: `/api/images/<id>/file` (the existing route, root-fenced) in a `rounded-sm border
border-hairline` frame, `object-cover`; assets are 1200 by 1200 so nothing is cropped.
Placeholder: the same frame on the paper tone with the tier letter (`T1`, `T2`, `T3`) in the
soft text tone, centred. Same dimensions either way so rows never shift.

## 5. Inputs

**Amended 2026-09-06**, built as plan C. The first version of this section was "Research inputs":
a typed path, read by research runs only. This one replaces it. What is settled here is the model,
the fence, the mechanism and the attach flow; plan C's own grilling settled the rest (staging
layout details, a per-run total, the drop zone's states) and corrected four sentences the tree
contradicted. The corrections are marked in place; the rest is under "Settled by the grilling".

### Model

An Input is a document the operator attaches to a Post for its generation Runs to read. Table
`post_inputs`: `id`, `post_id`, `kind` (`file | url | path`), `ref` (the original file name, the
URL, or the absolute path after `~` expansion), `bytes`, `added_at`; unique on (`post_id`, `ref`),
a duplicate is a 409. Stored copies live under `uploads/inputs/<post>/<input id>/`, beside the
asset store, with the same containment check. Deleting the Input deletes the folder. **Corrected
2026-09-06**: no post-delete route exists, so plan C deletes on Input delete only; whichever slice
adds a post delete must remove `uploads/inputs/<post>/` with it.

- `file`: bytes the operator dropped, pasted or picked. Copied at attach, frozen. Text-like
  extensions, plus PDF converted to text at attach. Anything else is refused at preview as "not a
  text file". Word and spreadsheets wait.
- `url`: a link. Fetched once at attach, reduced to article text by a readability pass, stored,
  frozen, so what the model saw is what is stored. Localhost and private addresses are refused. A
  fetch that fails is refused at preview with the status. Rejected: letting the model fetch at run
  time (needs `WebFetch` on every run kind, and the manifest would not say what was read).
- `path`: a file or folder on this machine, absolute or `~`-prefixed; relative is refused. Nothing
  is stored beyond the path; it is walked at every run so edits show up. A single file is a
  manifest of one. Anything under `~/.claude` is refused, with a sentence pointing at the research
  sources setting: the harness snapshot lane owns that root.

No manifest is stored at attach. The manifest is recomputed per run and recorded on the run under
`stagedInputs`, beside the harness manifest.

### Fence

One walker, three callers: preview, attach, stage. It returns either a manifest (`files`, `bytes`,
`skipped` count, `refused` list) or a refusal in one sentence. **Corrected 2026-09-06**: the walker
lives in the api, not in `app/shared`. No walker exists in shared today (the harness walk is a
`fast-glob` call inside `ResearchStagingService`), all three callers are api code, and shared is
imported by the browser bundle, so node `fs` cannot sit at its entry point. Shared holds the rules
the api and the web must agree on: the text-like allowlist, the deny lists, the cap constants, the
manifest and refusal types, and the refusal sentences. Attach re-walks
because the server never trusts a preview the client says it saw; stage re-walks because the tree
may have changed since attach.

Refused as a choice: relative paths, the home directory itself, anything under `~/.claude`, `/`,
and every root in `RESEARCH_DENY_SETTINGS`' system list. Applied to the chosen tree on every walk:
`RESEARCH_DENY`, symlinks never followed, `.git`, `node_modules` and dotfiles skipped, and the
text-like extension allowlist (new in plan C, in `app/shared/src/research.ts`; none exists today,
the harness walk copies any extension). Skipped files are a count, not
rows. `refused` lists only what the operator would act on: symlinks and `RESEARCH_DENY` matches.
Caps per input, counted over the files that would actually be staged: 200 files and 5 MB. Over the
cap is a path-level refusal that names the numbers, "312 files, the cap is 200", never a
truncation, so the manifest is never a surprise subset. One input inside another is allowed; the
duplication is the operator's choice, and nesting detection refuses nothing dangerous.

At stage, a refusal fails the run before the engine spawns: `failureKind: 'other'`, the run's
`error` naming the input and the reason, so the failure strip shows it. Rejected: a new failure kind
(the strip already renders the detail); staging the inputs that pass (the surprise subset again).
**Corrected 2026-09-06**: no such path exists today. Staging runs after the post is locked and
before the run row is created, so a staging throw is an HTTP 409 and no run records it. Plan C moves
staging into `RunnerService.execute` as a callback the launcher passes in, called between
`runs.start` and the spawn; a refusal there fails the run. The harness snapshot moves into the same
callback, so `stagedManifest`, `stagedDir` and `stagedInputs` are written by one update after
staging rather than at creation. One place mints, stages, spawns and settles a run.

ADR 0017 records that the roots allowlist of ADR 0015 governs the harness snapshot only, and that
an operator's explicit choice is a second allowlist with its own belt. ADR 0015's "a setting can
narrow but never widen" stays true of the harness roots.

### Staging and the prompt

Any run with Inputs is a fenced run. `ResearchStagingService.stage` copies each Input to
`<key>/inputs/<n>/` beside `<key>/harness/`, with the same per-file checks; the run gets the fenced
`Read` tool under the same `--settings` deny; the audit's `outsideRoot` treats `inputs/` as inside.
The harness snapshot is copied only when the research control is on. One mechanism, one manifest,
one audit. Rejected: pasting small Inputs into the prompt and staging large ones (two mechanisms,
and the second audit never gets written).

The model cannot list a directory, so the prompt lists each Input by its original `ref`, its
staged root and its files, and tells the model to cite files by their original path. A `file`
Source whose `ref` is a temp directory is useless once the run settles and the directory is gone.

Runs that read Inputs: `draft` (with or without feedback) and `refine_selection`. Not triage,
which runs on an Idea. Not retro. Not the image lanes, which are driven by the Brief; a dropped
image as a background anchor is the Reference image lane's concern, later. **Corrected
2026-09-06**: the first version listed "the image brief" here. No run writes the Brief; it is typed
by hand in the image panel and saved through `patchMeta`. The only run that reads it is the
`image_plan` step inside the managed `image_hybrid` run, on a launch path with no fence fields.
Fencing a step inside a managed run is a second mechanism, which this section rejects elsewhere, so
the clause is dropped. If a brief-writing run is ever wanted it gets its own slice.

### Attach flow

Workspace, beside the research control: the post's Inputs (kind, ref, remove control), one drop
zone and one text field. A dropped or picked file is `file`. Text submitted in the field: starting
`http://` or `https://` is `url`; starting `/` or `~` is `path`; anything else is a `file` named
after its first line. `POST /posts/:id/inputs/preview` returns the inferred kind with its manifest,
or a refusal; accepting calls `POST /posts/:id/inputs`; removing is `DELETE`. Rejected: a kind
picker.

### Settled by the grilling, 2026-09-06

Twenty-three decisions, every one the recommended answer. The alternatives are recorded where one
was live.

**Fenced runs and tools.** A run is fenced when the toggle is on, when the post has Inputs, or
both. "Fenced" is derived from `research || stagedInputs.length > 0`, never a column; `research`
keeps its meaning, toggle on. With Inputs alone the tool allowlist is `Read`; the toggle adds
`WebSearch` and `WebFetch` and the harness snapshot. The glossary carries **Fenced run** for this.

**Staged layout.** `<key>/inputs/<n>/` where `n` is `post_inputs.id`, so folder and manifest agree
without an ordinal. A `path` input keeps its structure relative to the chosen root; a single-file
path is `<n>/<basename>`. A `file` input is `<n>/<original name>`, a converted PDF is
`<n>/<original name>.txt`, a `url` input is `<n>/page.txt`. The stored copy under
`uploads/inputs/<post>/<id>/` is that same single file, so stage is a plain copy for `file` and
`url`. `post_inputs.bytes` is the stored text's size for those two and the walk total at attach for
`path`, stale by design.

**Manifest.** `stagedInputs: Array<{ inputId, kind, ref, root: 'inputs/<id>', files: {path,
bytes}[], bytes, skipped, refused: string[] }>` on the run. Preview and attach return the same
shape minus `root`. One type, three producers.

**Citation.** `SourceSchema` is unchanged. A `path` file is cited `kind: 'file', ref: <original
absolute path>`; a `file` input `kind: 'file', ref: <original name>`; a `url` input `kind: 'web',
ref: <the url>`, indistinguishable from a page the model fetched itself. The prompt lists each
input as its ref, its staged root and its files, says "read the staged copy, cite the original",
and says the original path is not readable, since `Read(~/**)` is denied and the audit would stamp
the attempt.

**Per-run total.** 500 files and 20 MB across all inputs, checked at stage in the same place the
per-input cap fails the run, refused as "3 inputs, 612 files, the cap is 500". The workspace shows
the running total from `post_inputs.bytes`. Noted for context: `RESEARCH_MAX_TOOL_CALLS` is 15, so
a run reads at most fifteen files whatever the manifest lists; the caps bound copy cost and prompt
length, not what the model can use. Rejected: no total (nothing bounds a post with forty inputs);
a total near fifteen files (the listing is what lets the model choose).

**Path refusals, exact.** Relative paths, `~` alone, `/`, `~/.claude` and its subtree, the exact
roots `/Users`, `/home`, `/root`, `/Volumes`, and `/etc` and `/private/etc` with their subtrees.
Anything deeper is allowed: `/Volumes/T7/notes`, `~/keki/dev/x`. Under a `path`, a PDF is skipped
like any non-text file; to use a PDF, drop it.

**Text-like allowlist.** Extensions `md mdx txt markdown json yaml yml toml csv tsv xml html css ts
tsx js jsx mjs cjs py rb go rs java kt swift c h cpp lua sh zsh bash sql ini cfg conf`, plus the
extensionless basenames `Makefile Dockerfile README LICENSE`. `.env*` stays denied. A dropped
`file` takes the same list plus `.pdf`. A constant in shared.

**`url` mechanics.** Plain `fetch`, 15 s timeout, 5 MB body cap, redirects followed by hand with
the address check repeated per hop. The host is resolved and refused for loopback, link-local,
RFC 1918 and unique-local ranges; today's denies are CLI permission strings, not a server-side
check, so this is new. Then `@mozilla/readability` over `linkedom`; `application/pdf` goes through
the same converter as a dropped file. A page with no article text is refused as "no article text
found". Rejected: driving the existing Playwright to render JS pages (a browser per fetch for a
case that can wait).

**PDF converter.** `unpdf` if it imports cleanly in the api, else `pdf-parse`; the plan verifies
which. A PDF with no text layer is refused as "no text in this PDF".

**Preview then attach, twice.** For `file` the bytes are uploaded at preview and again at attach;
for `url` both preview and attach fetch. The server never trusts a preview, which is the rule
already stated for `path`. Multer gets `limits.fileSize` of 5 MB and the resulting 413 is rendered
as the over-the-cap refusal. Neither Multer nor the body parser has any limit today.

**Pasted text ref.** The first line of the text, trimmed to 60 characters; when that is empty,
"pasted text", then "pasted text 2" and so on. Rejected: a timestamp. A whole text must be a single
line to count as `url` or `path`; a multi-line paste is always `file`, even when its first line is
a link. The field is a textarea and submits on the accept control, not on Enter.

**Panel placement.** A Panel "inputs" in the write tab between `IdeaEditor` and the body panel.
The research toggle stays in the sticky action band, which cannot hold a panel, and gains nothing.
One file per drop in plan C; more is refused with "one file at a time". The web reads the list from
`GET /posts/:id/inputs`; attach and delete invalidate it. Rejected: embedding the list on the post
DTO.

**Drop zone states.** idle (dashed target plus the text field); dragover; previewing (spinner,
"walking" or "fetching"); preview (a card replacing the zone: kind, ref, file count, bytes,
skipped count, refused list, accept and cancel); refused (the sentence, dismiss); attaching;
network error via `ErrorNote`. On a measured post the panel is read-only, list only. One test per
state. Attach and remove stay allowed while the post is `drafting`: a run in flight already holds
its copies.

**Run detail.** An `inputs · n` pill beside the `research` pill when `stagedInputs` is non-empty.
A `staged inputs · n` details section listing each input by kind and ref, then its files and
bytes, its skipped count and its refused list. The `staged files` section stays for the harness
manifest, so the page tells the two apart.

**Measured gate, closed whole.** Server: `patchMeta` throws the same 409 as `updateBody`; the ideas
patch route refuses every field when the idea's promoted post is measured; Inputs attach and remove
refuse on measured. Web: one `readOnly = post.status === 'measured'` computed in `Workspace` and
passed to `IdeaEditor`, `HashtagEditor`, `SourcesEditor`, the Inputs panel, and the body textarea
with its save button.

**Shared housekeeping.** `SourceSchema.ref` becomes `z.string().trim().min(1).max(2048)` and
`note` gets `max(2000)`; `sameSources` is exported from `outputs.ts` and both copies import it;
`sourcesFromRun` maps only a not-found to 404 and lets other errors surface as 500; the backfill
prints its lines in `finally`, before the summary or the failure.

**ADR 0017** records the two-allowlist decision: ADR 0015's roots allowlist governs the harness
snapshot only, and an operator's explicit `path` is a second allowlist of one, behind the same belt
and the same three fences. The `Read`-only tool set for an Inputs-only run is a consequence it
names, not a decision it makes.

## 6. Sources

### Model

`posts.sources jsonb not null default '[]'`, the `Source` shape from `outputs.ts` (`kind`, `ref`,
`note`). `post_revisions.sources jsonb` snapshots them with the body on every Revision, run or
manual. It sits beside the existing `post_revisions.source` column (`run:<id>` or `manual_edit`);
both names are kept and the glossary names the clash (**amended 2026-09-06**; rejected: renaming
the old column, which touches every reader for a cosmetic gain). One migration,
`0018_post_sources`, plus a backfill script under `app/api/scripts` that sets each post's Sources
from its latest succeeded `draft` run's output, run once against the live database and idempotent
(skips a post whose column is already non-empty).

**Amended 2026-09-06**, backfill shape. Older runs store the engine's raw text with a fenced JSON
block; plan A's store a bare JSON string. The script reads both through the shared `extractJson`
and the draft schema, prints one line per post (set, skipped non-empty, skipped unparseable), never
aborts on one bad row, and refuses to run without `--yes`. It connects the way `migrate.ts` does.
Later `refine_selection` runs are not replayed: their Sources never reached the post.

### Writes

- A succeeded `draft` run replaces the post's Sources with its returned list, in the same write
  as the body, so the Revision it creates snapshots both.
- Accepting a `refine_selection` proposal appends the run's returned Sources, deduplicated by
  `ref` compared exactly after trim, keeping the existing note for a ref already present. The
  append happens in the body save that carries the `sourceRunId`, not on run success: a refine run
  writes nothing when it succeeds, and a rejected proposal must leave no trace (**amended
  2026-09-06**).
- A manual edit (body or Sources or both) writes a `manual_edit` Revision with both.
- Restoring a Revision restores its Sources with its body. A snapshot restored halfway is not a
  rollback (**amended 2026-09-06**).
- The save endpoint, `POST /posts/:id/body`, takes `{ body?, sources?, sourceRunId? }`, at least one
  of body or sources. A sources-only save snapshots the current body with the new Sources
  (**amended 2026-09-06**).

### UI

The sources block under the body becomes editable in the hashtag editor's language: each row a
pill with kind, ref and note, a remove control, inline edit of note and ref, and an add control
that takes a ref and a note and infers the kind (`web` when it parses as a URL, `file` otherwise).
Editing a pill's `ref` re-infers its kind. Saves through the existing body save path, extended to
carry Sources. The run detail gains a small sources list parsed from the run output, the way the
workspace parses it today, so what the model cited and what the post says are both on screen
(**amended 2026-09-06**: the run detail renders no such list today, and after this change the
workspace shows the post's list, so the run's would be visible nowhere).

## 7. Idea text

`ideas.patch` allows `rawText` on a promoted idea; `status` stays frozen (a promoted idea is never
un-promoted or discarded through patch). The 409 message becomes "a promoted idea's status is
frozen". The workspace's read-only idea paragraph becomes an inline editor: click to edit, save on
blur when changed or on `cmd+enter`, `escape` reverts, same styling as the body's textarea, no
separate page. The text is trimmed and an empty save is a 400. No side effects: the posts list
title reads the idea live, so it follows on its own. Drafting keeps reading the idea live at
draft time, which is the point.

Runs already attributed to the old text are untouched: every run persists its full prompt
(invariant 6), so what was asked is on the run. No edit-history table.

## 8. Sequencing and gates

**Amended 2026-09-06.** Plan A, "the contract": §1, §2, §3, §4, ADR 0016. Landed on `ai-staging`
as `ec8544b` (PR #19), with three recorded deviations: no ideas-page strip persistence, no codex
`--output-schema` (the codex engine refuses a schema-bearing request), and the control is
`ToggleButton`, not `Pill`.

Plan B, "the post as owner": §7 then §6, in that order, one PR, no ADR. Nothing in §6 or §7 is hard
to reverse or surprising. The ideas-page strip persistence stays out: `runs` has no idea key, and
adding one is a decision about the run model that gets its own slice.

Plan C, "inputs": §5 and ADR 0017, its own grilling session for what this section leaves open,
its own PR, after B has landed. Separate review waves, separate PRs against `ai-staging`.

**Carried into plan C from plan B's review** (decided 2026-09-06, three-leg review of PR #20):

- **A measured post is gated whole, the idea included.** The principle: on a measured post nothing
  is editable. Today only part of that is true. Sources render read-only, and a body save is a 409
  in `updateBody`, but `patchMeta` has no measured check so hashtags stay editable, the body
  textarea is disabled on `busy` only so "save revision" is clickable into a 409, and `IdeaEditor`
  has no status gate because §7 never asked for one. Plan C closes all four against the one rule.
  Rejected: dropping the Sources gate and leaving the 409 as the only enforcement, which would make
  the panel consistent in the other direction.
- **A `Source.ref` is trimmed server-side.** §7's trim rule lives at the api edge for an idea's
  `rawText` (`ideas.controller.ts`), but `SourceSchema.ref` is `min(1)` with no trim and
  `PostsService` does not trim either, so today only the web client does. A ref of spaces is
  storable, is snapshotted into every Revision, and keys `dedupAppend` on the empty string. The fix
  belongs where the schema lives, `app/shared/src/outputs.ts`, which plan B was forbidden to touch
  and plan C opens anyway.
- **`sameSources` is duplicated** between `posts.service.ts` and `web/src/ui/sources-editor.tsx`,
  byte-identical, for the same reason: its natural home is beside `SourceSchema` in shared.

Two consequences of plan B, recorded so plan C does not rediscover them: backfilled Sources carry
no Revision snapshot by design, so the first Sources edit after the backfill overwrites the only
post-side copy and no restore reaches it (the run's own output still holds it); and a research
draft that cites nothing returns `sources: []`, which replaces a hand-curated list, because the
research prompt tells the model to leave the key empty when it used nothing.

Gates for every plan, unchanged: `npm test` in all three workspaces, `npm run typecheck`, `npm
run lint -w web`, route smoke, `probe-research-tools.mjs` four of four, and a headless browser
smoke on each touched surface. Plan A added a probe script for structured output beside
`probe-research-tools.mjs`, and a test per structured kind that the enforced schema and the zod
schema agree. Plan B adds no probe; its live checks are a draft on post #9 writing Sources onto the
post, a manual Sources edit writing a Revision, a sources-only restore, an inline idea edit that
the posts list title follows, and the backfill run once against the live database with its
per-post lines in the PR. Plan C adds a probe that a run cites a file from an attached Input, and
that an Input over the cap is refused at preview.

Traps carried forward from HANDOFF.md apply, in particular: the api loads `@forge/shared` from
`dist/`, so a shared change needs `npm run build -w shared` and an api restart before any live run
counts as evidence.
