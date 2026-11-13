# Post deletion implementation plan

**Goal:** `DELETE /posts/:id` removes a post and everything it owns, refuses a measured post and a post with a run in flight, returns the idea to the backlog, and the Workspace offers it behind a two-click confirm that says what the deletion costs.
**Architecture:** migration 0020 declares ownership in the schema: `cascade` on revisions, inputs and assets, `set null` on the run log and a new FK on `ideas.promoted_post_id`. `PostsService.remove` is one `updateBody`-shaped transaction: `FOR UPDATE` on the post row, the measured and run-in-flight gates inside the lock, the embeddings purge through a new `EmbeddingsService.removeFor(…, tx)`, the two typed ideas reverts, then the row delete; after commit, two store helpers remove `uploads/inputs/<id>/` and `uploads/assets/<id>/` best-effort. The web adds `useDeletePost` and a `DeletePost` component in the Workspace's sticky band, last and separable. ADR 0018 records the decision.
**Spec:** `docs/superpowers/specs/2026-09-11-post-delete-design.md` (D1 to D10, the nine tests, the ADR paragraph, the record amendments)
**Execution model:** opus

**Review wave:** both `reviewer` legs at xhigh, per HANDOFF.md's instruction for this slice (a transaction gating on a lock, cascades, and a filesystem removal ordered against a commit).

**Second review wave, 2026-09-24, on Kevin's instruction:** `reviewer` on fable 5.1 and `reviewer` on opus 5.5, both xhigh; codex was out of quota. Consolidated by `reasoner` on fable into one fix pass, applied here. Kevin's two calls: the idea revert drops the lock and the tier predicate on its second update (Task 4), and the embed-after-commit race is documented with the retrieval join named as the follow-up, not built. No further wave.

**Already landed, not in this plan:** the spec's `allPublished` amendment shipped in PR #23 (`0fd4932`). The spec's "not verified by the author" item is verified: `app/api/test/setup-assets.ts` points `ASSETS_ROOT` and `INPUTS_ROOT` at fresh temp dirs before every test file (`setupFiles` in `app/api/vitest.config.ts`), and both `assetsRoot()` (`asset-store.ts:9`) and `inputsRoot()` (`inputs-store.ts:8`) read their env var lazily, so Test 1 needs no root of its own.

## Global constraints

- Order: Task 0, then Tasks 1 to 5 in sequence (the api spine, shippable on its own), then Task 6 (web, separable), then Task 7. One branch, `feat/post-delete`, cut from `ai-staging` after the docs-cleanup PR (`chore/docs-cleanup`) has merged into it. One PR against `ai-staging`. ADR 0018 is written in Task 5.
- No change under `app/shared`. Nothing in this plan needs a shared type. If a task finds it does, stop and report `blocked`.
- Migrations are hand-written: a `.sql` file plus a journal entry in `app/api/src/db/migrations/meta/_journal.json` (`idx`, `version: "7"`, `when` in epoch ms, `tag`, `breakpoints: true`). Statements are separated by `--> statement-breakpoint`. Applied migrations (0000 to 0019) are never edited. No `drizzle-kit generate`. No snapshot: none exist past 0010.
- `npm run db:migrate` and every script under `app/api/scripts` with `DATABASE_URL` unset hit the live database. The test database is `postgres://forge:forge@localhost:5433/forge_test`, which every api spec defaults to through its `url` const. Never two api vitest processes at once (`fileParallelism: false`; several files in one `vitest run` are fine). Scripts and probes run from `app/api/`.
- Typecheck covers tests: `app/api/tsconfig.json` includes `test`, `app/web/tsconfig.app.json` includes every spec. `noUncheckedIndexedAccess` and `noUnusedLocals` are on. TypeScript `any` only when nothing else compiles.
- A Nest controller method called directly does not run its `ZodBody` pipe or answer with a status. The route's statuses (200 empty body, 404, 409) are proved through `createNestApplication` plus supertest; the transaction's single-connection behaviour is proved on the service. Its behaviour under concurrency is NOT proved by any test in this plan: every case runs sequentially, so a seeded `running` run proves the gate's predicate and nothing about the lock. Both review legs raised this independently and it is accepted, with the gap and the reasoning written into Task 4.
- The rule lives in both places, split by what each can express (D6): the database cascades and nulls; the service does what the database cannot say, inside one lock. The embeddings deletes run inside the transaction, never after it. The directories are removed after commit, never before, and never fail the request (D7).
- Exact sentences: 404 `post <id> not found` (the existing `PostsService.get` message); 409 measured `post is measured; its record is final`; 409 in flight `post <id> has run <runId> in flight`. The confirm copy is D3's, verbatim, both variants.
- The store helpers refuse a non-positive or non-integer id before joining, so the joined path can never be the root (D7).
- Only the post's directory under each root is removed, never an individual `png_path`, so a legacy path into `<repo>/post-assets` is never touched (D5, Test 6).
- Any test whose assertion is an absence (a file that survives, a row that stays, a request that is not sent) is proved once by sabotage: delete the guard it covers, watch it fail, restore. The plan names the ones that need it.
- Post #5 is the sacrificial record and stays: `route-smoke.mjs` reads and mutates `/posts/5` (lines 16, 22, 28) and `docs/manual-testing-guide.md:312` names it. The inputs spec does not, despite its comment: it mints its own throwaway row against `forge_test`. Posts #1 and #4 and the settings row are never mutated. Post #1 is the only measured post and D2 depends on it staying that way, so nothing in this plan deletes it. The live delete in Task 7 is of a post created for the purpose.
- No change to `docs/manual-testing-guide.md`: D10 does not list it.
- Commit messages in the house style: `feat(scope): a sentence in lower case`, one commit per task. Prose in commits, comments, the ADR and the PR: no em dashes, no parentheticals.

---

### Task 0: Branch and the plan

**Files:**
- `docs/superpowers/plans/2026-09-11-post-delete.md` — this file, untracked; nothing outside this list

**Work:** confirm the docs-cleanup PR (`chore/docs-cleanup`) has merged into `ai-staging`; if it has not, stop and ask Kevin, because Task 5 edits the rewritten `CONTEXT.md`. Then `git switch -c feat/post-delete` from the `ai-staging` tip. The spec is already committed (`7512c8c`). Commit the plan.

