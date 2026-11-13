# R3. What forge already captures, against the four Signal kinds

Code fact-find for the forge v2 brief (research contract R3), read on 2026-09-24 against `ai-staging`
at `d2863a0` and the live database. Paths are relative to `app/`.

## Verdict

Of the four Signal kinds, only `outcome` has a complete data path today. `edit` is derivable but has
no publish-time anchor. `hook_pick` has no source at all: the code never proposes a set of Hooks, which
contradicts the glossary. `verdict` has scattered positive traces and no negative ones: every rejection
(refine discard, image patch rejection, retro proposal rejection) is dropped. Token usage is missing on
most image runs and there is no cost column.

## Facts

### Hooks: the glossary and the code disagree

- `DraftOutputSchema` (`shared/src/outputs.ts:38-43`) has `body_linkedin`, `hashtags`, `image_concept?`,
  `sources?`. No hooks array.
- `posts.hook` is one text column (`api/src/db/schema.ts:43`), derived as the first non-empty trimmed
  line of the body in the same transaction as the body write (`api/src/posts/posts.service.ts:192-195,
  211`); `patchMeta` can set it by hand (:223, 235).
- No hook picker in `web/src`. No stored pick. `runs.output` holds the body, not alternatives.
- `CONTEXT.md` says "Drafting proposes several; exactly one must be picked before the Post can be
  approved." The code has never done this. Either the glossary entry is aspirational and must say so,
  or the `hook_pick` Signal needs the feature built first. Surfaced to the S3 review and S4 grill.

### Revisions: `edit` is derivable, unanchored

- `post_revisions` (`schema.ts:62-70`): `id`, `post_id` (cascade), `body`, `source`, `sources` (jsonb,
  null predates 0018), `created_at`. `source` is `'run:<id>'` or `'manual_edit'` (:66).
- The only insert is `updateBody` (`posts.service.ts:209`), fired on a body write, a sources-only save
  and a restore. Live: 29 `manual_edit` rows, one row per `run:N`.
- `approve` (:273-277), `publish` (:279-287) and `markMeasured` (:289-293) only call `transition`; no
  Revision, no timestamp beyond `posts.published_at` and `updated_at`. The body is frozen after
  `measured` (:204 throws) but can still change between `published` and `measured`.
- So "the published Revision" is a proxy today: the latest Revision with `created_at <= published_at`.
  The `edit` Signal needs `publish` (and v2's Publish run) to write a Revision with `source:
  'publish'`, or an equivalent anchor.

### Explicit feedback: positives scattered, negatives dropped

- Refine feedback text: `RefineSchema { feedback, research }` (`drafting.controller.ts:9`) goes into the
  prompt only (`drafting.service.ts:80, 360-361`); persisted inside `runs.prompt`, no column. Refine
  runs as kind `draft`.
- Selection refine `instruction`: inside `runs.prompt` (kind `refine_selection`). Accept leaves a
  Revision `run:<id>` plus a Sources append (`posts.controller.ts:16-26`); discard is not stored.
- Image refine instruction: `runs.prompt` (`images/image-refine.service.ts:44, 55`); a rejected patch is
  not stored (:36).
- Retro decisions `{index, approved}` (`playbook/retro.service.ts:140-166`): approved ones become
  `playbook_rules` rows with `provenance 'retro:<runId>'`; rejected ones are counted and returned, never
  stored.
- `image_review` is in the enum (`schema.ts:18`); zero live rows. Post approve is a status change with
  no note.

### Outcomes: complete

- `dim_post.post_id` nullable FK (`schema.ts:141`); live: 1 linked. `fact_post_lifetime` keyed by
  (post_urn, metric, as_of_date) (:157-163); `fact_window_metric` (:166-178); `fact_profile_metric`
  account-level (:149-154).
- Live lifetime metrics: impressions, members_reached, reactions, comments, reposts, saves, sends,
  follows_gained, profile_views, premium_button_engagements, video_views, video_watch_time_seconds,
  video_avg_watch_time_seconds. Window: engagements, impressions, members_reached.
- Exemplar stats: `retrieval.similar(ideaText, {exclude self})`, then `latestByPost` per hit, rendered
  as `performanceNote` "N impressions, ER%, reactions, comments" (`drafting.service.ts:331-350`;
  `retrieval/prompt-assembly.ts:3, 44-48`). Retrieval failure degrades to no exemplars (:350).

### Retro reads measurements only

- Posts with status `measured` and a snapshot, newest first, capped (`retro.service.ts:61-69`); per post
  `tier`, `hook`, the current `bodyLinkedin`, metrics, a demographics summary, active rule ids at the
  latest draft run (:72-92; `retro-prompt.ts:3-14, 27-35`). No revisions, edits or feedback.

### Runs: usage is patchy, cost is derived

- `runs` (`schema.ts:216-251`): `engine`, `kind`, `model`, `prompt`, `output`, `parsed_ok`, `status`,
  `failure_kind`, `post_id`, `tokens_input`, `tokens_output`, `images_generated`, `tells`, `declined`,
  research fields, timestamps. No cost column; cost is computed at read time from settings pricing
  (:228). `run_steps` (:254-269) mirrors the token columns; codex reports one total into
  `tokens_output` (:264).
- The claude engine parses `result.usage` input and output tokens, ignores cache tokens, fails open
  (`engines/claude.engine.ts:62-72`).
- Live population of `tokens_input`/`tokens_output`: claude draft 18/30, triage 5/5, refine_selection
  6/6, image_html 0/3, image_hybrid 0/51, image_variate 0/7; codex image_gen 0/2, image_refine output
  only 3/3.

### Live counts (docker up)

posts 4 (3 `draft_ready`, 1 `measured`); post_revisions 51; runs 107; embeddings 15; dim_post linked 1.

## Decision fed

- Signal capture slice: (1) Publish writes an anchoring Revision; (2) a `signals` table (or per-kind
  columns) records rejections as well as acceptances, including retro rejections, refine discards and
  image patch rejections; (3) the Hook contradiction is resolved in S4 before `hook_pick` is built;
  (4) usage capture becomes a hard requirement of the `api` backend (R13) with cache fields and a cost
  column written at call time, since R12's cost model has to run on real numbers.
- Retro (decision 20 of the brief) gains the `edit` and `verdict` inputs it does not read today.

## Confidence

High: every fact is a file:line or a live query.
