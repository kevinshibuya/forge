# Post deletion

**Written 2026-09-11** by `reasoner` (fable) from a dispatch that mapped every reference to `posts.id`;
the three calls it reserved (measured, published, process) were handed back and decided the same
day. Kevin approved the design by handing them back. Starts from `main` at `584751e`.

There is no post-delete route. Deletion is the operation that discovers every unowned reference at
once, so this settles what a post owns before the code that needs it exists. ADR 0017 records the
obligation this closes: `post_inputs` and `uploads/inputs/<post>/` go with the post.

## What was verified before deciding

- Every reference to `posts.id` in `app/api/src/db/schema.ts`: `post_revisions.post_id` (:64),
  `post_inputs.post_id` (:79), `assets.post_id` (:91), `runs.post_id` (:227), all NO ACTION;
  `dim_post.post_id` (:141) SET NULL; `ideas.promoted_post_id` (:35) a bare integer;
  `embeddings` and `embedding_jobs` polymorphic on `(source_type, source_id)` (:271-293).
- Live constraint names, read from both `forge` and `forge_test`: `post_revisions_post_id_posts_id_fk`,
  `assets_post_id_posts_id_fk`, `runs_post_id_posts_id_fk`, `dim_post_post_id_posts_id_fk`, and
  **`post_inputs_post_id_fkey`**: 0019 wrote that FK inline, so it carries Postgres's default name.