**Acceptance check:** `git status --short` is empty on `feat/post-delete`; `git log --oneline -1` shows the docs commit above the `ai-staging` tip.

**Boundaries:** no code.

- [x] Cut the branch, commit: `docs: post deletion planned`

---

### Task 1: Migration 0020 and the schema tells the truth

**Files:**
- `app/api/src/db/migrations/0020_post_delete.sql` — create
- `app/api/src/db/migrations/meta/_journal.json` — modify: append entry `idx: 20`, `version: "7"`, `when` in epoch ms at authoring, `tag: "0020_post_delete"`, `breakpoints: true`
- `app/api/src/db/schema.ts` — modify: line 35 (`ideas.promotedPostId`), line 64 (`postRevisions.postId`), line 79 (`postInputs.postId`), line 91 (`assets.postId`), line 227 (`runs.postId`)
- `app/api/test/schema.spec.ts` — modify: one new case; nothing outside this list

**Interfaces:**
- Produces, verbatim, the migration (D9):
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
- Produces, in `schema.ts`: `.references(() => posts.id, { onDelete: 'cascade' })` at lines 64, 79 and 91; `.references(() => posts.id, { onDelete: 'set null' })` at line 227; and line 35 becomes `promotedPostId: integer('promoted_post_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' })`, the thunk form because `ideas` is declared before `posts` (precedent at lines 48 to 49, `referenceAssetId`). `AnyPgColumn` is already imported for that precedent.

**Work:** The migration is the spec's, character for character. The `UPDATE "ideas"` line runs before the FK is added so a dangling pointer cannot fail the `ADD CONSTRAINT`; live has zero such rows, and the line is there for any database that does not.

The new `schema.spec.ts` case reads `information_schema.table_constraints` joined to `information_schema.referential_constraints` on `constraint_name`, schema `public`, type `FOREIGN KEY`, tables `post_revisions`, `post_inputs`, `assets`, `runs`, `ideas`, `dim_post`, and asserts six pairs are present and one name is absent:

| constraint | delete_rule |
|---|---|
| `post_revisions_post_id_posts_id_fk` | `CASCADE` |
| `post_inputs_post_id_posts_id_fk` | `CASCADE` |
| `assets_post_id_posts_id_fk` | `CASCADE` |
| `runs_post_id_posts_id_fk` | `SET NULL` |
| `ideas_promoted_post_id_posts_id_fk` | `SET NULL` |
| `dim_post_post_id_posts_id_fk` | `SET NULL` |

and `post_inputs_post_id_fkey` is not among the rows. Assert presence per pair, not equality on the whole result: `dim_post` carries a second FK (`first_seen_source_file_id`) that is not this test's business. `dim_post`'s row is pinned on purpose: D2 keeps it unchanged and this is where a later migration would be caught changing it.

Twelve specs delete from `posts`: `e2e-happy-path:62`, `seed:34`, `retro:50`, `review-fixes:56`, `planning:63`, `planner-payload:49,192,207-208`, `schedule-columns:28-29`, `schedule-endpoint:72`, `analytics-overview:107`, `analytics-link:56,97`, `analytics-post-detail:100,128`, `analytics-board:124`. None changes meaning under 0020: a delete that succeeds today cannot fail under cascade or set null, every one that has runs, revisions or assets deletes them first because today's NO ACTION forces it, and the one new rejection 0020 adds, the FK on `ideas.promoted_post_id`, hits only an ideas write with a fake post id, of which the tests have none (`posts.spec.ts:46,59,60` use the post just created). `retro`, `review-fixes`, `planning` and `planner-payload` leave or delete `ideas` after `posts`; their pointers are nulled instead of dangling and nothing reads them. The full api run is the regression check.

**Acceptance check:** from `app/api`: `npx vitest run test/migrations-fresh.spec.ts test/schema.spec.ts`. Red before: the new case finds `post_inputs_post_id_fkey` present, `NO ACTION` on `post_inputs`, and no `ideas` FK. Green after. Then `npx vitest run` from `app/api`, whole, green, and `npm run typecheck` from `app/`.

**Boundaries:** no service change, no web change. `dim_post`'s existing FK is not touched by the migration. No edit to any file `0000` to `0019`. Do not apply 0020 to the live database in this task; Task 7 does, at the gate, on purpose. If 0020 has to change after it has been applied to `forge_test`, drizzle will not rerun it. `forge_test` is disposable: drop and recreate the database in the `forge-db` container and let any spec's `beforeAll` reapply 0000 to 0020. Never on live; live gets 0020 once, in Task 7.

- [x] Before reading the red: `pg_isready -h localhost -p 5433` (or `docker ps` showing `forge-db`) exits 0. `forge_test` was down at planning time, and a connection refusal is not the red this step wants.
- [x] The constraint case in `schema.spec.ts` FIRST, and watch it go red. An applied migration is never un-applied, and every api spec's `beforeAll` runs `migrateDb` against `forge_test`, so once 0020 has run there is no way back to the red state. Writing the case after the migration makes this task's "red before" a claim nobody can reproduce.
- [x] Migration file and journal entry
- [x] The five `schema.ts` edits
- [x] Run the checks; typecheck
- [x] Commit: `feat(db): the schema says what a post owns`

---

### Task 2: The two store helpers

**Files:**
- `app/api/src/inputs/inputs-store.ts` — modify: new exported `removePostInputs` beside `removeStored` (line 66)
- `app/api/src/images/asset-store.ts` — modify: new exported `removePostAssets`; `rm` joins the `node:fs/promises` import at line 3
- `app/api/test/inputs-store.spec.ts` — create
- `app/api/test/images.spec.ts` — modify: four cases appended LAST in the existing store `describe`, on post ids 21 and 22; nothing outside this list

**Interfaces:**
- Produces, verbatim:
  ```ts
  // inputs-store.ts
  /** The whole of `uploads/inputs/<postId>/`. Refuses an id that could join to the root itself. */
  export async function removePostInputs(postId: number): Promise<void>;
  // asset-store.ts
  /** The whole of `uploads/assets/<postId>/`, every candidate group and patch dir under it.
   *  Never an individual png_path: a legacy path into <repo>/post-assets is not under this root. */
  export async function removePostAssets(postId: number): Promise<void>;
  ```
  Both: `if (!Number.isInteger(postId) || postId <= 0) throw new Error(...)` naming the id, before any join; then `rm(join(<root>(), String(postId)), { recursive: true, force: true })`. `force: true` makes a missing directory a no-op, the same tolerance `removeStored` has.

**Work:** Two functions, one shape. The refusal is a thrown `Error`, not a silent return: a caller that hands over `NaN` has a bug, and `remove` in Task 4 logs it as the warning it is. The inputs helper uses `path.join` and `inputsRoot()`; the assets helper uses `join` and `assetsRoot()`, matching each file's existing imports.

`inputs-store.spec.ts`, new file, on the global temp `INPUTS_ROOT` that `setup-assets.ts` provides (read it back through `inputsRoot()`, never re-spell it): `writeStored(7, 1, 'file', 'a.md', 'x')` and `writeStored(8, 1, 'file', 'b.md', 'y')`, then `removePostInputs(7)`: post 7's folder is gone and post 8's file still reads `y`; a second `removePostInputs(7)` resolves; `removePostInputs(0)`, `(-1)`, `(1.5)` and `(NaN)` each reject, and `<root>/NaN`, pre-created with `mkdirSync` before the calls, still exists afterwards. `inputsRoot()` mkdirs on every call (`inputs-store.ts:10`), so "the root still exists" could never go red; the guard's real job is that `join(root, String(NaN))` is never handed to `rm`. Ids 7 and 8 are free to use here because this is a new file with its own root.

The same four cases for `removePostAssets` go in `images.spec.ts`'s store describe, seeded through `writePng(candidateDir(21, 'g'), 0, …)` and a sibling under post 22. **Not ids 7 or 8, and appended last.** `ROOT` is set at file scope (line 23, exported to `ASSETS_ROOT` at 24), above the describe, so every case in the file shares one root, and the existing store chain is order-dependent on post 7: `candidateDir(7, 'grp')` at line 28, two `writePng` calls into it at lines 31 to 38, then `resolveAssetFile(join(candidateDir(7,'grp'), '0.png'))` at lines 41 to 44, which calls `realpathSync` and throws `NotFoundException` when the file is missing. A `removePostAssets(7)` placed above that line removes `ROOT/7/` whole and turns a passing case red for a reason that has nothing to do with this plan. Post 99 is taken too, by the symlink case. The sibling-survives assertion is an absence: sabotage once by joining the root alone and watching it fail.

**Acceptance check:** from `app/api`: `npx vitest run test/inputs-store.spec.ts test/images.spec.ts`. Red before: the new spec file fails to import; the images cases fail on a missing export. Green after.

**Boundaries:** no service change. `removeStored`, `storedPath`, `resolveAssetFile` and the rest of both stores are untouched.

- [x] `removePostInputs`, `removePostAssets`
- [x] The two specs, sabotage the sibling case once, run the check
- [x] Commit: `feat(stores): a post's inputs and assets directories can be removed whole`

---

### Task 3: The embeddings purge takes a transaction

**Files:**
- `app/api/src/embeddings/embeddings.service.ts` — modify: exported `Tx` type, new `removeFor`
- `app/api/test/embeddings.spec.ts` — modify: one new case in the `EmbeddingsService` describe; nothing outside this list

**Interfaces:**
- Produces, verbatim:
  ```ts
  /** The drizzle transaction handle, the same alias analytics.service.ts:24 declares privately. */
  export type Tx = Parameters<Parameters<ForgeDb['transaction']>[0]>[0];
  /**
   * Every chunk and every pending retry job for one source, on the handle given. A caller deleting
   * the source row passes its own `tx` so the purge commits or rolls back with the delete: a
   * dangling post vector puts a deleted post's text into a prompt, and a crash between a commit and
   * a later purge would leave exactly that.
   */
  async removeFor(sourceType: EmbeddingSourceType, sourceId: number, on: Tx | ForgeDb = this.db): Promise<void>;
  ```
  Two deletes on `on`: `embeddings` then `embeddingJobs`, both `where (sourceType, sourceId)`. No provider call, no queueing, nothing thrown on zero rows.

**Work:** This is where the purge lives, not inline in `PostsService`, for one reason: `PostsService` today touches `embeddings` only through `upsertFor` and imports no embeddings table (`posts.service.ts:9` imports `assets, postRevisions, posts`), and the delete-by-source shape already exists at `writeChunks` lines 38 to 40. The `tx` parameter is what D6 asks for. The union parameter type is chosen so a future caller without a transaction can still use it. If the union does not typecheck against both call sites, the fallback is `removeFor(sourceType, sourceId, tx: Tx)` with the default **dropped as well**, and `PostsService` as the only caller; say so in the commit body. Narrowing the type while keeping `= this.db` does not compile either, because `this.db` is a `ForgeDb` and would no longer be assignable to the parameter.

**Both new cases are appended LAST in the describe, and this is load-bearing.** Two existing cases assert on the whole table unfiltered: line 62 to 63 (`const rows = await db.select().from(embeddings); expect(rows).toHaveLength(1)`) and the same shape in `upsert replaces existing chunks` at lines 70 to 71. The cases below deliberately leave survivors behind, so placing either one above line 68 turns both existing cases red with `expected length 1, received 3`. The weaker ordering constraint points the same way: `FlakyProvider` throws only on its first call (`embeddings.spec.ts:22`), which an earlier case consumes.

The purge case: `svc.upsertFor('post', 43, 'text')` and `svc.upsertFor('idea', 43, 'text')` and `svc.upsertFor('post', 44, 'text')`, plus one `embeddingJobs` row inserted for `('post', 43)` directly. Then `db.transaction((tx) => svc.removeFor('post', 43, tx))`. Assert: zero `embeddings` and zero `embeddingJobs` for `('post', 43)`; the `('idea', 43)` and `('post', 44)` rows still there. The survivors are absences: sabotage once by dropping the `sourceType` predicate.

The rollback case, which is what actually proves the `on` parameter is used. A committed purge passes even when the implementation ignores `on` and deletes through `this.db`, and so do every one of Task 4's success tests, because a successful delete commits either way. The failure that hides behind that: a deletion that rolls back after the purge leaves a post that still exists with its vectors gone, and nothing regenerates them. So: seed `('post', 45)` with a chunk and a job, then `await expect(db.transaction(async (tx) => { await svc.removeFor('post', 45, tx); throw new Error('rollback'); })).rejects.toThrow('rollback')`, and assert both rows are still present afterwards. Sabotage once by changing `removeFor` to use `this.db` and watching this case, and only this case, fail.