- Live counts: four posts (three `draft_ready`, one `measured`, which is post #1), zero dangling
  `promoted_post_id`, four post embeddings, zero embedding jobs, three runs already with
  `post_id` NULL, zero running runs, zero cross-post reference assets. On disk:
  `uploads/assets/{1,4,5}`, `uploads/inputs/{5,9}`.
- `retrieval.service.ts:44-56` selects from `embeddings` alone: a dangling post embedding is
  retrieved with its full `chunk_text`.
- `images.service.ts:141-149` and `inputs.service.ts:153-161` both delete the row first, then the
  file, and tolerate a missing file.
- The weekly goal and the streak are derived live from `posts.list()` filtered on `publishedAt`
  (`planning.service.ts:87`, `isPublished`), handed to `goalAndStreak` (:327-338) from three call
  sites (:125, :167, :265). `computeStreak`'s own comment (:13): "Raising the goal restates history
  — that is deliberate", pinned by `planning.service.spec.ts:36`. `PostsService.allPublished`
  (`posts.service.ts:120`) has no caller in `src`; it is dead code.

## Decisions

### D1. Hard delete

The row goes, and with it everything the post owns. Revisions are the rollback path for content
(ADR 0001), not for existence. The `post_status` enum drives the state machine, the planner, the
weekly goal and every `inArray(posts.status, …)` filter, so a `deleted` status or a `deleted_at`
column would have to be threaded through `list`, `scheduledInRange`, `findByUrl`,
`referenceCandidates`, the analytics joins and the runs filters. Undo is the confirm step.

Rejected: soft delete via `deleted_at` (every reader filters, forever); a `discarded`-style status
(works for ideas because an idea has no children).

### D2. A measured post refuses deletion

409, message `post is measured; its record is final`.

"On a measured post nothing is editable" is enforced in `updateBody`, `patchMeta`,
`inputs.attach/remove` and `ideas.patch`; deletion is the largest edit. The reason it is not merely
consistency: a measured post's facts are the one thing on a post that cannot be regenerated. With
the post gone, `dim_post`'s `set null` leaves an analytics row that can never heal, because the
URL it would heal against (`findByUrl`, ADR 0008) went with the post. The retro reads measured
posts; deleting one deletes evidence.

There is no escape hatch in the app, and `psql` is not one either. A bare `DELETE FROM posts`
under the 0020 rules keeps referential integrity (children cascade, the run log and the dimension
lose the pointer, the idea's pointer nulls) but leaves three things behind: the post's embeddings,
which keep being retrieved into prompts; the idea stuck at `promoted` with no post; and the two
directories on disk. If a measured post ever has to go, the sanctioned path is a `force` option on
`PostsService.remove` reached through a script under `app/api/scripts`, never through the route,
so the service's own cleanup runs. That option is not built now: the only measured post is #1, and
nothing needs it.

The existing `dim_post … ON DELETE SET NULL` stays. It is the backstop for a `psql` delete and for
the one corner the route can reach: a `dim_post` linked to a non-measured post through `?postId`
(`analytics.service.ts:419`), which after deletion becomes an ordinary unlinked row, healable
against another post.

ADR sentence: *A measured post refuses deletion for the same reason it refuses every other write:
its facts are the one thing on a post that cannot be regenerated, and with the post gone there is
no URL left to heal them against. The app has no escape hatch; when one is needed it is a `force`
option on the service reached through a script, never the route, because a bare `DELETE` in psql
leaves the embeddings, the idea and the directories behind.*

### D3. A published, unmeasured post may be deleted

The app's record of a publication is the operator's to keep or drop. Refusing would force the app
to keep records of what was unpublished, which is the realistic delete case for a published post.

The cost weighed: the weekly goal and the streak are computed at read time from `posts.list()`
filtered on `publishedAt`, so a deleted post's row leaves the count and the week it was published
in is recounted. The project already accepts that the streak restates under an operator action:
raising the goal invalidates history by design (`planning.service.ts:13`, pinned by
`planning.service.spec.ts:36`). The precedent is distinguishable on two points, and neither
survives: a goal change is visible and reversible where a deletion is neither, but the streak is a
badge recomputed on every read and stored nowhere, so nothing downstream depends on its history,
and the confirm step below makes the recount visible before it happens. Sourcing the streak from
`dim_post` instead, which survives a delete with its own `published_at`, was considered and
rejected: it would count only posts that have appeared in an export, so a post published this week
would not count toward this week's goal until an export lands weeks later, which defeats a live
progress meter, and it reverses the existing decision at :331 that the predicate is `publishedAt`,
never the status. A publication ledger was rejected for the same reason plus one: it would record
a publication the operator has said did not happen.

The second cost: a post still live on LinkedIn will land unlinked in the next export (invariant 8)
and cannot be healed. That is the operator's call, taken at the confirm step, which says it.

The confirm step is two clicks on the Workspace: `delete post`, then the sentence and
`delete for good` beside `keep`. The sentence depends on the post:

- Unpublished: *Deleting removes this post, its revisions, inputs and images. Its runs stay in the
  log, and the idea it came from goes back to the backlog.*
- Published: *This post was published on <date>. Deleting removes its record here, not on
  LinkedIn: a later export of it will land unlinked, and the goal and streak for that week are
  recounted without it. Its runs stay in the log, and the idea goes back to the backlog.*

ADR sentence: *A published post may be deleted: the record of a publication is the operator's to
keep or drop, and refusing would force the app to keep records of what was unpublished. The weekly
goal and the streak are recounted from the posts that exist, as they already are when the goal
changes; a later export of a deleted post lands unlinked and stays so, which the confirm step says
before the operator commits.*

### D4. A post with a run in flight refuses deletion

409, message `post <id> has run <runId> in flight`.

A running draft's `.then` calls `updateBody` on a vanished post (`drafting.service.ts:279`); an
image run's `finalize` inserts `assets` rows against a missing FK and re-creates
`uploads/assets/<id>/` after the delete removed it. The check is one query inside the transaction:
`runs.postId = id AND runs.status = 'running'`. Concurrency is closed by the `FOR UPDATE` on the
post row: `beginDrafting`'s `UPDATE … WHERE status IN (…)` blocks on the lock, matches zero rows
and 404s; `runs.start`'s insert takes a KEY SHARE on the post row, blocks, and fails the FK after
commit. No orphan run row is possible.

Known coupling: a run left `running` by an api crash (nothing reconciles those; live has zero)
blocks deletion of its post until fixed by hand. The 409 names the run id so it is visible. The
reconcile is out of scope.

Rejected: no guard (honest but ugly failures, and the directory re-creation race); gating on
`posts.status = 'drafting'` (a crashed draft leaves `drafting` with no run to wait for, which is
exactly when deletion should be allowed).

### D5. Table-by-table disposition

| reference | disposition | where | reason |
|---|---|---|---|
| `post_revisions.post_id` | CASCADE | DB (0020) | the post's history; nothing references a revision |
| `post_inputs.post_id` | CASCADE, then `rm uploads/inputs/<id>/` after commit | DB + service | ADR 0017's obligation; stored copies are per post |
| `assets.post_id` | CASCADE, then `rm uploads/assets/<id>/` after commit | DB + service | every write goes through `candidateDir(postId, …)` (`asset-store.ts:17`), `patch-<runId>` dirs included. Only that directory is removed, never individual `png_path`s, so a legacy path into `<repo>/post-assets` (post #1, `asset-store.ts:47`) is never touched |
| `posts.reference_asset_id` on other posts | SET NULL, unchanged | DB (existing) | the cost of the posts↔assets cycle: another post that pinned one of this post's hybrid candidates (`referenceCandidates` allows it) silently loses the pin. Same rule that applies when that candidate is deleted by hand; live has zero such pins. Postgres needs no other fix: referential actions are per-statement triggers, and the deleted post's own reference is moot |
| `runs.post_id` | SET NULL | DB (0020) | invariant 6: every model call stays audited. The run log already renders a null post (`run-console.tsx`; three live runs have it). Cost attribution by post is lost for deleted posts; accepted |
| `run_steps.run_id` | CASCADE from runs, unchanged | DB | follows the run, which survives |
| `dim_post.post_id` | SET NULL, unchanged | DB | see D2 |
| `ideas.promoted_post_id` | service revert, plus a new FK SET NULL as backstop | service + DB (0020) | in the transaction: `promoted_post_id = NULL`, `status = 'triaged'` when `suggested_tier IS NOT NULL` else `'new'`, a status `promote` accepts again. The idea is the raw material and the common reason to delete a post is to redo it. The FK exists so a `psql` delete cannot leave a dangling number |
| `embeddings`, `embedding_jobs` with `source_type = 'post'` | explicit DELETE in the transaction | service | no FK is possible on a polymorphic key; a dangling vector puts a deleted post's text into a prompt. Inside the transaction, not after: a crash after commit would leave exactly that leak |
| `uploads/analytics/<sha256>.xlsx` | untouched | — | keyed by content hash, shared; `source_files` never references posts |
| research staged dirs | untouched | — | per run, under tmp, removed when the run settles |

Rejected for `runs`: CASCADE (breaks invariant 6); RESTRICT kept (no post that ever ran could be
deleted). Rejected for `ideas`: cascade-delete the idea (loses the captured thought); leave
`status = 'promoted'` with a null pointer (`promote` requires `new|triaged`; the Workspace reads the
idea by `promotedPostId`; the idea is stranded).

### D6. The rule lives in both places, split by what each can express

`ON DELETE` clauses for the FK'd children; a service transaction, `updateBody`-shaped, for what the
database cannot say. With cascade declared, a `psql` delete cannot orphan a child, and a future
table that adds a plain FK to `posts` fails the delete loudly by Postgres's default, which is the
right default. The transaction: `SELECT … FOR UPDATE` on the post row, the D2 and D4 gates inside
the lock, the embeddings deletes, the ideas revert (two typed updates, one per `suggested_tier`
case, rather than a raw `CASE` cast onto the enum), then `DELETE FROM posts`. Same shape as
`updateBody` (`posts.service.ts:205-224`), for the same reason: the gate and the write share one
lock. Whether the embeddings deletes are inline in `PostsService` or an `EmbeddingsService` helper
that takes the `tx` is the plan's choice; the constraint is that they run inside the transaction.

Rejected: service-only with RESTRICT kept (the service enumerates children forever and the schema
keeps lying about ownership); DB-only (cannot reach embeddings, ideas or the disk).

### D7. Rows first, commit, then the directories, best-effort

After commit: `rm -rf uploads/inputs/<id>/` and `rm -rf uploads/assets/<id>/`, each failure logged
as a warning, never failing the request. Precedent: `images.remove` and `inputs.remove`.

Fail-safe direction: a crash after commit and before `rm` leaves an orphan directory nothing can
reach. Post ids are `serial` and never reused, so `uploads/inputs/9/` can never be mistaken for a
future post's; nothing lists these directories by id (`listPngs` runs on a fresh group dir at
generation; `stageable` reads per-row stored paths). Files-first fails dangerous: a crash after
`rm` and before commit leaves `assets` rows that 404 and `post_inputs` rows whose stored copy is
missing, which fails the next run at staging.

No sweeper, no startup reconcile. A job that deletes directories under an env-configurable root
(`INPUTS_ROOT`, `ASSETS_ROOT`) on the operator's disk is more risk than unreachable bytes are
worth. If it ever matters, a one-off script is the tool; out of scope.

Helpers: `removePostInputs(postId)` in `app/api/src/inputs/inputs-store.ts` beside `removeStored`,
`rm(path.join(inputsRoot(), String(postId)), { recursive: true, force: true })`;
`removePostAssets(postId)` in `app/api/src/images/asset-store.ts` on `assetsRoot()`. Both refuse
a non-positive or non-integer id before joining, so the joined path can never be the root.

### D8. Route, service, web

`DELETE /posts/:id` answers 200 with no body, the shape `DELETE /posts/:postId/inputs/:inputId`
already has and the client's `del<void>` accepts. 404 unknown; 409 measured (D2); 409 run in
flight (D4). `PostsService.remove(id): Promise<void>`.

Web: `api.del<void>('/posts/:id')`; a `useDeletePost` mutation that invalidates `['posts']`,
`['ideas']` (the idea moved) and the planner queries, then navigates to `/posts`; the two-click
confirm of D3 on the Workspace. The affordance's placement in the Workspace header and its exact
styling are the plan's call under the design-tells hook; the copy is fixed by D3.

### D9. Migration `0020_post_delete.sql`

Journal entry `idx: 20`, `version: "7"`, `when` in epoch ms at authoring, `tag: "0020_post_delete"`,
`breakpoints: true`. No snapshot (none exist past 0010).

```sql
-- Post deletion. What a post owns goes with it; the run log and the analytics dimension keep
-- their rows and lose the pointer. 0019 wrote post_inputs' FK inline, so it carries Postgres's
-- default name; it is re-added under drizzle's so the four read alike.
ALTER TABLE "post_revisions" DROP CONSTRAINT "post_revisions_post_id_posts_id_fk";--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_inputs" DROP CONSTRAINT "post_inputs_post_id_fkey";--> statement-breakpoint
ALTER TABLE "post_inputs" ADD CONSTRAINT "post_inputs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_post_id_posts_id_fk";--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_post_id_posts_id_fk";--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "ideas" SET "promoted_post_id" = NULL WHERE "promoted_post_id" IS NOT NULL AND "promoted_post_id" NOT IN (SELECT "id" FROM "posts");--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_promoted_post_id_posts_id_fk" FOREIGN KEY ("promoted_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;
```

`schema.ts` edits so the file tells the truth: `:64`, `:79`, `:91` gain `{ onDelete: 'cascade' }`;
`:227` gains `{ onDelete: 'set null' }`; `:35` becomes
`integer('promoted_post_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' })`
(the thunk form, because `ideas` is declared before `posts`; precedent at `:48-49`).

### D10. Scope

In: 0020 and the schema edits; `PostsService.remove` and `DELETE /posts/:id`; the two store
helpers; the ideas revert; the embeddings purge; the tests below; the web mutation and the confirm
affordance (a route with no button is dead code in a single-user app; it is the plan's last task
and separable); ADR 0018; the CONTEXT.md and HANDOFF amendments.

Out: deleting measured posts or any analytics row (`dim_post`, facts, `source_files`); the `force`
option and its script; an orphan-directory sweeper or startup reconcile; a stuck-`running`
reconcile; run deletion; idea deletion; bulk delete; undo.

## Tests the plan must carry (api, test database)

1. Deleting a `draft_ready` post seeded with a revision, a `file` input with a stored copy under a
   tmp `INPUTS_ROOT`, an asset with a png under a tmp `ASSETS_ROOT/<id>/<group>/`, a finished run,
   a post embedding, and a promoted idea: 200; revision, input and asset rows gone; the run row
   present with `postId` null; embeddings and jobs gone for `('post', id)`; the idea at
   `promotedPostId` null and status `triaged` (seeded with a tier), and a second idea seeded without
   a tier back at `new`; both directories gone.
2. Measured post: 409 with D2's sentence, every child row still present.
3. A run seeded `running` on the post: 409 naming the run.
4. Unknown id: 404.
5. Another post pinning one of the deleted post's hybrid assets as reference: afterwards its
   `referenceAssetId` is null (the cycle, proved).
6. An asset whose `png_path` points outside `ASSETS_ROOT` (a tmp file standing in for
   `post-assets/`): the file survives the delete.
7. `rm` failing (stub the helper to throw): still 200, warning logged. The sabotage check for D7's
   "never fails the request".
8. `test/http-surface.spec.ts`: `DELETE /api/posts/:id` through supertest for the empty-body 200.
9. Web: the confirm renders the published sentence for a post with `publishedAt` and the unpublished
   one otherwise; `keep` sends nothing; `delete for good` calls the mutation once.

Not verified by the author: that the inputs and image specs already set `INPUTS_ROOT`/`ASSETS_ROOT`
to tmp dirs. The plan's author checks before writing test 1.

## ADR 0018, decision paragraph

Title: *A post is deleted whole; its audit and its measurements are not the post's to take.*

Deleting a post removes the post and everything it owns: its revisions, its inputs and their
stored copies, its assets and their files, its embeddings, and the promotion that made it, which
returns the idea to the status it was promoted from. Two things survive with the pointer cleared:
the runs, because every model call stays an audited run whether or not what it was for still
exists, and the analytics dimension, because an export's facts are LinkedIn's record, not the
post's. A measured post refuses deletion for the same reason it refuses every other write: its
facts are the one thing on a post that cannot be regenerated, and with the post gone there is no
URL left to heal them against. The app has no escape hatch; when one is needed it is a `force`
option on the service reached through a script, never the route, because a bare `DELETE` in psql
leaves the embeddings, the idea and the directories behind. A published post may be deleted: the
record of a publication is the operator's to keep or drop, and refusing would force the app to
keep records of what was unpublished. The weekly goal and the streak are recounted from the posts
that exist, as they already are when the goal changes; a later export of a deleted post lands
unlinked and stays so, which the confirm step says before the operator commits. A run in flight
refuses deletion too. The ownership is declared in the schema (`ON DELETE cascade` on the owned
tables, `set null` on the run log and the dimension) so nothing but the app's own transaction can
leave an orphan; what the schema cannot say, the polymorphic embeddings, the idea's status, the two
directories on disk, the service does inside the same lock `updateBody` takes, with the
directories removed after commit, because an unreachable orphan directory is the cheaper failure
and post ids are never reused.

Considered: soft delete (every reader filters forever); refusing published posts (keeps records of
what the operator unpublished); a publication ledger so the streak cannot move (a second source of
truth for a badge); cascading the run log (breaks invariant 6); a sweeper (deletes on the
operator's disk under a configurable root, for bytes nobody can reach).

## Record amendments

- `CONTEXT.md`, **Idea**: "Its status is settled at promotion and does not move again" gains
  "unless the post is deleted, which returns the idea to `triaged` or `new`."
- `CONTEXT.md`, **Post**: a post is deleted whole except its runs and its measurements; a measured
  post is not deletable through the app.
- `CONTEXT.md`, **Streak**: derived from the posts that exist; a deleted post recounts its week.
- `PostsService.allPublished` (`posts.service.ts:120-124`) and its one assertion at
  `test/posts.spec.ts:120` are deleted on `fix/carried-debts`, not in this slice: dead code with no
  design in it, and the plan stays free of unrelated edits.
- `HANDOFF.md` traps: `post_inputs`'s FK is named `post_inputs_post_id_fkey` on the live database
  until 0020 renames it.