**Acceptance check:** from `app/api`: `npx vitest run test/embeddings.spec.ts`. Red before: `removeFor` is not a function. Green after.

**Boundaries:** `upsertFor` and `writeChunks` unchanged. `RetryPoller` unchanged. No change to `PostsService` yet.

- [x] `Tx`, `removeFor`
- [x] The purge case and the rollback case, both appended last; sabotage each once; run the check
- [x] Commit: `feat(embeddings): a source's vectors and retry jobs are purged on the caller's transaction`

---

### Task 4: `PostsService.remove` and `DELETE /posts/:id`

**Files:**
- `app/api/src/posts/posts.service.ts` — modify: `Logger` joins the `@nestjs/common` import; `embeddingJobs` is not imported (Task 3 owns that); `ideas`, `runs` join the schema import at line 9; `removePostInputs` and `removePostAssets` imported; a `log` field like `images.service.ts:36`; new `remove`
- `app/api/src/posts/posts.controller.ts` — modify: `Delete` joins the import at line 1; new route
- `app/api/test/posts.spec.ts` — modify: a new `describe('PostsService.remove')` with Tests 1 to 6; imports it needs (`afterAll` from vitest; `postInputs`, `runs`, `embeddingJobs`, `dimPost`, `factPostLifetime` from schema, `writeStored` and `inputsRoot` from `../src/inputs/inputs-store`, `writePng`, `candidateDir`, `assetsRoot` from `../src/images/asset-store`, `RunsService`, `existsSync`)
- `app/api/test/post-delete-rm.spec.ts` — create: Test 7, its own file because `vi.mock` is per file
- `app/api/test/http-surface.spec.ts` — modify: Test 8; the module gains `EmbeddingsModule` and `PostsModule` with the fake provider override, the way `posts.spec.ts:33-35` does it; the running run's id is captured; nothing outside this list

**Interfaces:**
- Consumes: `EmbeddingsService.removeFor(sourceType, sourceId, tx)` from Task 3; `removePostInputs`, `removePostAssets` from Task 2; `runs.status` enum `running | succeeded | failed | timeout` (`schema.ts:20`); `ideas.status` enum `new | triaged | promoted | discarded` (`schema.ts:11`).
- Produces: `async remove(id: number): Promise<void>` on `PostsService`, and `@Delete(':id') async remove(@Param('id', ParseIntPipe) id: number): Promise<void>` on the controller that awaits it and returns nothing, so Nest answers 200 with an empty body, the shape `DELETE /posts/:postId/inputs/:inputId` already has and the client's `del<void>` accepts (`client.ts:287`).
- Produces, verbatim, the transaction, because the order and the lock are the contract (D4, D6):
  ```ts
  await this.db.transaction(async (tx) => {
    // FOR UPDATE: the gates and the delete share one lock, the same shape updateBody takes. A
    // beginDrafting UPDATE or a runs.start insert that OVERLAPS this transaction blocks on it and
    // then fails, so no orphan run row is possible. It does not close the launch window: see the
    // note below the block.
    const [post] = await tx.select().from(posts).where(eq(posts.id, id)).for('update');
    if (!post) throw new NotFoundException(`post ${id} not found`);
    if (post.status === 'measured') throw new ConflictException('post is measured; its record is final');
    const [running] = await tx.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.postId, id), eq(runs.status, 'running'))).limit(1);
    if (running) throw new ConflictException(`post ${id} has run ${running.id} in flight`);
    // Inside the transaction, not after: a crash after commit would leave a vector that keeps
    // putting this post's text into prompts.
    await this.embeddings.removeFor('post', id, tx);
    // Two typed updates rather than a CASE cast onto the enum: the idea goes back to the status
    // promote accepts, triaged when it carries a tier and new otherwise. The second predicate is
    // "still points at this post" and nothing about the tier, on purpose: IdeasService.patch can
    // set a tier on a promoted idea without touching the post, so an idea with no tier at the
    // first update can have one by the second. A tier predicate here would let it slip both, and
    // the FK would then clear its pointer and leave it promoted, which promote refuses.
    await tx.update(ideas).set({ promotedPostId: null, status: 'triaged' })
      .where(and(eq(ideas.promotedPostId, id), isNotNull(ideas.suggestedTier)));
    await tx.update(ideas).set({ promotedPostId: null, status: 'new' })
      .where(eq(ideas.promotedPostId, id));
    await tx.delete(posts).where(eq(posts.id, id));
  });
  ```
  After the transaction returns: `removePostInputs(id)` then `removePostAssets(id)`, each in its own `try/catch`, each failure logged through `this.log.warn` naming the post id and which directory, the second attempted even when the first threw, neither ever rethrown. The comment on that block says why rows go first (D7: an unreachable orphan directory is the cheaper failure, and post ids are never reused).

**Two races the lock does not close, found by the review wave, written down rather than fixed here.** Both are out of scope for this slice, and both belong in the ADR's Consequences section in Task 5 so they are on the record instead of being discovered later.

1. *The launch window.* `drafting.service.ts:255` calls `beginDrafting` as a standalone committed UPDATE, and the run row is only inserted later inside `runner.execute`, after `gatherPromptParts` and `prepareFence` have staged files. In that gap the post reads `drafting` with no `running` run, so both gates pass and the delete succeeds; the launch then fails its foreign key. The spec's narrower claim at D4 holds, since no orphan run row can exist, but the broader reading that a post cannot vanish from under a launch does not. The failure is loud and the operator caused it by deleting a post they had just told to draft, which is why this is accepted rather than fixed.
2. *Embeddings written after their transaction.* `updateBody` calls `this.embeddings.upsertFor` after its transaction closes (`posts.service.ts:216`); `patchMeta`, `RetryPoller.tick` and the draft's own `.then` (`drafting.service.ts:279-288`, which runs after `runner.execute` has committed `runs.succeed` at `runner.service.ts:206`) have the same shape. The window is the provider's embed call, hundreds of milliseconds. A delete inside it purges in its transaction and the vector lands after, and `retrieval.service.ts:44-56` reads `embeddings` without joining `posts`, so the deleted post's text goes back into prompts. The D4 gate does not cover this: the draft's run is already `succeeded` when its embed runs, and the web's `isPostBusy` (`run-console.tsx:103-107`) looks only at running runs. Not closed here, by Kevin's call. The right close is read-side: a `leftJoin` on `posts` in `retrieval.similar` that drops a `post` hit with no row, which also covers a `psql` delete and a crash between commit and purge; it changes `retrieval.spec.ts:32-33`'s fixtures, which embed posts with no row, and it is a follow-up outside D10.

**Work:** The service method is the block above plus the two helper calls. The controller route is three lines. What the transaction does not do is also the contract: no `runs` update (the FK nulls the pointer), no `postRevisions`, `postInputs` or `assets` delete (the FKs cascade), no `dimPost` touch (its FK nulls, D2), no `posts.referenceAssetId` touch on other posts (the assets cascade fires the existing `set null`, D5).

Tests, `posts.spec.ts`, a new describe, each case on a post it creates. `mod` is local to `beforeAll` at `posts.spec.ts:33-36`; hoist it to a `let mod` beside `svc`, or take `RunsService` through `app.get(RunsService)`. `PostsModule` already imports `RunsModule`.

The new describe carries an `afterAll` that clears its own `postInputs` rows, for the reason `inputs.spec.ts:58-64` states in its own comment: `forge_test` is shared, and an input row left behind would block a later spec that wipes `posts`. Test 2's measured post keeps its input row through the refusal by design, so this is not optional. Relying on 0020's new cascade to clean it up instead would make these tests silently depend on Task 1 having landed and would spend a production behaviour as test teardown.

1. The full delete. Seed on a `draft_ready` post (`create` inserts `queued`; `db.update(posts).set({ status: 'draft_ready' })` right after, so the sentence stays literally true; the gate does not read it): `svc.updateBody(id, { body: 'a body', source: 'manual_edit' })` (writes a revision and, through the fake provider, a post embedding); one `embeddingJobs` row for `('post', id)` inserted directly; a `postInputs` row `{ postId, kind: 'file', ref: 'notes.md', bytes: 5 }` with `writeStored(id, inputId, 'file', 'notes.md', 'hello')`; a run `runs.start({ engine: 'claude', kind: 'draft', model: 'm', prompt: 'p', postId: id })` then `runs.succeed(runId, 'out', true)`, started and succeeded **before** the assets are inserted; an asset row `assetA` with `runId` set to that run and `pngPath` from `await writePng(candidateDir(id, 'g1'), 0, Buffer.from('a'))`; a second asset row on the same post with `sourceAssetId: assetA.id`; then `db.update(posts).set({ referenceAssetId: assetA.id })` on the post itself, so the delete crosses `assets.run_id`, `assets.source_asset_id` and the posts-assets cycle on the deleted row (all three are `set null`, `schema.ts:101-102` and `:48-49`, and the last fires against a row already gone); two ideas `{ status: 'promoted', promotedPostId: id }`, one with `suggestedTier: 'T2'` and one without. Assert presence first: one `embeddings` row and one `embeddingJobs` row for `('post', id)`, the two ideas at `promoted`, and `existsSync` true on both directories; an absence assertion on a fixture that never existed proves nothing. `await svc.remove(id)` resolves. Then: `svc.get(id)` rejects `NotFoundException`; zero rows in `postRevisions`, `postInputs`, `assets` for the post; the run row present, `status` still `succeeded`, `postId` null; zero `embeddings` and zero `embeddingJobs` for `('post', id)`; the tiered idea at `status: 'triaged'`, the other at `'new'`, both `promotedPostId` null; `existsSync(join(inputsRoot(), String(id)))` and `existsSync(join(assetsRoot(), String(id)))` both false.
2. Measured. **The status path matters and the short recipe does not work:** `create` inserts at the column default `queued` (`schema.ts:42`), `updateBody` does not move the status, and `approve` accepts only `draft_ready` (`transition(id, ['draft_ready'], …)`). So follow the ladder `posts.spec.ts:365-368` already uses: `beginDrafting`, `updateBody`, `endDrafting` (a post with a body lands at `draft_ready`), `approve`, `publish({ linkedinUrl })`, then `insertMeasured(db, svc, { postId, impressions: 1, reactions: 0, comments: 0, reposts: 0, saves: 0 })` the way `posts.spec.ts:153` does. Seed the full fixture before the refusal: the revision the body write made, an input row with its stored copy (`writeStored`), an asset row with a png under `candidateDir(id, 'g1')`, a finished run, an `embeddingJobs` row, and a promoted idea. `svc.remove(id)` rejects `ConflictException` with message `post is measured; its record is final`. Afterwards assert every row is still present, the idea still `promoted` with its pointer, the `dimPost` and `factPostLifetime` rows `insertMeasured` wrote still there, and, the assertion that can actually go red, `existsSync` true on the stored copy and on the png. The row assertions cannot fail on gate order: every write in `remove` is inside the transaction and the 409 rolls it back whatever the order. What escapes the transaction is the directory removal after it, so a `remove` that put the two helper calls in a `finally` passes every row assertion and deletes the files. Sabotage once exactly that way, watch this case fail on the files, restore.
3. Run in flight. `runs.start({ …, postId: id })` left running: `svc.remove(id)` rejects with `post <id> has run <runId> in flight`, the real ids interpolated. Then `runs.succeed(runId, 'out', true)` and `svc.remove(id)` resolves: the gate is the status, not the existence of a run.
4. Unknown id: `svc.remove(999999)` rejects `NotFoundException`.
5. The cycle. **Keep the post id and the asset id in separate variables:** `posts` and `assets` have independent serial sequences, so one identifier cannot stand for both, and reusing it either breaks the reference foreign key, pins an unrelated asset, or deletes the wrong post. Post A (`postA.id`) with a `hybrid` asset row (`assetA.id`, no file needed); post B with `db.update(posts).set({ referenceAssetId: assetA.id }).where(eq(posts.id, postB.id))`, bypassing `setReference`'s bg.png check on purpose. Then `svc.remove(postA.id)`: B's `referenceAssetId` reads null.
6. Outside the root. `mkdtemp` a directory outside `assetsRoot()`, write `legacy.png` in it, insert an asset row on the post with that absolute `pngPath`. `svc.remove(id)`: the post is gone and `existsSync(legacy)` is still true. Sabotage once by adding an `unlink(row.pngPath)` to `remove` and watching this fail.

`post-delete-rm.spec.ts`, Test 7. `vi.mock('../src/inputs/inputs-store', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/inputs/inputs-store')>()), removePostInputs: vi.fn().mockRejectedValue(new Error('EACCES')) }))` at the top, hoisted above the imports the way `render-disconnect.spec.ts:3-12` documents. Same module setup as `posts.spec.ts`. Seed a post with an asset png under `candidateDir(id, 'g')`. `const warn = vi.spyOn(Logger.prototype, 'warn')` (`Logger` from `@nestjs/common`; if the prototype spy does not observe the instance call, spy on the service's own `log` field through a typed cast, never `any`). `svc.remove(id)` resolves; `svc.get(id)` rejects; `warn` was called with a message containing `post <id>` and `inputs`; the assets directory is gone (the second helper still ran). This is D7's "never fails the request", proved.

`http-surface.spec.ts`, Test 8. The `beforeAll` already seeds `postId` with one running run (`attached-running`, line 32): capture that `runs.start` return as `runningId`. New case: `DELETE /api/posts/${postId}` answers 409 with `body.message` equal to `post ${postId} has run ${runningId} in flight`; a fresh post inserted in the case answers `DELETE /api/posts/${fresh}` with 200 and `res.text === ''`, and `GET /api/posts/${fresh}` then answers 404. `DELETE /api/posts/abc` answers 400 (`ParseIntPipe`). The `filters by postId` case at line 53 still sees two runs, since the 409 deleted nothing.

**Acceptance check:** from `app/api`: `npx vitest run test/posts.spec.ts test/post-delete-rm.spec.ts test/http-surface.spec.ts`. Red before: `svc.remove` is not a function; the http case gets 404 from an unrouted DELETE. Green after. Then `npm run typecheck` from `app/`.

**Boundaries:** `updateBody`, `patchMeta`, `beginDrafting` and every other method untouched. No `force` option (out of scope, D2). No reconcile of stuck `running` runs (D4, out of scope). No web change. `runs.service.ts`, `ideas.service.ts`, `inputs.service.ts`, `images.service.ts` untouched.

- [x] `remove` on the service, the route on the controller
- [x] Tests 1 to 6 in `posts.spec.ts`; sabotage Test 6 once
- [x] Test 7 in its own file; Test 8 in `http-surface.spec.ts`
- [x] Run the check, typecheck
- [x] Commit: `feat(posts): a post is deleted whole, its runs and its measurements stay`

---

### Task 5: ADR 0018 and the record amendments

**Files:**
- `docs/adr/0018-a-post-is-deleted-whole.md` — create
- `CONTEXT.md` — modify: the **Idea** entry (line 15), the **Post** entry (line 25), the **Streak** entry (line 185), line numbers as of the docs cleanup
- `HANDOFF.md` — modify: the `post_inputs_post_id_fkey` trap, found by that name (HANDOFF is rewritten at every handoff, so line numbers do not hold); nothing outside this list

**Work:** The ADR follows 0017's shape: an H1 that is the spec's title, *A post is deleted whole; its audit and its measurements are not the post's to take*, an opening that states the decision, a `Source:` line pointing at the spec, then sections. The decision paragraph is the spec's, under "ADR 0018, decision paragraph", verbatim. `## Considered` carries the spec's five rejected shapes as one sentence each. `## Consequences` states, from D4, D5 and D7: a run left `running` by an api crash blocks its post's deletion until fixed by hand, and the 409 names the run; another post that pinned one of the deleted post's hybrid candidates loses the pin silently, the same as when that candidate is deleted by hand; cost attribution by post is lost for a deleted post's runs; a crash between commit and the directory removal leaves an orphan directory nobody can reach and nothing sweeps, because post ids are never reused; a `psql` delete keeps referential integrity but leaves the embeddings, the idea's status and the directories behind. Add the two races Task 4 documents: a draft launch between its status write and its run insert can have its post deleted from under it, failing loudly on the foreign key, and a body write or a finished draft whose embedding lands after its own transaction can recreate a deleted post's vector during the embed call, which stays retrievable because retrieval does not join `posts`; the close is a join on `posts` in retrieval, not built here. Both are accepted here and named so a later slice can close them. One more: an input attach or a canvas edit is not a run, so D4 does not gate it; one that lands during the delete can recreate `uploads/<kind>/<id>/` after the removal, an orphan directory of the class D7 already accepts. Run `unslop` on it.

`CONTEXT.md`, three sentences, exact:
- **Idea**, line 15: "Its status is settled at promotion and does not move again" becomes "Its status is settled at promotion and does not move again, unless the post is deleted, which returns the idea to `triaged` or `new`."
- **Post**, after line 25's sentence: "A Post is deleted whole, except its Runs and its measurements, which keep their rows and lose the pointer; a measured Post is not deletable through the app."
- **Streak**, line 185: "Consecutive weeks that met the weekly goal, derived from the Posts that exist; a deleted Post recounts its week."

`HANDOFF.md`, the `post_inputs_post_id_fkey` trap is rewritten to what is true after this branch: `post_inputs`'s FK was `post_inputs_post_id_fkey` on both databases because 0019 wrote it inline; 0020 drops it by that name and re-adds it as `post_inputs_post_id_posts_id_fk`, so after 0020 the four post FKs read alike and `schema.spec.ts` pins the names and rules.

**Acceptance check:** from the repo root, one command that can actually fail:

```sh
test -s docs/adr/0018-a-post-is-deleted-whole.md \
  && ! grep -q '—' docs/adr/0018-a-post-is-deleted-whole.md \
  && git status --short docs/adr/0018-a-post-is-deleted-whole.md CONTEXT.md HANDOFF.md
```

The ADR is a **created** file, so it is untracked until it is staged: `git diff --stat` never lists it and would report a clean-looking two-file result while the task's largest deliverable is missing or half written. `git status --short` lists all three regardless of staging. The em dash check is `! grep -q` rather than `grep -c`, because `grep -c` exits nonzero when the count is zero, which makes the success case read as a command failure and invites a `|| true` that removes the check's ability to fail at all. Then read the three `CONTEXT.md` lines and confirm they match the sentences above.

**Boundaries:** no code. No other ADR is edited. The spec is not edited.

- [x] ADR 0018, unslopped
- [x] The three `CONTEXT.md` sentences, the HANDOFF trap
- [x] Commit: `docs: adr 0018, a post is deleted whole`

---

### Task 6: The Workspace deletes a post behind two clicks

Separable: Tasks 1 to 5 ship without it, and the route stays reachable by hand. It is here because a route with no button is dead code in a single-user app (D10).

**Files:**
- `app/web/src/api/hooks.ts` — modify: new `useDeletePost` after `usePostAction` (line 285)
- `app/web/src/ui/delete-post.tsx` — create: `DeletePost`
- `app/web/src/ui/delete-post.spec.tsx` — create
- `app/web/src/pages/Workspace.tsx` — modify: the import list; one `<DeletePost … />` after the copy button (line 175) inside the band's flex row
- `app/web/src/pages/Workspace.spec.tsx` — modify: `detail`/`loaded` accept a `Partial<PostDto>` override; two cases; nothing outside this list

**Interfaces:**
- Consumes: `api.del<void>` (`client.ts:287`); `useInvalidate` (`hooks.ts:19`); `useQueryClient` from `@tanstack/react-query`, for the detail eviction below; `Button`, `ErrorNote` from `../ui/primitives`; `fmtDateTime` from `../lib/format` (the formatter the band's `published ·` pill uses at `Workspace.tsx:153`, so the sentence and the pill never disagree on the date); `useNavigate` from `react-router` (precedent `Backlog.tsx:17`).
- Produces, verbatim:
  ```ts
  /**
   * Leaves the page FIRST, then evicts. The Workspace's usePost observer is still mounted when
   * onSuccess runs; removing its query under it makes TanStack build a fresh one on the next
   * render and fetch a 404 (usePost polls while `drafting`, and a crashed drafting post is
   * deletable). The detail is REMOVED rather than invalidated: invalidating would refetch a 404,
   * and leaving it cached would let a Back navigation paint the deleted post as an editable
   * Workspace from a thirty-minute cache. removeQueries destroys the query, which cancels any
   * fetch in flight. The lists that counted the post, the idea that came back and the run log
   * whose rows lost their pointer are invalidated.
   */
  export function useDeletePost(id: number) {
    const inv = useInvalidate();
    const qc = useQueryClient();
    const navigate = useNavigate();
    return useMutation({
      mutationFn: () => api.del<void>(`/posts/${id}`),
      onSuccess: () => {
        navigate('/posts');
        qc.removeQueries({ queryKey: ['post', id] });
        void inv(['posts'], ['ideas'], ['planner'], ['dashboard'], ['runs']);
      },
    });
  }
  ```
  No `await` before `removeQueries`: the three calls run in one tick so no render slips between navigate and eviction. `Query.destroy()` calls `this.cancel({ silent: true })` (verified in `node_modules/@tanstack/query-core/build/modern/query.js:86-88`), so no separate `cancelQueries` is needed.
  `['posts']` does not prefix-match `['post', id]`, so the list invalidation alone does not cover this. Nothing else keyed on the post refetches on its own: `['images', id]`, `['runs','post',id]` and `['post-analytics', id]` are neither invalidated here nor polled unconditionally.
  and `DeletePost({ post: PostDto; busy: boolean })`, rendered only by the Workspace and only when `post.status !== 'measured'`.

**Work:** `DeletePost` renders, at rest, one `Button variant="subtle"` reading `delete post`, `disabled={busy || del.isPending}`, `title="a run is in flight"` while `busy` (the band's `title={dirty ? 'save the body first' : ''}` is the precedent for a disabled reason). Clicking it enters `confirming`: the trigger is replaced by a `basis-full` block, which wraps onto its own line inside the band's `flex flex-wrap` row without a second mount point, holding the sentence in `text-[13px] text-soft` and two buttons in D3's order, `delete for good` as `Button variant="ghost"` and `keep` as `Button variant="subtle"`. The sentence is D3's, verbatim, chosen on `post.publishedAt`: the published variant with `fmtDateTime(post.publishedAt)` where the spec writes `<date>`, the unpublished one otherwise. `keep` returns to rest and sends nothing. `delete for good` calls `del.mutate()` once (the hook navigates); while `del.isPending` both buttons are disabled and the destructive one reads `deleting…` (the `saving…` precedent at `Workspace.tsx:214`). On error the block stays open and shows `ErrorNote` with label `delete failed` and the server message, which is how D2's and D4's 409 sentences reach the operator. No modal, no new colour, no icon, no red: the two existing button variants and the sentence carry it, which is what keeps it clear of the design-tells hook without an opt-out marker.

Placement: last in the band's row, after the copy button, on every non-measured status. A measured post gets no affordance for a refusal the app already knows about.

`delete-post.spec.tsx`: render inside `renderWithClient` with a `MemoryRouter` at `/posts/5` and two routes, `/posts/:id` mounting `DeletePost` and `/posts` mounting a probe `<div>posts index</div>`, so navigation is observable without touching `render.tsx`. Cases: **assert each sentence whole, not in fragments.** Build the expected string from D3's copy with `fmtDateTime(publishedAt)` substituted for `<date>`, normalise whitespace on the rendered text, and compare the two. Fragment matching is what lets the approved copy ship with half of it missing, and the missing halves are the substantive ones: that LinkedIn is unaffected, that the goal and streak are recounted, that the runs stay and the idea returns. A post with `publishedAt: '2026-09-01T12:00:00.000Z'` renders the published sentence in full after the first click; a post with `publishedAt: null` renders the unpublished sentence in full; `keep` after the first click: `api.del` not called and `delete post` is back; `delete for good` with `vi.spyOn(api, 'del').mockResolvedValue(undefined)`: called once with `/posts/5`, then `posts index` renders; `api.del` rejecting with `new Error('post 5 has run 9 in flight')`: the note reads it and the block stays.

One more case, for the eviction: seed the shared `QueryClient` with a `['post', 5]` entry, delete through `delete for good`, and assert `qc.getQueryData(['post', 5])` is `undefined` afterwards. Without it, a Back navigation repaints the deleted post as an editable Workspace from a thirty-minute cache, and the Workspace only shows its error branch when the post data is absent, so the stale copy wins. The `keep` case and this one are both absences: sabotage `keep` once by calling `mutate` from it, and sabotage this one by dropping `removeQueries`.

`Workspace.spec.tsx`: **the override cannot be the second parameter of `loaded`.** Lines 33 to 51 already define `detail(bodyLinkedin)` and `loaded(bodyLinkedin, ideas: IdeaDto[] = [])`, so `loaded`'s second slot is taken and a naive edit breaks its existing callers. Use `detail(bodyLinkedin, over: Partial<PostDto> = {})`, whose second slot is free, and `loaded(bodyLinkedin, ideas = [], over = {})`, passing it through. Note that `loadedWithSources` at line 133 bypasses `detail` entirely and overrides the detail key by hand, so it needs no change. Two cases in a new describe `Workspace — delete`: a `draft_ready` post renders a button named `delete post`; a `measured` post renders none. The measured case first awaits `screen.findByRole('button', { name: 'copy to clipboard' })` (rendered for measured at `Workspace.tsx:173-175`) and only then asserts `queryByRole('button', { name: 'delete post' })` is null; without the marker the absence passes during the loading skeleton. The absence is proved once by sabotage: drop the status guard in the Workspace and watch it fail.

**Acceptance check:** from `app/web`: `TZ=America/Sao_Paulo npx vitest run src/ui/delete-post.spec.tsx src/pages/Workspace.spec.tsx`. Red before: the new spec fails to import. Green after. Then `npm run lint -w web` (0 errors, 0 warnings, the standing bar) and `npm run typecheck` from `app/`.

**Boundaries:** no change to `client.ts`, `primitives.tsx` or `render.tsx`. No confirm on any other page: the posts index and the planner get no delete. `PostsIndex.tsx` is not touched. The band's other buttons and the error rows below it are not moved.

- [x] `useDeletePost`
- [x] `DeletePost` and its spec; sabotage `keep` once
- [x] Workspace wiring and the two cases; sabotage the measured case once
- [x] Lint, typecheck
- [x] Commit: `feat(web): a post is deleted from its workspace behind two clicks that say the cost`

---

### Task 7: Gates, live migration, live delete, PR

**Files:**
- `HANDOFF.md` — modify: the "Post deletion is designed, not built" paragraph near the end becomes the executed state, the way plan C's tail did
- the live database gains migration 0020; the live `uploads/inputs/` loses the directory of the post deleted below; nothing else is modified

**Interfaces:**
- Consumes: everything above; `route-smoke.mjs` as the headless smoke.

**Work:** From `app/`: `npm test` (all three workspaces), `npm run typecheck`, `npm run lint -w web`. The api and web dev servers are already running and are never started by an agent; if one is down, say so and stop.

Live migration, in this order and pasted into the PR: from `app/api`, `psql` (or a one-line `node -e` on the `postgres` driver against the live url) for `select count(*) from ideas where promoted_post_id is not null and promoted_post_id not in (select id from posts)` (expected `0`) and `select conname from pg_constraint where conrelid = 'post_inputs'::regclass and contype = 'f'` (expected one row, `post_inputs_post_id_fkey`; a `like 'post_inputs_post_id%'` form would also return `post_inputs_post_id_ref_unique` from `0019_post_inputs.sql:9`); then `npm run db:migrate` with `DATABASE_URL` unset, on purpose; then the second query again (expected one row, `post_inputs_post_id_posts_id_fk`). No restart is needed for the constraint change itself, and the api's watch mode has been recompiling the branch as it was written; if the running process predates the branch, say so and let Kevin restart it. An agent never starts a server.

Live delete, on a post made for it, never on #5, #1, #4 or #9. **Steps 3 and 4 exist in two versions, because Task 6 is separable and the browser controls do not exist without it.** Run the version that matches what shipped, and say in the PR which one was run.

1. `/backlog`: capture an idea `throwaway for the delete check`, promote it at T3 without triaging. Note the new post id `N`. On `/posts/N`, paste a short text input so `app/api/uploads/inputs/N/` exists (`ls` it).
2. Optional, costs one model call: `draft with claude` on `N` and wait for it to finish, so a run row exists to survive the delete. Kevin's call; say in the PR whether it was done.

*With Task 6 shipped:*

3. On `/posts/N`: `delete post`, read the unpublished sentence, `keep`: nothing happens and the button is back. `delete post`, `delete for good`: the page lands on `/posts` and `N` is not in the list.
4. `ls app/api/uploads/inputs` no longer lists `N`. `/backlog` shows the idea back at `new`. If step 2 ran, `/runs` shows the draft run with no post.

*API only, Tasks 1 to 5 without Task 6:*

3. `curl -i -X DELETE http://127.0.0.1:3001/api/posts/N` (`app/api/src/main.ts:12`) answers `204`-shaped 200 with an empty body. Repeat it once: the second call answers 404, which proves the row is gone rather than merely hidden.
4. Against the live database, in one `node -e` on the `postgres` driver, paste the output into the PR: zero rows in `posts`, `post_revisions`, `post_inputs` and `assets` for `N`; the idea that promoted it back at `new` with a null `promoted_post_id`; if step 2 ran, its run present with `post_id` null and its status still `succeeded`. Then `ls app/api/uploads/inputs` no longer lists `N`. `/backlog` in the browser shows the idea back in the list, which is the one user-visible consequence reachable without Task 6.
5. Only when Task 6 landed: `WEB_URL=http://localhost:5174 node scripts/route-smoke.mjs` from `app/api` (it mutates post #5's schedule and restores it, which is that record's purpose) loads every route with zero console errors. Without Task 6 the smoke still runs, as the regression check for the api-only PR.

`HANDOFF.md`: replace the "designed, not built" paragraph with the branch, the PR, the gate numbers, whether 0020 is applied live, whether Task 6 shipped, and the live post id that was deleted.

Push `feat/post-delete`, open the PR against `ai-staging`. The body carries: the manual rundown above as steps to repeat, what was verified and how, the migration output and the two queries before and after, the note that 0020 was applied live, whether Task 6 is in the PR, and the review instruction that both `reviewer` legs run at xhigh. Stop: the review is Kevin's to trigger.

**Acceptance check:** every command above exits 0 and its output is in the PR; the live steps are ticked in the PR body by the person who ran them; `git status --short` is empty.

**Boundaries:** no merge. No change to `ai-staging` directly. No post other than the throwaway is deleted. Post #5 is touched only by `route-smoke.mjs`, which restores it.

- [x] Tests, typecheck, lint
- [x] Queries, migrate live, queries again, api restart; outputs saved
- [x] The live delete on the throwaway post; route smoke
- [x] HANDOFF tail, push, open the PR, stop
