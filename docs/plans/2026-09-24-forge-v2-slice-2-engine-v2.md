# forge v2 slice 2: Engine v2, model registry, ledger, cli split. Implementation plan

**Goal:** Every model call runs through one `Engine` seam whose backend is chosen by the deployment, is priced from a model registry row, and lands its usage (with cache tokens) and its cost in a ledger row on every exit path; the CLI backend lives in its own workspace that the production api provably never imports; the staging service and the fences of ADRs 0015 and 0017 are gone.

**Architecture:** `EngineRequest` v2 carries system blocks with cache hints, a user turn, image references, the output schema, a timeout and the registry row's model, effort and output cap; `EngineResult` v2 carries the output, usage with cache fields, the provider request id and a retry hint. A `model_registry` table (one row per task and backend) replaces `engineForKind` and `settings.models`; a `ledger` table takes one row per model call and attempt. The runner resolves the row, picks the engine by the row's engine name from the installed map, renders the prompt for the audit, and writes the ledger row whatever the exit. `@forge/engine-cli` holds the `claude` and `codex` process engines; only `main.dev.ts` installs them, and a node-file-trace test over the production entry fails on any edge into that workspace. The `api` backend is two SDK engines, Anthropic and OpenAI, with retries off and one recorded retry.

**Spec:** `docs/superpowers/specs/2026-09-24-forge-v2-architecture.md` (slice 2 of the slice graph), ADRs 0019, 0026, 0027, the v2 amendments of 0003, 0015, 0016, 0017, and R12/R13 under `docs/research/`.

**Execution model:** opus

**Approved:** by Kevin on 2026-09-24, with narrowing 2 (Google deferred to slice 10) and narrowing 7 (every row, cli included, at list price) confirmed by name; narrowing 9 approved with the plan.

**Shape:** three parts, A then B then C, in five execution sessions, each ending at a green checkpoint (typecheck, lint, the api suite, the route smoke). Part A deletes staging and the fences. Part B is the seam, the registry, the ledger and the package split, and it needs the fence fields gone from the request shape first, which is why A precedes it; B runs as three sessions (B-i: B1 to B3; B-ii: B4 to B6; B-iii: B7 to B9). Part C adds the `api` engines on the seam B built and re-runs R12 on real tokens. `/clear` between sessions; `pickup` names the next task.

## Global constraints

- npm workspaces under `app/`; every command below runs from `app/` unless it says `app/api`. `npm run typecheck` from `app/` is its own gate (`noUncheckedIndexedAccess`).
- One api vitest process at a time. `npm test -w api` runs the whole api suite against `postgres://forge:forge@localhost:5433/forge_test`; a focused file runs as `cd app/api && npx vitest run test/<file>.spec.ts`. Never two at once.
- Migrations are hand-written SQL plus a journal entry (`version: "7"`, `when` greater than `1790259420309`, statements split by `--> statement-breakpoint`). Applied migrations are frozen. Expand then contract (ADR 0020): this slice adds and widens columns and drops nothing that a reader still reads.
- `@forge/shared` and, after B4, `@forge/engine-cli` load from `dist/`. `npm run typecheck` and `npm test -w api` rebuild them; a live check does not, so `npm run build -w @forge/shared -w @forge/engine-cli` and an api restart come first.
- Api-edge tests go through `createNestApplication` plus supertest. A test whose assertion is an absence is proved once by sabotage.
- `route-smoke.mjs` runs from `app/api` with `WEB_URL=http://localhost:5174`; its `<title>` guard is load-bearing. Post #5 is sacrificial; posts #1 and #4 and the settings row stay as they are. **Post #9 carries the four live Inputs and is not draftable from A1 until slice 9** (narrowing 4); every live draft in this plan runs on a scratch post (the procedure under "Vocabulary"). The dev server is already running and no agent starts one; `nest start --watch` recompiles on edit, and after B7 Kevin restarts it with the new `start:dev` entry.
- Slice 2 creates no table that needs a Tenant. The ledger is per Run. No Budget, no `signals`, no `voices`, no `failure_kind = budget`.
- Kevin's dev workflow keeps working after the split: `cli` drafts, triages, retros and generates images on his subscriptions; it refuses a draft on a Post with Inputs and has no research toggle until slice 9.
- The review wave for this plan was two Claude legs, `reviewer` on opus and `reviewer` on fable, consolidated into the fix pass recorded at the end. No codex leg; that quota is reserved.
- Invariant 6 (ADR 0026): every model call is an audited Run with its rendered prompt, its output, usage with cache tokens and cost, on every exit path. Invariant 9: `@forge/engine-cli` is absent from the api's production dependencies and from the file trace of the production entry. Invariant 1 on `cli`: `OPENAI_API_KEY` never reaches a codex child.
- `unslop` applies to every document this plan touches.

## Spec conflicts and narrowings

Read these before task 1; each is a call this plan makes where the spec, an ADR or the tree did not line up. None re-opens a ratified decision. Items 2 and 9 needed Kevin's explicit OK (given 2026-09-24) because they narrow something the S4 review added.

1. **`runs.engine` holds an engine name, and on `api` that name is the provider.** The spec says "`runs.engine` becomes a provider text column". The column becomes text. Its values are `claude` and `codex` for the cli engines (the 107 live rows and the run detail's codex-total rendering at `web/src/ui/run-detail.tsx:47` keep meaning what they mean) and `anthropic`, `openai`, `google` for the api engines, which are the providers.
2. **Google's SDK is not built in this slice. Kevin confirmed on 2026-09-24.** The spec lists "three provider SDKs" and the S4 review added Google (memo finding 11) because ADR 0019 names it "for the default image generator". Image generation on the registry is slice 10, no slice-2 task can call a Google engine, and an engine with no caller and no live probe is untested code. Part C ships Anthropic and OpenAI; slice 10 adds Google against the `ImageGenerator` interface it defines. If Kevin wants the Google text engine now, it is one more C-task shaped like C3. Until slice 10 ships its engine, `google` is not on `ENGINES_BY_BACKEND.api` and `ModelRowPatchSchema` refuses it; `EngineName` keeps the name (PR #28 fix pass).
3. **The envelope stays `oneOf` in shared; the api engines rewrite it.** ADR 0016 amended describes "an `anyOf` under a required property with a `const` tag per branch". The CLI has been proven on the nested `oneOf` (`scripts/probe-output-contract.mjs`); changing shared would re-open that probe for nothing the cli needs. So `enforcedJsonSchema` is unchanged and `toProviderSchema` (C1) rewrites `oneOf` to `anyOf` for the API. The decline branch already carries `outcome: "declined"` as a `const`; the payload branches gain no tag because `unwrapResult` parses the decline branch first and no payload has an `outcome` key. If the OpenAI strict grammar rejects an untagged `anyOf` at the C1 probe, the executor stops with `blocked:` and the tag goes in then, in `toProviderSchema` only.
4. **Inputs are unread between A1 and slice 9, and post #9 is the Post that has them.** Deleting staging removes the only path an Input had to the model. On `cli` that is the decision (ADR 0019); on `api` the inline path is slice 9 (ADR 0023). From A1 a draft, refine or selection refine on a Post with Inputs is refused at launch, on both backends, with a message that names slice 9. Post #9 carries all four live Inputs (two `path`, one `file`, one `url`, counted 2026-09-24); they stay attached, so #9 is not draftable until slice 9, and the live drafts this plan makes run on scratch posts. Attach, preview and remove keep working.
5. **`path` Inputs stop being attachable; the two live rows stay.** ADR 0017 amended kills the kind. The enum value and #9's two rows stay until slice 12 converts them; the walker goes now. Nobody detaches them to make #9 draftable, because a detached `path` cannot be re-attached.
6. **The recorded retry lives in the runner, not the engine.** ADR 0019 says forge makes one recorded retry for a 429 with `retry-after` or a 529. The api engine reports the condition on `EngineResult.retryable`; the runner sleeps, calls once more, and writes a ledger row per attempt. The same attempt loop wraps every engine call, in `execute` and in a managed run's `call`. This keeps "every attempt is a row" a runner fact that one test proves for every engine.
7. **Cost is stored, priced at list, and the read-time estimate dies.** Today every reader prices runs at read time from `settings.pricing`. The registry row prices the call and the cost is written on the ledger row, the step and the run. Every registry row, cli included, carries the provider's list price for its model (R12 and the claude-api reference, 2026-09-24), so a cli run's cost is what the same call costs on `api` for the same tokens. From C0 on, a cli call carries about 4k tokens of the CLI's own prompt (23k to 30k before C0), so its token count is not the api call's; cli costs are comparable only from run 135 on, and a cli cost from 0021 to run 134 is not comparable to anything (CLAUDE.md, PR #28 fix pass). The settings row's stale `pricing` (opus-4-8 at 15/75) is used once, for the backfill of historic runs, and then never read again. CLAUDE.md's "pricing is a display estimate, never billing truth" stays true.
8. **`failure_kind` does not gain `budget` here.** Nothing in this slice can produce it (no Budget until slice 3).
9. **Final 529 and 503 map to `quota`, not `nonzero_exit`.** ADR 0019's table sends "other 4xx and 5xx" to `nonzero_exit`; R13 sends a 529 to "retry then `quota`". Overload after the one retry is a capacity failure the operator reads the same way as a rate limit, so the engines map it to `quota`. Recorded in ADR 0019's implementation note (B9).
10. **Three fields of the spec's v2 shapes are not fields here.** The request's tool cap has no consumer: the cli fences are gone and the api engines expose no tools; slice 9's search cap is a forge-side count, not an engine field. The result's cost is not on `EngineResult`, because the engine does not know the price; it is on the ledger row the runner writes. Image output as bytes or a storage key is slice 10's `ImageGenerator`.
11. **`run_kind` gains nothing here.** `adapt`, `research_plan`, the judges and `edit_classify` belong to slices 5, 9, 6 and 6.
12. **Notes for later slices.** `model_registry`'s unique `(task, backend)` must relax when slice 10 wants two image generators on `api` (a `label` column, or the task becomes `image_gen:<generator>`). `numeric(12,6)` rounds a sub-microdollar call to 0; the token columns keep the truth. The seams slices 3, 8 and 10 move are listed in #24 under "Slice 2 seams" (from the PR #28 review).

## Assumptions

- The Anthropic and OpenAI SDK shapes below (client options `maxRetries`, `timeout`, `fetch`; `messages.stream` with `output_config.format = { type: 'json_schema', schema }`; usage fields `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`; `stop_reason: 'refusal'`; `APIConnectionTimeoutError` as a subclass of `APIConnectionError`; the Responses API `text.format` with `strict: true` and `usage.input_tokens_details.cached_tokens`) come from R13 and the claude-api reference, not from the installed packages, which are not installed yet. The compiler confirms names in C2 and C3; a name that differs is fixed in place and is not a plan defect.
- `nest start --entryFile main.dev` is a real flag (`npx nest start --help` lists `--entryFile`, checked 2026-09-24).
- List prices on 2026-09-24 per million tokens: Sonnet 5 2 / 10, Opus 4.8 5 / 25, Haiku 4.5 1 / 5 (claude-api model table); cache write 1.25x and cache read 0.1x the input price on all three (R13 item 4). The minimum cacheable prefix is 1024 tokens on Sonnet 5 and Opus 4.8, 4096 on Haiku 4.5; whether triage caches is measured in C5, not assumed.
- `ANTHROPIC_API_KEY` is available to Kevin for Part C. Parts A and B need no key.

## Vocabulary used across tasks

- **Backend**: `api` or `cli`, chosen by the process entry file, never by a request. `fake` is a test engine, not a backend.
- **Engine name**: `claude | codex | anthropic | openai | google | fake`. The registry row names the engine; the installed map is keyed by it.
- **Task**: the registry key a run kind and tier resolve to. The eight keys are today's `settings.models` keys: `draft_t1`, `draft_t2`, `draft_t3`, `triage`, `image_html`, `image_gen`, `image_review`, `retro`. `taskForKind(kind, tier)` is today's `modelKeyForKind` renamed.
- **Ledger row**: one model call, one attempt, with its usage, the call's exit and its cost.
- **Scratch post**: the live-check unit from A1 on. `POST /api/ideas { rawText, source: 'work' }`, then `POST /api/ideas/:id/promote { tier }` (the tier the check needs), which answers the post id. When the check is done and the run is terminal, `DELETE /api/posts/:id` (409 while a run is in flight), then `PATCH /api/ideas/:id { status: 'discarded' }`. Nothing else in the live database moves.

---

# Part A: staging and fences deleted (session 1)

Part A removes the harness snapshot, the fences, the tool audit, the Input walker and the research toggle. It changes no engine shape beyond dropping the fence fields. Tree green at the end of each task.

### Task A1: research staging, the fences and the tool audit are deleted from the api

**Files:**
- `app/api/src/research/`, delete the directory (`research-staging.service.ts`, `.spec.ts`, `research.module.ts`).
- `app/api/src/drafting/research-prompt.ts`, `research-prompt.spec.ts`, delete.
- `app/api/scripts/probe-research-tools.mjs`, `probe-inputs.mjs`, delete.
- `app/api/scripts/probe-output-contract.mjs`, modify: drop the `RESEARCH` argv set and calls 3 and 4 (they probe the fence); keep calls 1, 2 and 5 and the `PLAIN` argv; its imports lose `RESEARCH_DENY_SETTINGS` and `RESEARCH_TOOLS`.
- `app/shared/src/research.ts`, delete. Move `ToolCall` to `app/shared/src/runs.ts` and `StagedManifestEntry` to `app/shared/src/inputs.ts` (beside `InputManifest` and `StagedInput`, which already live there at `inputs.ts:55` and `:64`), each under a comment saying it describes the legacy columns `runs.tool_calls`, `runs.staged_manifest`, `runs.staged_inputs`, read-only from here and dropped in the contract migration of slice 12. Every `RESEARCH_*` constant goes; `STRUCTURED_OUTPUT_TOOL` stays in `contract.ts`.
- `app/shared/src/settings.ts`, modify: delete `ResearchSourceSchema`, `DEFAULT_RESEARCH_SOURCES`, `researchSources`. The stored key stays in the live row until the first `PATCH /settings` after this task, which re-persists the parsed row without it (`settings.service.ts:50-54`); nothing in this plan edits the row on purpose.
- `app/shared/src/contracts.spec.ts`, modify: drop the `research` import and every test of the `RESEARCH_*` constants and of `ResearchSourceSchema`.
- `app/shared/src/index.ts`, modify: drop the `research` export.
- `app/api/src/engines/engine.interface.ts`, modify: delete `maxToolCalls`, `settingsJson`, `toolAllowlist` from `EngineRequest` and `toolCalls` from `EngineResult`. Keep `cwd`, `env`, `allowedTools`, `images` for now (B4 reshapes the request).
- `app/api/src/engines/claude.engine.ts`, `claude.engine.spec.ts`, modify: delete `collectToolCalls`, `refOf`, `countToolUses`, the `endedResult` override, the `isolate` and `settings` argv groups; keep `--no-session-persistence`, the `--allowedTools` group, `--json-schema`, the stdin prompt, the env scrub (a local `CLI_SCRUBBED_ENV = ['OPENAI_API_KEY', 'DATABASE_URL']`). The spec keeps its output-contract and secrets tests and loses the tool-audit ones.
- `app/api/src/engines/process-engine.ts`, `process-engine.spec.ts`, `app/api/test/process-engine.spec.ts`, modify: delete the tool-call cap (`countToolUses`, `pending`, `toolUses`, `EngineEnded.kind = 'cap'`); `EngineEnded` becomes `{ kind: 'timeout'; detail }`; keep `endedResult`. The cap tests go; the timeout tests stay.
- `app/api/src/runner/runner.service.ts`, modify: delete `StagedFields`, the `stage` option, `research`, and the `maxToolCalls/settingsJson/toolAllowlist` fields from `execute`'s input (keep `cwd` and `allowedTools`); delete `recordToolCallsSafe` and the `realpath`/`path` imports.
- `app/api/src/runs/runs.service.ts`, modify: `start` drops `research`; delete `recordStaging` and `recordToolCalls`.
- `app/api/src/drafting/drafting.service.ts`, modify: delete `prepareFence`, `cleanupSafe`, `allowedToolsFor`, `READ_PATH_RULE`, the `staging` and `inputs.stageable` uses, `LaunchOptions` and its `research` flag; `launchDraft(postId)`, `launchRefine(postId, feedback)`, `launchRefineSelection(postId, { selectionStart, selectionEnd, instruction })`. Before `beginDrafting` in `launch`, and before the range check in `launchRefineSelection`, read `this.inputs.list(postId)` and throw `ConflictException(\`post ${postId} has ${n} inputs; a draft that reads inputs returns with slice 9 (input and research delivery)\`)` when `n > 0`. `tellFields` for draft become `['body_linkedin', 'hashtags[]', 'image_concept', 'sources[].note']` and for selection refine `['body_linkedin', 'sources[].note']`.
- `app/api/src/drafting/drafting.controller.ts`, modify: `DraftBodySchema = z.object({ research: z.literal(false).optional() }).default({})`; the same field on `RefineSchema` and `RefineSelectionSchema`. A stale tab sending `research: true` gets a 400 from `ZodBody` instead of a silent plain draft.
- `app/api/src/drafting/drafting.module.ts`, `app/api/src/app.module.ts`, modify: drop `ResearchModule`.
- `app/api/src/db/schema.ts`, modify: the `runs` columns `research`, `tool_calls`, `staged_manifest`, `staged_inputs`, `staged_dir` stay, with the comment changed to "legacy, written by no code path since slice 2; dropped in slice 12".
- `app/api/test/drafting.spec.ts`, modify: delete the `research runs` describe block, `ToolCallEngine`, `fixtureHome`, the `RESEARCH_HOME` override in `build`; add `a post with inputs is refused at launch, on draft, refine and selection refine` (attach one pasted text to a promoted idea's post, expect `ConflictException` with the message above from all three launchers, and no run row: `runs.list({ postId })` is empty); add, from the module `build()` returns, `mod.createNestApplication()` with `configureApp` and supertest, `POST /api/posts/:id/draft` with `{ research: true }` answers 400 and creates no run row.
- `app/api/test/refine-selection.spec.ts`, modify: delete the fixture home and the two research tests; the plain test stays.

**Interfaces:**
- Produces: `EngineRequest` without the three fence fields; `EngineResult` without `toolCalls`; `RunsService.start({ engine, kind, model, prompt, postId })`; `DraftingService.launchDraft(postId)`, `launchRefine(postId, feedback)`, `launchRefineSelection(postId, input)` without `research`.

**Work:** This is a deletion. Where a deleted piece was referenced, remove the reference; do not stub it. `inputs.service.ts` still exports `stageable()` after this task with no caller; A2 deletes it with the walker. The message for a refused Inputs launch is verbatim above; the http test and the web (A3) match on it.

**Acceptance check:** `cd app/api && npx vitest run test/drafting.spec.ts` red on the new refusal test before the service change (today a post with inputs launches a fenced draft), green after. `npm test -w shared`, `npm test -w api` green with the research and cap tests gone. `npm run typecheck` green.

**Boundaries:** No schema migration (columns stay). No change to `claude.engine.ts`'s `--allowedTools` behaviour, `--json-schema` or the stdin prompt. `url-article.ts`, `pdf-text.ts`, `input-walker.ts` untouched (A2 owns the walker).

- [x] Write the refusal test and the 400 test in drafting.spec, run red
- [x] Delete research/, research-prompt, the two probes, trim the contract probe, delete shared research.ts, move the two legacy types, drop `researchSources`, fix contracts.spec; rebuild shared
- [x] Strip the engines and the runner, then RunsService, then the drafting service and controller
- [x] Fix every compile error the deletion surfaces; `npm run typecheck`
- [x] Prune the specs listed above, `npm test -w shared`, `npm test -w api`, commit

**Executed with two pulls forward (2026-09-25).** A1 as written could not reach a green typecheck: `input-walker.ts` calls `ResearchStagingService.isDenied`, and the web's `SettingsPage` reads `researchSources`. So A1 also did A2's api half (the walker and its spec deleted, `produce` refuses `path` with `REFUSAL.pathRetired`, `stageable()` deleted, the `inputs.spec` test written and proved red against HEAD with `REFUSAL.harness`) and A3's `ResearchSourcesSection` removal. It also deleted `runner.spec`'s staging describe, `FakeEngine`'s canned `toolCalls`, and `assembleConstitution`'s `extraSection`, whose only caller was the fence. A2 and A3 keep the rest of their lists.

### Task A2: a path is no longer an Input; the walker goes

**Files:**
- `app/shared/src/inputs.ts`, modify: add `ATTACHABLE_INPUT_KINDS = ['file', 'url'] as const`; keep `INPUT_KINDS` with `path` (the enum and two live rows depend on it); delete `RUN_INPUT_CAPS`; keep `InputManifest.skipped` and `.refused` (a persisted shape); delete the walker-only `REFUSAL` entries (`relative`, `home`, `root`, `harness`, `hidden`, `denied`, `systemRoot`, `systemTree`, `resolvesTo`, `missing`, `symlink`, `overFiles`, `tooManyToCount`, `runOverFiles`, `runOverBytes`, `storedMissing`); add `REFUSAL.pathRetired = 'a path on this machine cannot be an input any more; drop the file or paste its text'`.
- `app/shared/src/inputs.spec.ts`, `contracts.spec.ts`, modify: drop tests of deleted refusals and of `RUN_INPUT_CAPS`; keep `inferInputKind('/x') === 'path'` (the refusal depends on it).
- `app/api/src/inputs/input-walker.ts`, `input-walker.spec.ts`, delete.
- `app/api/src/inputs/inputs.service.ts`, modify: `produce` returns `{ ok: false, refused: REFUSAL.pathRetired }` for kind `path`; delete `stageable()` and `StageableInput`; drop the walker import.
- `app/api/test/inputs.spec.ts`, modify: the two `path` tests become one: a `~/.claude` submission previews as 200 with `REFUSAL.pathRetired` and attaches as a 422 with it.
- `app/web/src/ui/inputs-panel.tsx`, `inputs-panel.spec.tsx`, modify: the pending label map loses `path: 'walking'`; the input's `aria-label` and placeholder read "a link, or paste some text"; a stored row of kind `path` still renders its pill (read-only; slice 12 converts it).
- `CLAUDE.md`, modify: delete the two walker traps ("This volume is case-insensitive APFS… keep all three" and "`ResearchStagingService`'s `home` is `RESEARCH_HOME`…").

**Interfaces:**
- Produces: `REFUSAL.pathRetired: string`, `ATTACHABLE_INPUT_KINDS`.

**Work:** A `path` submission is refused by the producer, so preview answers 200 with the refusal and attach answers 422, the way every other refusal already does. Internal structure is yours.

**Acceptance check:** `cd app/api && npx vitest run test/inputs.spec.ts` red on the new refusal test before the change (a `~/.claude` submission walks today and is refused with `REFUSAL.harness`), green after. `npm test -w shared`, `npm run typecheck`, `npm test -w web` green.

**Boundaries:** Do not touch `post_inputs` rows, the `input_kind` enum or `runs`. Do not delete `pdf-text.ts` or `url-article.ts` (slice 9 reuses both).

- [x] Write the failing inputs.spec test, run it, see `REFUSAL.harness` come back (done in A1, see its note)
- [x] Edit shared inputs.ts, delete the walker, edit the service, `npm run build -w @forge/shared` (walker and service in A1; shared here)
- [x] Focused spec green, then the web panel edit and its spec
- [x] `npm run typecheck`, `npm run lint -w web`, commit

### Task A3: the research toggle and the research sources panel leave the web

**Files:**
- `app/web/src/pages/Workspace.tsx`, `Workspace.spec.tsx`, modify: delete `ResearchToggle`, the `research` state and both pills; `launchDraft` and refine send no `research` field; confirm the draft and refine mutations are among `firstMutationError(...)`'s arguments so the 409 from A1 renders in the shared `ErrorNote`, and add them if not.
- `app/web/src/ui/selection-refine.tsx`, `selection-refine.spec.tsx`, modify: delete the research checkbox and state; the mutation sends no `research`.
- `app/web/src/api/hooks.ts`, modify: `useDraft` mutates with `{}`; `useRefine` with `{ feedback }`; `useRefineSelection` without `research`.
- `app/web/src/pages/SettingsPage.tsx`, `SettingsPage.spec.tsx`, modify: delete `ResearchSourcesSection` and its render (the `SettingsDto` lost `researchSources` in A1).
- `app/web/src/api/client.ts`, modify: the `RunDetailDto` comment on `research`, `toolCalls`, `stagedManifest`, `stagedInputs`, `stagedDir` says they are legacy columns rendered read-only for runs made before slice 2.
- `app/web/src/ui/run-detail.tsx`, no change (legacy runs keep their audit on screen; the `RunDetail — research runs` spec stays as is).

**Work:** Removal. The Workspace test that launches a draft asserts the POST body is `{}`; the selection refine test asserts its body has no `research` key. Add one Workspace test: a 409 from `POST /posts/:id/draft` whose message names inputs renders in the page's error note (mock the fetch, assert the text "returns with slice 9" is on screen).

**Acceptance check:** `npm test -w web` green; `npm run lint -w web` at 0/0; `npm run typecheck` green; from `app/api`: `WEB_URL=http://localhost:5174 node scripts/route-smoke.mjs` prints `ok` for every route including `/settings` and `/posts/5`, with zero console errors, and the `<title>` guard passes.

**Boundaries:** No visual redesign. Nothing under `app/api` in this task.

- [x] Write the two body assertions and the 409 rendering test, run red (the 409 test passed from the start: draft and refine were already in `firstMutationError`)
- [x] Remove the toggles, the checkbox, the hooks' field and the settings panel (the settings panel went in A1; `ToggleButton` lost its last caller and went too)
- [x] Web tests, lint, typecheck, route smoke, commit

### Task A4: the glossary and the traps say what is gone

**Files:**
- `CONTEXT.md`, modify: move **Fenced run**, **Research run**, **Staged root**, **Tool call** and the v1 **Input**'s `path` clause into the existing "Retired language" section (`CONTEXT.md:299`) with one line each ("replaced by ADR 0023's managed Research run in slice 9; the columns are read-only until slice 12"). The v2 **Input** entry stands.
- `CLAUDE.md`, modify: the Records trap "A research draft that cites nothing…" becomes "A draft that returns `sources: []` clears a hand-curated list, so a live check that adds a Source by hand runs after the draft." The trap "Post #9 takes live drafts" becomes "Post #9 holds the four live Inputs and is not draftable until slice 9; a live draft runs on a scratch post (idea, promote, run, delete the post, discard the idea)."
- `docs/manual-testing-guide.md`, modify only the steps that click the research toggle or paste a path; delete them.

**Acceptance check:** `grep -rn "Fenced run\|Staged root\|research toggle\|RESEARCH_HOME" CONTEXT.md CLAUDE.md docs/manual-testing-guide.md` returns only lines under "Retired language". `unslop` applied to every edited paragraph.

**Boundaries:** ADRs 0015 and 0017 are already amended; do not edit them.

- [x] Edit the three documents, grep, commit (the manual-testing guide had no research-toggle or path step, so it is unchanged; the v1 **Input** entry also lost its claims that Runs read Inputs)
- [x] Session boundary: recommend `/clear`, then `pickup` on B1 (HANDOFF.md written 2026-09-25)

---

# Part B: engine seam v2, model registry, ledger, `@forge/engine-cli`

Part B changes the request and result shapes, moves the process engines out, and makes usage and cost land on every exit path. Three sessions, each ending green:

- **B-i (B1 to B3)**: shared types, the migration applied live, the registry and ledger services. Additive; typecheck green after every task; the dev api keeps working.
- **B-ii (B4 to B6)**: the cli workspace, the runner, the callers. `npm run typecheck` is red during B4 only (the engines take the v2 request, the runner still sends the v1 one); B5 closes it with a one-task compatibility field that B6 removes. The api suite stays green throughout because every api spec substitutes fakes for the engines, and the fakes read `req.kind` only. The live cli path is down during B4; do not pause there.
- **B-iii (B7 to B9)**: entry files and the trace test, the web, the readers and the documents.

B1 is additive: `RunEngineName`, `engineForKind`, `modelKeyForKind`, `settings.models`, `settings.pricing` and `pricing.ts` are deleted by the task that removes their last reader (B5 for the two helpers, B9 for the rest).

### Task B1: shared types for Engine v2 and the registry

**Files:**
- `app/shared/src/engine.ts`, create: the v2 seam types and `renderPrompt`.
- `app/shared/src/registry.ts`, create: `TASK_KEYS`, `TaskKey`, `taskForKind`, `ModelPrices`, `costUsd`, `ModelRowPatchSchema`. `EngineBackend` and `EngineName` are defined once, in `engine.ts`; `registry.ts` imports them.
- `app/shared/src/registry.spec.ts`, create: `taskForKind` table, `costUsd` vectors, `renderPrompt`.
- `app/shared/src/index.ts`, modify: export `engine` and `registry`.
- `app/shared/src/runs.ts`, `settings.ts`, `contract.ts`, `pricing.ts`, no change in this task.

**Interfaces (verbatim, load-bearing; every later task imports these names):**

```ts
// engine.ts
export type EngineBackend = 'api' | 'cli';
export type EngineName = 'claude' | 'codex' | 'anthropic' | 'openai' | 'google' | 'fake';
/** One system block. `cache: true` puts a cache breakpoint after it (api engines); cli ignores it. */
export interface SystemBlock { text: string; cache?: boolean }
export interface EngineRequest {
  kind: RunKind;
  model: string;
  /** From the registry row. Null means "send no effort". Ignored by cli. */
  effort: string | null;
  /** From the registry row. Anthropic max_tokens, OpenAI max_output_tokens. Ignored by cli. */
  maxOutputTokens: number;
  system: SystemBlock[];
  user: string;
  /** Absolute paths in slice 2 (storage keys from slice 7). cli claude: Read is allowed and the prompt
   *  already lists them; cli codex: `-i=`; api: refused until slice 10. Never base64 in prompt text. */
  images?: string[];
  outputSchema?: OutputJsonSchema;
  timeoutMs: number;
  /** cli only: the codex image steps write files here. Api engines ignore it. */
  cwd?: string;
}
export interface EngineUsage {
  inputTokens?: number;        // uncached input
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  /** Set by the runner, not the engine: an engine reports tokens, the runner knows what an image
   *  call produced (B5). */
  images?: number;
}
export interface EngineResult {
  output: string;
  structured?: unknown;
  failureKind?: FailureKind;
  errorDetail?: string;
  /** Whatever the provider reported, on every exit path, including a timeout that arrived after
   *  message_start and a cli result line that carries is_error. Absent means the provider reported
   *  nothing, never zero. */
  usage?: EngineUsage;
  providerRequestId?: string;
  /** Set by an api engine on a 429 with retry-after or a 529/503. The runner retries once. */
  retryable?: { afterMs: number };
}
export type EngineEvent = { type: 'chunk' | 'stderr'; data: string };
export interface Engine {
  readonly name: EngineName;
  run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult>;
}
/** The audit text (runs.prompt) and the cli stdin: system texts then the user turn, joined by one
 *  blank line. Byte-identical to the pre-slice prompt strings for every builder (B6 proves it). */
export function renderPrompt(req: Pick<EngineRequest, 'system' | 'user'>): string {
  return [...req.system.map((b) => b.text), req.user].join('\n\n');
}
```

```ts
// registry.ts
export const TASK_KEYS = ['draft_t1', 'draft_t2', 'draft_t3', 'triage', 'image_html', 'image_gen', 'image_review', 'retro'] as const;
export type TaskKey = typeof TASK_KEYS[number];
/** Today's modelKeyForKind, unchanged in behaviour. */
export function taskForKind(kind: RunKind, tier?: PostTier): TaskKey;
export interface ModelPrices {
  inputPerMtok: number; cacheWritePerMtok: number; cacheReadPerMtok: number; outputPerMtok: number; imagePerUnit: number;
}
/** Null when every count is undefined. Otherwise the sum below, in USD. */
export function costUsd(u: EngineUsage, p: ModelPrices): number | null;
//   (inputTokens ?? 0) / 1e6 * inputPerMtok
// + (cacheWriteTokens ?? 0) / 1e6 * cacheWritePerMtok
// + (cacheReadTokens ?? 0) / 1e6 * cacheReadPerMtok
// + (outputTokens ?? 0) / 1e6 * outputPerMtok
// + (images ?? 0) * imagePerUnit
export const ENGINES_BY_BACKEND: Record<EngineBackend, readonly EngineName[]> = {
  cli: ['claude', 'codex'], api: ['anthropic', 'openai'],
};
export const ModelRowPatchSchema = z.object({
  engine: z.enum(['claude', 'codex', 'anthropic', 'openai']).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).nullable().optional(),
  maxOutputTokens: z.number().int().min(256).max(128_000).optional(),
  inputPerMtok: z.number().nonnegative().max(999_999).optional(),
  cacheWritePerMtok: z.number().nonnegative().max(999_999).optional(),
  cacheReadPerMtok: z.number().nonnegative().max(999_999).optional(),
  outputPerMtok: z.number().nonnegative().max(999_999).optional(),
  imagePerUnit: z.number().nonnegative().max(999_999).optional(),
}).strict();
```

Amended in the PR #28 fix pass: google leaves the offer until slice 10 (narrowing 2); a price fits `numeric(12,6)`.

**Work:** The `costUsd` spec carries this vector, computed by hand: Sonnet 5 prices 2 / 2.5 / 0.2 / 10, usage 10,000 in, 0 cache write, 40,000 cache read, 1,000 out gives 0.02 + 0 + 0.008 + 0.01 = **0.038**. A second vector with only `images: 2` at 0.067 gives 0.134. A third with every count undefined gives null. A fourth with `outputTokens: 33_538` at output price 0 and `images: 1` at 0.25 gives 0.25 (the codex session total prices at nothing; the image does). `renderPrompt` with `system: [{text:'a'},{text:'b'}], user: 'c'` gives `'a\n\nb\n\nc'`. `taskForKind` keeps every mapping `modelKeyForKind` had (`refine_selection` follows the tier, `image_hybrid | image_plan | image_variate` go to `image_html`, `image_refine` goes to `image_gen`).

**Acceptance check:** `npm test -w shared` green with the new specs; `npm run typecheck` green (the task is additive).

**Boundaries:** No api or web edits. No change to `contract.ts` (narrowing 3). Delete nothing.

- [x] Write registry.spec and the renderPrompt test, run red
- [x] Create engine.ts and registry.ts, export them
- [x] `npm test -w shared` green, `npm run typecheck` green, commit

### Task B2: migration 0021, schema, the backfill, applied live

**Files:**
- `app/api/src/db/migrations/0021_engine_v2_registry_ledger.sql`, create.
- `app/api/src/db/migrations/meta/_journal.json`, modify: entry `idx: 21`, `version: "7"`, `when: Date.now()` at authoring (greater than `1790259420309`), `tag: "0021_engine_v2_registry_ledger"`, `breakpoints: true`.
- `app/api/src/db/schema.ts`, modify: `runs.engine` and `runSteps.engine` become `text('engine').notNull()`; delete the `runEngine` pgEnum; `runs` gains `tokensCacheWrite`, `tokensCacheRead` (integer) and `costUsd` (`numeric('cost_usd', { precision: 12, scale: 6 })`); `runSteps` gains the same three; new tables `modelRegistry` and `ledger`.
- `app/api/src/analytics/analytics.service.ts`, modify: `PostDetailRun.engine: string` (the column is text now; the cost change to this file is B9's).
- `app/api/test/schema.spec.ts`, modify: the `engine: 'claude'` insert stays; add assertions that `runs.engine` is `text`, that `run_engine` no longer exists in `pg_type`, and that `model_registry` has 8 `cli` rows and 5 `api` rows after a fresh migration.
- `app/api/test/backfill-0021.spec.ts`, create: stands up the schema through `0020_post_delete` with `migrateUpTo` on a scratch database (`recreateDatabase`, the `style-docs-migration.spec.ts` pattern), inserts a settings row whose `pricing.perModel['claude-sonnet-5'] = { inputPerMTok: 3, outputPerMTok: 15 }` and `imagePerUnit: 0.25`, and whose `models.draft_t3 = 'claude-haiku-4-5'` (a non-default value, so the seed provably reads the row), one single-call run (sonnet, 1,000,000 in / 100,000 out), one managed run with two steps (a claude step 500,000 in / 0 out and a codex step with `images_generated = 2`), then applies 0021 and asserts: single run `cost_usd = 3 + 1.5 = 4.5`; step 1 `cost_usd = 1.5`; step 2 `cost_usd = 0.5`; managed run `cost_usd = 2.0` (sum of steps, not its own totals); the `cli` registry row for `draft_t3` has `model = 'claude-haiku-4-5'` with list prices `1 / 1.25 / 0.1 / 5` (not the settings row's 3 / 15).
- `app/api/test/migrations-fresh.spec.ts`, no change; it must stay green (the chain applies on an empty database with no settings row).

**Interfaces:**
- Produces the tables below and the widened columns. Column names are the contract every later task reads.

**Work.** The SQL, in this order, one statement per breakpoint:

1. `model_registry`:
```sql
CREATE TABLE "model_registry" (
  "id" serial PRIMARY KEY,
  "task" text NOT NULL,
  "backend" text NOT NULL,
  "engine" text NOT NULL,
  "model" text NOT NULL,
  "effort" text,
  "max_output_tokens" integer NOT NULL DEFAULT 8192,
  "input_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "cache_write_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "cache_read_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "output_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "image_per_unit" numeric(12,6) NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "model_registry_task_backend_uq" UNIQUE ("task", "backend"),
  CONSTRAINT "model_registry_backend_ck" CHECK ("backend" IN ('api', 'cli'))
);
```
2. `ledger`:
```sql
CREATE TABLE "ledger" (
  "id" serial PRIMARY KEY,
  "run_id" integer REFERENCES "runs"("id") ON DELETE SET NULL,
  "step_seq" integer,
  "attempt" integer NOT NULL DEFAULT 1,
  "backend" text NOT NULL,
  "engine" text NOT NULL,
  "model" text NOT NULL,
  "category" text NOT NULL,
  "exit" text NOT NULL,
  "tokens_input" integer,
  "tokens_cache_write" integer,
  "tokens_cache_read" integer,
  "tokens_output" integer,
  "images" integer,
  "cost_usd" numeric(12,6),
  "provider_request_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "ledger_run_idx" ON "ledger" ("run_id");
```
`category` is `text` or `image` (`platform` and `compliance` arrive in slice 8). `exit` is the engine call's outcome: `succeeded` or the failure kind the engine returned; a run that fails after a successful call (finalize threw) has a `succeeded` ledger row and a failed run row. `run_id` is `SET NULL` because the ledger row is the accounting record that outlives the Run (ADR 0026).
3. `runs` and `run_steps`: `ALTER TABLE "runs" ALTER COLUMN "engine" TYPE text USING "engine"::text;` the same on `run_steps`; `DROP TYPE "run_engine";` (nothing reads the type once both columns are text); `ADD COLUMN "tokens_cache_write" integer, ADD COLUMN "tokens_cache_read" integer, ADD COLUMN "cost_usd" numeric(12,6)` on both tables.
4. Cost backfill from the settings row's `pricing`, the read-time rule made permanent for the rows that predate the ledger: a step or a single-call run is priceable when its model has a `perModel` rate and it has any token count, or when `images_generated` is not null; its cost is `tokens_input / 1e6 * inputPerMTok + tokens_output / 1e6 * outputPerMTok + images_generated * imagePerUnit` with nulls as 0; a run that has steps takes the sum of its steps' costs and not its own totals. When no settings row exists (a fresh database) nothing is priced and every `cost_usd` stays null. This is the one and only read of `settings.pricing` after this slice.
5. Registry seed. The eight `cli` rows take their `model` from the settings row's `models` map, with today's `DEFAULT_SETTINGS.models` value when the row or the key is missing (opus-4-8 for draft_t1, draft_t2, image_html, image_review, retro; sonnet-5 for draft_t3 and triage; gpt-image-2 for image_gen). `engine` is `codex` for `image_gen` and `claude` otherwise. Prices are list prices by model, the same table for cli and api rows: `claude-opus-4-8` 5 / 6.25 / 0.5 / 25, `claude-sonnet-5` 2 / 2.5 / 0.2 / 10, `claude-haiku-4-5` 1 / 1.25 / 0.1 / 5, any other model 0 / 0 / 0 / 0 (a `CASE` on the model in the seed SQL); `image_per_unit` is 0.25 on `image_gen` (R12: unmeasured until slice 10) and 0 elsewhere. `max_output_tokens` 16384 for the three draft rows, 8192 otherwise. The five `api` rows are fixed:

| task | engine | model | effort | max_output_tokens | in | cache write | cache read | out |
|---|---|---|---|---|---|---|---|---|
| draft_t1 | anthropic | claude-sonnet-5 | high | 16384 | 2 | 2.5 | 0.2 | 10 |
| draft_t2 | anthropic | claude-sonnet-5 | high | 16384 | 2 | 2.5 | 0.2 | 10 |
| draft_t3 | anthropic | claude-sonnet-5 | medium | 16384 | 2 | 2.5 | 0.2 | 10 |
| triage | anthropic | claude-haiku-4-5 | (null) | 2048 | 1 | 1.25 | 0.1 | 5 |
| retro | anthropic | claude-sonnet-5 | high | 16384 | 2 | 2.5 | 0.2 | 10 |

No `api` row for `image_html`, `image_gen` or `image_review` (slice 10). Sonnet 5 for every tier is the brief's working default (decision 6); the eval slice may change the rows, which is why they are rows. Haiku takes no `effort` (the parameter errors on it).

Write the migration by hand. `numeric` columns come back from drizzle as strings; every reader converts with `Number()` at the service or DTO edge (B3, B5, B9), and the spec compares with `toBeCloseTo`.

**Acceptance check:** `cd app/api && npx vitest run test/backfill-0021.spec.ts test/schema.spec.ts test/migrations-fresh.spec.ts` red before the migration exists, green after. `npm test -w api` and `npm run typecheck` green. Then the live migration, from `app/api` with `DATABASE_URL` unset: `npm run db:migrate`, then `psql postgres://forge:forge@localhost:5433/forge -Atc "select backend, count(*) from model_registry group by 1"` prints `api|5` and `cli|8`, and `select count(*) from runs where cost_usd is not null` prints at least 29 (the runs with usage on 2026-09-24). The live migration runs here, not later, because from this task the drizzle schema of `runs` lists the new columns and every `db.select().from(runs)` (`runs.service.ts:114,120,133`) would 500 against the old live table. Then `WEB_URL=http://localhost:5174 node scripts/route-smoke.mjs` all `ok` against the running dev api (it recompiled on the schema edit).

**Boundaries:** No edit to any earlier migration. No `DROP COLUMN` anywhere. The settings row is read, never written. Do not touch `posts`, `ideas` or the fact tables.

- [x] Write backfill-0021.spec and the schema.spec additions, run red
- [x] Write the SQL and the journal entry; edit schema.ts and the analytics type
- [x] The three specs green, `npm test -w api`, `npm run typecheck`
- [x] `npm run db:migrate` live, the two psql checks, the route smoke, commit

**Executed 2026-09-25.** Live: `api|5`, `cli|8`, 32 runs priced. Typecheck surfaced one reader beyond the file list: `RunDetailDto` intersected the row's new `costUsd` (a numeric string) with its read-time `costUsd: number | null`; the DTO now omits the row's field and the estimate still wins until B9 replaces that reader. The live database was dumped to the session scratchpad before the migration.

### Task B3: the registry and the ledger as services

**Files:**
- `app/api/src/registry/model-registry.service.ts`, create: `list(): Promise<ModelRow[]>`, `resolve(task: TaskKey, backend: EngineBackend): Promise<ModelRow | null>`, `patch(id: number, patch: ModelRowPatch): Promise<ModelRow>` (404 when missing; 422 when `patch.engine` is not in `ENGINES_BY_BACKEND[row.backend]`).
- `app/api/src/registry/model-registry.controller.ts`, create: `GET /registry` (rows ordered by backend then task), `PATCH /registry/:id` with `ZodBody(ModelRowPatchSchema)`.
- `app/api/src/registry/model-registry.module.ts`, create; `app/api/src/app.module.ts`, modify to import it.
- `app/api/src/ledger/ledger.service.ts`, `ledger.module.ts`, create: `record(row: LedgerInsert): Promise<void>` (fail-open: log and swallow, a bookkeeping write never fails the run it describes), `forRun(runId): Promise<LedgerRow[]>` ordered by id, numbers converted.
- `app/api/test/registry-http.spec.ts`, create: through `createNestApplication` plus supertest, `GET /api/registry` lists 13 rows; `PATCH /api/registry/:id` with `{ model: 'claude-opus-5-5', inputPerMtok: 4 }` updates one row and answers the row with numbers, not strings; `{ engine: 'openai' }` on an `api` row answers 200 and on a `cli` row answers 422; `{ task: 'x' }` answers 400 (strict); a negative price answers 400; an unknown id answers 404. The spec restores every row it patched.

**Interfaces:**
- Produces: `ModelRow = { id, task, backend, engine, model, effort, maxOutputTokens, prices: ModelPrices, updatedAt }` (numbers, converted at the service edge from drizzle's numeric strings); `LedgerInsert = { runId, stepSeq?, attempt, backend, engine, model, category: 'text' | 'image', exit: 'succeeded' | FailureKind, usage: EngineUsage, costUsd: number | null, providerRequestId? }`.

**Work:** The registry service reads on every call; no cache (a run takes seconds and a row edit must take effect on the next run). `engine` is patchable within the row's backend so that a probe or the eval slice can point an `api` task at another provider without a migration; `task` and `backend` are not. `ledger.record` converts `costUsd` to a string for the numeric column. The controller returns the same `ModelRow` shape the web reads in B8.

**Acceptance check:** `cd app/api && npx vitest run test/registry-http.spec.ts` red before the controller exists (404 on the route), green after. Sabotage once: remove `.strict()` from the PATCH schema, watch the `{ task: 'x' }` 400 assertion go red, restore. `npm run typecheck` green.

**Boundaries:** No runner edits. No engine edits. No web.

- [x] Write registry-http.spec, run red
- [x] Services, controller, modules; run green; sabotage the strict check once; commit (also `test/ledger.spec.ts`, beyond the file list: attempt rows, number conversion, and the fail-open swallow, proved by sabotage)
- [x] Session boundary: green checkpoint (typecheck, api suite, smoke); recommend `/clear`, then `pickup` on B4 (checkpoint 2026-09-25: typecheck 0, lint 0, api 74 files / 434 tests, shared 130, smoke PASS; Kevin asked to continue in the same session, so B-ii follows here)

### Task B4: `@forge/engine-cli` holds the process engines

**Files:**
- `app/engine-cli/package.json`, create: name `@forge/engine-cli`, `main: dist/index.js`, `types: dist/index.d.ts`, scripts `build` (`tsc -p tsconfig.build.json`), `prepare`, `test` (`vitest run`), `typecheck`; dependency `@forge/shared: "*"`; devDependencies `typescript`, `vitest`, `@types/node`.
- `app/engine-cli/tsconfig.json`, `tsconfig.build.json`, create, mirroring `app/shared`'s two files.
- `app/engine-cli/src/index.ts`, create: exports `ClaudeEngine`, `CodexEngine`, `ProcessEngine`, `cliEngines(): { claude: ClaudeEngine; codex: CodexEngine }`.
- `app/engine-cli/src/process-engine.ts`, `claude.engine.ts`, `codex.engine.ts`, create by `git mv` from `app/api/src/engines/` and adapting to `EngineRequest` v2 from `@forge/shared`.
- `app/engine-cli/src/claude.engine.spec.ts`, `process-engine.spec.ts`, `cli-engines.spec.ts`, create by moving `app/api/src/engines/claude.engine.spec.ts`, `app/api/src/engines/process-engine.spec.ts`, `app/api/test/process-engine.spec.ts` and `app/api/test/cli-engines.spec.ts`; the stubs `app/api/test/fixtures/stub-{claude,codex,fail,ok,slow}.mjs` move to `app/engine-cli/test/fixtures/`; `stub-codex-images.mjs` and `stub-codex-symlink.mjs` stay in the api (`test/image-gen.spec.ts:24` and the symlink test use them) and are copied if an engine-cli spec also needs one.
- `app/engine-cli/vitest.config.ts`, create: plain vitest, no database, `include: ['src/**/*.spec.ts']`.
- `app/api/test/image-gen.spec.ts`, modify: `import { CodexEngine } from '@forge/engine-cli'` (line 20 imports the moved file).
- `app/api/src/engines/engine.interface.ts`, modify: re-export the seam types from `@forge/shared`; keep the `ENGINES` token and add `ENGINE_BACKEND = Symbol('ENGINE_BACKEND')`.
- `app/api/src/engines/installed.ts`, create: the process-wide registration the entry files call before Nest boots:
```ts
export interface Installed { backend: EngineBackend; engines: Partial<Record<EngineName, Engine>> }
let installed: Installed | undefined;
export function installEngines(next: Installed): void { installed = next; }
export function installedEngines(): Installed { return installed ?? { backend: 'cli', engines: {} }; }
```
- `app/api/src/engines/engines.module.ts`, modify: provides `ENGINES` (`installedEngines().engines`) and `ENGINE_BACKEND` (`installedEngines().backend`), both by factory, so a spec that overrides `ENGINES` with `{ claude, codex }` keeps working unchanged. The module no longer constructs an engine itself.
- `app/api/src/main.ts`, modify: `installEngines({ backend: 'cli', engines: cliEngines() })` from `@forge/engine-cli` before `NestFactory.create`, so Kevin's dev api keeps its engines through Part B. B7 moves this line into `main.dev.ts`; until then `main.ts` carries an edge into the dev workspace and the trace test that forbids it does not exist yet.
- `app/api/src/engines/fake.engine.ts`, modify: implements the v2 `Engine` (returns `usage` as `EngineUsage`; the constructor's optional usage argument takes the new shape; `toolCalls` argument deleted). The runner still sends the v1 request until B5; the fake reads `req.kind` only, which is why the api suite stays green in between.
- `app/package.json`, modify: `workspaces: ["shared", "engine-cli", "api", "web"]`; `typecheck` and `test` scripts build shared and engine-cli first and include `-w @forge/engine-cli`.
- `app/api/package.json`, modify: `devDependencies["@forge/engine-cli"] = "*"` (dev, never `dependencies`: invariant 9's second belt); `pretest` and `pretypecheck` build both workspaces; add `"build": "nest build"`.

**Interfaces:**
- Consumes: `Engine`, `EngineRequest`, `EngineResult`, `renderPrompt` from `@forge/shared`.
- Produces: `cliEngines()`; `installEngines`, `installedEngines`, `ENGINE_BACKEND`.

**Work:** The engines' behaviour after the move:
- `ClaudeEngine.command(req)`: argv `-p --output-format stream-json --verbose --model <model> --no-session-persistence`, plus `--allowedTools Read` when `req.images` is non-empty (the caller's prompt already lists the paths; this is today's `image_review` and hybrid-plan-with-reference behaviour under a different flag), plus `--json-schema` when `outputSchema` is set; stdin is `renderPrompt(req)`; cwd `tmpdir()`; env is `process.env` minus `CLI_SCRUBBED_ENV`. `effort` and `maxOutputTokens` are ignored (the CLI has no flag for either; say so in a comment).
- `ClaudeEngine.interpret`: usage is parsed from the result line on **every** path that has one, including `is_error: true` (both `error_max_structured_output_retries` and other) and a non-zero exit with a result line, because invariant 6 is every exit path and the CLI bills those calls (today `claude.engine.ts:185-194` returns no usage there). The mapping takes `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`; a missing field stays undefined. A killed child (timeout) has no result line and no usage.
- `CodexEngine.command(req)`: `exec --sandbox workspace-write`, `-i=<path>` per image, the rendered prompt as the positional; env scrubbed of `OPENAI_API_KEY` (invariant 1; the spec `never passes OPENAI_API_KEY to the child` moves with it and stays green); `cwd` from `req.cwd`. `interpret` parses the `tokens used` session total on every path it appears on (success, quota, non-zero exit) into `usage.outputTokens`, with the comment that this is a session total, not an image-output count (R12's correction); it reports no image count, the runner does (B5).
- `ProcessEngine`: timeout with SIGTERM then SIGKILL after 5 s; `endedResult` returns `failureKind: 'timeout'`; no cap machinery.

**Acceptance check:** `npm test -w @forge/engine-cli` green, with the moved `F2 usage capture` describe extended by three cases: a result line that carries the two cache fields yields `cacheWriteTokens` and `cacheReadTokens`; a result line with `is_error: true`, `subtype: 'error_max_structured_output_retries'` and a `usage` block yields `failureKind: 'invalid_output'` **and** the usage; a non-zero exit whose stdout holds a result line with usage yields `nonzero_exit` and the usage; and a codex non-zero exit whose stderr matches the quota pattern and whose stdout holds `tokens used: 1,234` yields `quota` and `outputTokens: 1234`. `npm run build -w @forge/engine-cli` produces `dist/index.js`. `npm test -w api` green. `npm run typecheck` is red in `api` (the runner sends the v1 request), closed by B5.

**Boundaries:** No Nest imports in the workspace. No edit to the runner in this task. The api's `dependencies` never gain `@forge/engine-cli`.

- [x] Create the workspace, `git mv` the three engines and their specs and stubs, `npm install` from `app/`
- [x] Adapt to the v2 request; run `npm test -w @forge/engine-cli` red on the four new usage cases, then green
- [x] installed.ts, engines.module, main.ts, fake.engine, image-gen.spec import; build; root scripts; `npm test -w api`; commit

**Executed 2026-09-25, with one gap in the plan.** The api suite is not green between B4 and B5: `test/image-gen.spec.ts`'s two raster-lane tests drive the real `CodexEngine` (not a fake) through the runner, which still sends the v1 `{ prompt }`, so `renderPrompt` finds no `system` and no PNG is written. B5's compatibility field closes it. At the B4 commit: engine-cli 31 passed (the four usage cases proved red against the pre-move engines from HEAD); api 406 passed, 2 failed (those two); typecheck red in `api` only (`runner.service.ts`, and `hybrid`, `image-refine`, `image-review`, `runner` specs reading v1 request fields). `test/process-engine.spec.ts` merged into `engine-cli/src/process-engine.spec.ts`. `ClaudeEngine` keeps `cwd: req.cwd ?? tmpdir()` as before the move. `start:dev` also builds engine-cli, because `main.ts` now imports its `dist`.

### Task B5: the runner resolves a row, renders the prompt, and lands usage and cost on every exit path

**Files:**
- `app/api/src/runner/runner.service.ts`, modify: the whole `execute` and `executeManaged` bodies.
- `app/api/src/runs/runs.service.ts`, modify: `start` takes `engine: EngineName`; `recordUsage(id, { tokensInput?, tokensCacheWrite?, tokensCacheRead?, tokensOutput?, imagesGenerated?, costUsd? })`; `addStep` gains the three new fields; every row-returning method (`get`, `list`, `latestForPost`, `stepsFor`) maps `costUsd` through `Number()` (null stays null) in one `toRunRow` / `toStepRow`, so `GET /runs`, `GET /runs/:id`, `latestDraft` and the analytics readers all return a number.
- `app/api/src/runner/runner.module.ts`, modify: imports `ModelRegistryModule` and `LedgerModule`.
- `app/api/src/runs/run-step.dto.ts`, modify: `engine: string`; add `tokensCacheWrite`, `tokensCacheRead`, `costUsd: number | null`.
- `app/api/src/runs/runs-log.controller.ts`, modify: `RunDetailDto = Omit<RunRow, 'costUsd'> & { steps; costUsd: number | null }` and `costUsd` comes from the row; `SettingsService` no longer injected.
- `app/api/src/images/image-gen.service.ts`, modify: `finalize` returns `{ images: valid.length }` instead of calling `runs.recordUsage` itself.
- `app/shared/src/runs.ts`, modify: delete `engineForKind` and `modelKeyForKind` (the runner was their last reader); `RunEngineName` stays as it is (B9 deletes it once `runs.service.ts:25`, `engines.module.ts` and the analytics import are gone). `app/shared/src/contracts.spec.ts`, modify: drop the tests of the two helpers.
- `app/api/test/run-usage.spec.ts`, modify: becomes the exit-path matrix (below).
- `app/api/test/runner.spec.ts`, `execute-managed.spec.ts`, modify: the `routes image_gen to the codex engine` test asserts `run.engine === 'codex'` from the registry row; `call('claude', 'image_plan', {...})` becomes `call('image_plan', {...})`. `execute({ kind, prompt })` calls keep working through the compatibility field for this task and move to `system`/`user` in B6.

**Interfaces:**
- Produces:
```ts
execute<T>(input: {
  kind: RunKind; tier?: PostTier; postId?: number;
  system?: SystemBlock[]; user?: string;
  /** B5 only: the pre-split prompt, rendered as { system: [], user: prompt }. B6 moves every
   *  caller and deletes this field. */
  prompt?: string;
  images?: string[]; cwd?: string;
  schema?: ZodType<T>; tellFields?: string[];
  onStart?: (runId: number) => void;
  /** May report what the call produced beyond tokens (the raster lane's image count). */
  finalize?: (data: T) => Promise<void | { images?: number }>;
}): Promise<ExecuteResult<T>>
executeManaged(input: {
  kind: RunKind; prompt: string; postId?: number; onStart?;
  run: (ctx: { runId; settings; call: (kind: RunKind, req: ManagedCallRequest) => Promise<EngineResult>; addTells }) => Promise<string>;
}): Promise<{ runId: number; ok: boolean }>
interface ManagedCallRequest { system: SystemBlock[]; user: string; images?: string[]; cwd?: string; schema?: ZodTypeAny; tier?: PostTier }
class RunRefused extends ConflictException {}  // thrown before any run row exists
```

**Work:**
- Resolution, before `runs.start`: `row = registry.resolve(taskForKind(kind, tier), backend)`; no row throws `RunRefused(\`no model_registry row for task ${task} on backend ${backend}\`)`; `engine = engines[row.engine]`; no engine throws `RunRefused(\`engine ${row.engine} is not installed in this process (backend ${backend})\`)`. `runs.start({ engine: row.engine, kind, model: row.model, prompt: renderPrompt({ system, user }), postId })`. A managed run resolves the row for its own kind the same way (`image_hybrid` and `image_variate` resolve to `image_html`, `image_refine` to `image_gen`, as `modelKeyForKind` did) and that row's engine and model go on the run row, so a hybrid launched on `api` is refused at launch with the 409 (no `image_html` row on api), before any step runs.
- The call: `engine.run({ kind, model: row.model, effort: row.effort, maxOutputTokens: row.maxOutputTokens, system, user, images, cwd, outputSchema?, timeoutMs: settings.runTimeoutMs }, emit)`.
- The attempt loop, one private function used by `execute` and by `call`: attempt 1; if `result.retryable` is set, write attempt 1's ledger row with `exit = result.failureKind ?? 'other'`, wait `min(afterMs, 30_000)`, attempt 2; attempt 2's result is final whatever it says. Only the final attempt's usage goes on the run row and the step row; attempt 1 lives on its ledger row alone.
- `usage.images` is set by the runner, never by an engine: in `call`, an `image_gen` or `image_refine` call that returned no `failureKind` gets `images: 1` (today's `imagesGenerated: 1` rule at `runner.service.ts:287-289`, now inside usage so it prices); in `execute`, `finalize`'s returned `images` is merged into the usage before settling. So for the raster lane the ledger row is written after `finalize` (and its exit is the engine call's, `succeeded`, even when `finalize` then throws).
- Settle, once per final attempt, from a single private `settle()` guarded by a `settled` flag so the outer catch can never write a second row: `costUsd = costUsd(usage, row.prices)`, `category = kind === 'image_gen' || kind === 'image_refine' ? 'image' : 'text'`, `ledger.record(...)`, then `runs.recordUsage(...)` with the same numbers plus `costUsd`. Settle runs **before** the run row goes terminal (`succeed`/`fail`), because the SSE `complete` that follows the terminal write is what makes the web refetch, and the refetch must see the cost. The exit paths that reach settle exactly once: engine returned success; engine returned `declined` with an envelope (an api provider refusal, C2 and C3), which takes the decline path, schema or not (PR #28 fix pass); engine returned `declined` without one, or any other `failureKind`; `structured` missing, malformed or failing zod (`invalid_output` on the run, `succeeded` on the ledger row: the call completed); `finalize` threw (`other` on the run, the call's exit on the row); the engine threw (the outer catch: a ledger row with no usage and exit `other`, then `runs.fail`).
- `executeManaged.call(kind, req)`: resolves the row per call; a missing row or engine throws `RunRefused` out of the body, and the managed catch fails the run `other` with the message. Each call writes its ledger row with `stepSeq` and its step row with the cache fields and cost; the run's roll-up (`rollUpStepUsage`) sums the three token fields, images and cost onto the run row, as today with three more columns.
- `ExecuteResult` unchanged.

**Acceptance check, the exit-path matrix** (`test/run-usage.spec.ts`, `FakeEngine` subclasses scripted per test; settings and registry from the migrated test database, backend `cli`, the `ENGINES` override keyed `claude` and `codex`):

| case | engine returns | run status / failure | ledger row exit | run row usage and cost |
|---|---|---|---|---|
| success | output with usage `{in 100, cw 20, cr 30, out 10}` | succeeded | succeeded | 100 / 20 / 30 / 10; `costUsd` equals `costUsd(usage, row.prices)` for the resolved `draft_t3` cli row |
| declined | structured decline with usage | failed / declined | declined | recorded |
| provider refusal | `failureKind: 'declined'` plus the envelope, usage | failed / declined, `declined` set, `parsedOk` true | declined | recorded |
| timeout | `failureKind: 'timeout'`, usage `{in 900}` | timeout / timeout | timeout | in 900, out null |
| spawn_error | `failureKind: 'spawn_error'`, no usage | failed / spawn_error | spawn_error | all null; the row exists with null tokens and null cost |
| invalid_output | success line, no `structured`, usage present | failed / invalid_output | succeeded | recorded |
| finalize throws | success with usage; `finalize` rejects | failed / other | succeeded | recorded |
| engine throws | `run()` rejects | failed / other | other | null; exactly one ledger row |
| retry | attempt 1 `{ failureKind: 'quota', retryable: { afterMs: 1 }, usage {in 50} }`, attempt 2 success `{in 100, out 10}` | succeeded | two rows: attempt 1 `quota` in 50, attempt 2 `succeeded` | attempt 2's only (in 100, not 150) |
| raster image | kind `image_gen`, success, `finalize` returns `{ images: 3 }` | succeeded | succeeded, `images 3`, `category image` | `imagesGenerated 3`, `costUsd = 3 × 0.25 = 0.75` (the cli `image_gen` row; its token prices are 0, so a codex session total adds nothing) |
| managed image step | `call('image_gen', …)` succeeds inside a managed run | succeeded | `stepSeq 2`, `images 1`, `category image`, `cost 0.25` | roll-up `imagesGenerated 1`, cost = sum of steps |
| refused | no registry row for the backend (`ENGINE_BACKEND` overridden to `api`, task `image_review`) | no run row | no row | `RunRefused` thrown |

Plus the managed text case from today's spec, with the two ledger rows carrying `stepSeq` 1 and 2 and the run's roll-up equal to their sums. Every case asserts `ledger.forRun(runId).length` and `exit`. Run with `cd app/api && npx vitest run test/run-usage.spec.ts`: red on every new case before the runner change, green after. Then `npx vitest run test/runner.spec.ts test/execute-managed.spec.ts test/image-gen.spec.ts` green, `npm test -w api` green, `npm run typecheck` green.

**Boundaries:** No caller edits beyond `image-gen.service.ts`'s `finalize` return (B6). No engine edits. `RunEventsHub` untouched. Do not touch `tell-fields.ts`.

- [x] Rewrite run-usage.spec as the matrix, run red
- [x] RunsService columns and the `Number()` mapping, then the runner: resolution, render, the attempt loop, settle with its flag, managed call by kind, images in usage; the raster finalize return
- [x] Matrix green, the runner specs green, `npm test -w api`, `npm run typecheck`; commit

**Executed 2026-09-25, with three caller edits pulled forward from B6.** B5 as written could not reach a green typecheck or api suite: `call(kind, req)` and the request without `model` and `allowedTools` break `image-compose` (the hybrid's three calls), `image-refine` and `image-review`, and at runtime `call('claude', 'image_plan', …)` would read `'claude'` as the kind. So B5 also moved those callers onto `call(kind, { prompt, … })` (the compatibility field, now on `ManagedCallRequest` too), the hybrid plan step onto `images: [refBg]` and `image_review` onto `images: candidates…`; B6 keeps its list for the split. The spec doubles in `hybrid`, `image-refine`, `image-review` and `runner` read `renderPrompt(req)` and `images`. `run-detail.spec` asserted the read-time estimate this task removes; it now asserts the recorded cost. `images.service.ts`'s breakdown reads steps itself, so it maps them through `RunsService`'s exported `toStepRow`. `executeManaged` lost its unused `model` override. The matrix ran red (the module could not resolve `LedgerService`) before the runner change, green after: 12 cases. At the commit: api 70 files / 417 tests, engine-cli 31, typecheck 0; the two raster-lane tests red since B4 are green.

### Task B6: every launcher speaks the v2 request

**Files:**
- `app/api/src/retrieval/prompt-assembly.ts`, `prompt-assembly.spec.ts`, modify: `assembleDraftPrompt` returns `{ system: SystemBlock[]; user: string }`: system is one block, `'you are drafting a linkedin post for the operator.\n\n' + constitution` with `cache: true`; user is the rest (exemplars, tier, idea, refinement, output contract) joined as today.
- `app/api/src/ideas/triage-prompt.ts`, `triage-prompt.spec.ts`, modify: the same split (`'you are triaging…\n\n' + constitution` as the cached block).
- `app/api/src/playbook/retro-prompt.ts`, `retro-prompt.spec.ts`, modify: the same split; the constitution block is cached, the goal, rules and posts are the user turn.
- `app/api/src/images/hybrid-prompts.ts`, `hybrid-prompts.spec.ts`, modify: `assemblePlanPrompt` and `assembleVariatorPrompt` return the split (constitution cached); `assembleBackgroundPrompt` and `assembleBgRefinePrompt` return `{ system: [], user }`.
- `app/api/src/images/image-compose.service.ts`, `image-compose.spec.ts`, modify: `assembleImageHtmlPrompt` (defined at `image-compose.service.ts:50`) returns `{ system: [], user }`; `launchHybrid`'s three `call`s and the variator's `execute` pass the split; `launch` (the `html` lane) passes `{ system: [], user }`.
- `app/api/src/drafting/drafting.service.ts`, modify: `buildRefineSelectionPrompt` returns the split; both `execute` calls pass `system`, `user`; the launch chains map `RunRefused` to the 409 (below).
- `app/api/src/ideas/ideas.service.ts`, `app/api/src/playbook/retro.service.ts`, `app/api/src/images/image-gen.service.ts`, `image-refine.service.ts`, `image-review.service.ts`, modify: `execute`/`call` by kind with the split; `image_review` passes `images: candidates.map(resolveAssetFile)` instead of `allowedTools: ['Read']`; the hybrid plan step passes `images: [refBg]` when a reference exists; the background and refine steps pass `cwd` and, for refine, `images: [sourceBg]`.
- `app/api/src/runner/runner.service.ts`, modify: delete the `prompt` compatibility field; `system` and `user` become required.
- `app/api/test/runner.spec.ts`, `execute-managed.spec.ts`, modify: `execute({ kind, prompt })` becomes `execute({ kind, system: [], user })`.
- `app/api/test/fixtures/prompts/*.txt`, create in the first step from the pre-change builders: `draft-t1-refine.txt` (two exemplars, one with a performance note, a refinement), `draft-t2-plain.txt` (no exemplars, no refinement), `triage.txt`, `retro.txt`, `plan.txt`, `variator.txt`, `refine-selection.txt`.
- `app/api/test/prompt-render.spec.ts`, create: `renderPrompt(<builder>(...))` equals its fixture byte for byte, for each of the seven. Inputs to the builders are literal strings in the spec (persona `'p'`, one rule, one style doc), so the fixtures are small.
- Every asynchronous launcher's race: `if (runId === -1) throw refused ?? new ConflictException(<today's message>)`, where `refused` is captured in the chain's `.catch` when `err instanceof RunRefused`. The launchers: draft/refine (`launch`), selection refine, retro, hybrid, raster, review, background refine, the html lane. Triage is synchronous and lets `RunRefused` propagate. The variator's fail-open catch keeps swallowing (a refused variator falls back to the plain brief, as any failure does today).

**Interfaces:**
- Consumes: `execute`, `executeManaged`, `RunRefused` from B5; `SystemBlock`, `renderPrompt` from B1.

**Work:** First, before touching any builder, write `prompt-render.spec.ts` against the *current* string builders and save their output as the seven fixtures (the spec reads the fixture and compares; at this step it compares a string to itself and is green; the fixture is the pre-change truth). Then change the builders; the spec now compares `renderPrompt(split)` to the fixture and must stay green. The cache breakpoint sits after the constitution because the exemplars and the idea change per Post and the Constitution does not (ADR 0019); the second breakpoint after the Inputs block arrives with slice 9.

**Acceptance check:** `cd app/api && npx vitest run test/prompt-render.spec.ts` green before and after the split (a byte difference is the red). Then `npm test -w api` green (hybrid, image-*, retro, ideas, drafting, e2e all through fakes keyed by kind). `npm run typecheck` green with the compatibility field gone. Route smoke green.

**Boundaries:** No prompt wording changes. No web. The `image_review` prompt text still says "Read each file with the Read tool"; that wording is slice 10's, when the kind gets an `api` row.

- [x] Write prompt-render.spec against the old builders, save the seven fixtures, see green
- [x] Split the builders, keep the spec green
- [x] Move every launcher onto the v2 request and the `RunRefused` mapping; delete the compatibility field; `npm test -w api`; `npm run typecheck`; smoke; commit

**Executed 2026-09-25.** The fixtures were committed on their own (`da5b2ea`) before any builder changed. Byte identity holds for all seven; `prompt-render.spec` also asserts one cached system block that ends with the constitution and a user turn that does not repeat it. The api type is `SplitPrompt` (in `engine.interface.ts`), because `drafting.service.ts` already has a local `PromptParts`. `image_review` sends `{ system: [], user }` (no builder; slice 10 splits it with its `api` row). One test beyond the plan: `image-review.spec` proves a registry refusal reaches the caller as itself (409 naming the missing row) and writes no run, proved red by removing `refused ??`. Live, on the cli: a triage on a scratch idea (run 130, succeeded, 2 in / 30,432 cache write / 1,151 out, $0.087594 on the run row and on its one ledger row) and a T3 draft on a scratch post (run 131, the model declined for want of real work; the declined exit carried its usage and $0.097997 onto the run and the ledger). Both scratch ideas discarded, the scratch post deleted. The cli writes about 23k to 30k cache tokens per call (Claude Code's own system prompt), which dominates a small call's list-price cost; C5 should read cli and api costs with that in mind.
- [x] Session boundary: green checkpoint; recommend `/clear`, then `pickup` on B7 (checkpoint 2026-09-25: typecheck 0, lint 0, api 71 files / 425 tests, engine-cli 31, shared 127, smoke PASS)

### Task B7: two entry files, and the trace test that proves the boundary

**Files:**
- `app/api/src/bootstrap.ts`, create: `bootstrap()` as `main.ts` has it today (`loadEnv`, `NestFactory.create`, `configureApp`, `listen` on `process.env.PORT ?? 3001`), importing `AppModule` and nothing engine-related.
- `app/api/src/main.ts`, modify: replace B4's cli install with `loadEnv()` then `installEngines({ backend: 'api', engines: {} })` (Part C fills the map), drop the `@forge/engine-cli` import, call `bootstrap()`.
- `app/api/src/main.dev.ts`, create: `installEngines({ backend: 'cli', engines: cliEngines() })` from `@forge/engine-cli`, then `bootstrap()`.
- `app/api/tsconfig.trace.json`, create: extends `tsconfig.json` with `outDir: "dist-trace"`; `app/api/.gitignore` (or the root one) ignores `dist-trace/`.
- `app/api/package.json`, modify: `start:dev` becomes `npm run build -w @forge/shared -w @forge/engine-cli --prefix .. && nest start --watch --entryFile main.dev`; add `start:api` as `npm run build -w @forge/shared --prefix .. && nest start --entryFile main` (Part C's live check uses it); `devDependencies` gains `@vercel/nft`.
- `app/api/test/no-cli-in-prod.spec.ts`, create.
- `CLAUDE.md`, modify (Servers section): "`npm run start:dev` boots the api on the `cli` backend through `src/main.dev.ts`; `src/main.ts` is the `api` backend and never imports `@forge/engine-cli`. The trace test builds into `dist-trace/`, never into the `dist/` the watcher writes."

**Work:** The spec runs `execFileSync('npx', ['nest', 'build', '--path', 'tsconfig.trace.json'], { cwd: app/api })` in `beforeAll` with a 120 s timeout on that hook (vitest's per-hook argument, not the global `hookTimeout`), so the running `nest start --watch` and its `dist/` are never touched, then `nodeFileTrace(['dist-trace/main.js'], { base: <app/> })` from `@vercel/nft` and asserts no entry of `fileList` contains `engine-cli/`. The positive control in the same file traces `dist-trace/main.dev.js` and asserts that some entry does contain `engine-cli/dist/index.js`; that control is the sabotage proof that the assertion can go red. The trace walks playwright, exceljs and linkedom too; if the two traces together take more than a few seconds, cache the first `nodeFileTrace` result across the two tests rather than raising timeouts further. If `nest build --path` does not honour `outDir` under the swc builder, fall back to `swc src -d dist-trace` with the same options `nest-cli.json` implies and say so in the spec's header.

**Acceptance check:** `cd app/api && npx vitest run test/no-cli-in-prod.spec.ts` green, with the positive control green. Sabotage once: add `import '@forge/engine-cli'` to `bootstrap.ts`, watch the absence assertion go red, remove it. `grep -n "engine-cli" app/api/package.json` shows the name under `devDependencies` only. `npm run typecheck` green. `npm test -w api` green with the trace spec in the run.

**Boundaries:** No change to what `AppModule` imports. No Dockerfile (slice 13).

- [x] Write the trace spec (both assertions), install `@vercel/nft`, run red (no `main.dev.js` yet)
- [x] Create bootstrap.ts, main.dev.ts and tsconfig.trace.json, edit main.ts and the scripts
- [x] Spec green, sabotage once, restore, commit
- [x] Tell Kevin in the hand-off notes: restart the dev api with `npm run start:dev` (it is the cli entry now)

**Executed 2026-09-25.** `nest build --path tsconfig.trace.json` honours `outDir` under swc, so no fallback; `tsconfig.trace.json` includes `src` only. Each trace takes about 4 s, so the two are not cached. The spec also asserts `bootstrap.js` is in `main`'s trace, so an empty trace cannot pass the absence check. Sabotage (`import '@forge/engine-cli'` in `bootstrap.ts`) went red listing `engine-cli/dist/*.js`. `bootstrap()` listens on `PORT ?? 3001`. From this commit the running watcher respawned on `main.ts`, which is the `api` backend with no engines: the live dev api refuses every run until Kevin restarts it with `npm run start:dev`.

### Task B8: the web reads the registry and the recorded cost

**Files:**
- `app/web/src/api/client.ts`, modify: `RunEngineName` becomes `EngineName` (from shared); `RunDto` and `RunStepDto` gain `tokensCacheWrite`, `tokensCacheRead`, `costUsd: number | null`; `RunDetailDto.costUsd` comment says "recorded at call time from the registry row"; add `ModelRowDto`.
- `app/web/src/api/hooks.ts`, modify: add `useRegistry()` (`GET /registry`) and `usePatchRegistryRow()` (`PATCH /registry/:id`, invalidates `['registry']` and `['runs']`).
- `app/web/src/ui/run-detail.tsx`, `run-detail.spec.tsx`, modify: `tokenSummary` renders `1,200 in · 30 cached · 340 out` when either cache field is non-null (`cached` is the read count; a write shows as `+20 cache write` only when non-zero), keeps `N total` for `codex` and mixed managed runs, where N sums input, cache write, cache read and output (PR #28 fix pass); `est. cost` label becomes `cost`, value from `run.costUsd` (null renders `not recorded` as today). `StepRow` shows the same.
- `app/web/src/pages/SettingsPage.tsx`, `SettingsPage.spec.tsx`, modify: delete the pricing panel, `toDraft`, `validate`, `PricingRow`, the `unpriced` note; add `ModelsPanel` listing registry rows grouped by backend (`cli` first, since that is what Kevin runs), each row editable in place for engine (a select limited to the backend's engines), model, effort, max output tokens and the five prices, saved per row with `usePatchRegistryRow`, with the existing `saved ✓` and `ErrorNote` idioms; the panel's sub-line reads "one row per task and backend; prices are usd per million tokens, images per image; the cost on a run is priced from the row at call time". Scheduling and style docs panels unchanged. The skeleton keeps its shape. `SettingsDto` still carries `models` and `pricing` until B9 deletes them from `Settings`; the page stops reading them here.
- `app/web/src/pages/PostAnalytics.tsx`, `Analytics.tsx`, modify: the notes "estimates from settings.pricing — display only" become "priced from the model registry at call time; on the cli backend this is what the same call costs on the api".

**Work:** The registry panel is a form like the old pricing panel, one row per registry row; internal structure is yours, the design system's primitives (`Panel`, `Field`, `inputCls`, `Button`, `ErrorNote`) are the palette. No accent rail, no new hue. Read the rendered page in both themes before calling it done.

**Acceptance check:** `npm test -w web` green (run-detail spec gains the cached-tokens case; the settings spec swaps the pricing tests for registry ones: renders 13 rows, a PATCH is sent with numbers on save, a negative price is blocked client-side with the row's `ErrorNote`, a `cli` row's engine select offers `claude` and `codex` only); `npm run lint -w web` 0/0; `npm run typecheck`; from `app/api`: `WEB_URL=http://localhost:5174 node scripts/route-smoke.mjs` all `ok`, zero console errors, `<title>` guard passes. This is a rendered surface: open `/settings` and `/runs` in both themes and read them.

**Boundaries:** No other page changes. No new colour tokens. `WarnBanner`, `ErrorNote.label`, `Metric` rules in CLAUDE.md hold.

- [x] Write the run-detail and settings spec changes, run red
- [x] Client types, hooks, run detail, settings panel, notes
- [x] Web tests, lint, typecheck, smoke, both themes read; commit

**Executed 2026-09-25.** Eight new spec cases ran red, then green; web 223 passed, lint 0, typecheck 0, smoke PASS. Read in both themes at 1280 px (headless, zero console errors): the first layout stacked a second column-header line for the five prices, which interleaved with the first line's labels; each price now carries its own small caption and the header covers line one only. Run #130 renders `2 in · 0 cached · +30,432 cache write · 1,151 out` and `cost · $0.0876`. Beyond the plan: a step row shows its own cost; the page sub-line names which model runs each task; the note under the old pricing panel ("edits recompute all history") went with the panel, since it is no longer true. Five web spec fixtures of `RunDto` gained the three new fields.

### Task B9: the analytics readers, the last deletions, and the documents

**Files:**
- `app/api/src/analytics/analytics.service.ts`, `analytics.module.ts`, modify: `board()` and the post-detail runs read `runs.cost_usd` (already a number from `RunsService`) instead of `estimateCostUsd`; drop `SettingsService` from the module where it was only there for pricing; drop the `RunEngineName` import.
- `app/shared/src/settings.ts`, modify: delete `models` and `pricing` from `SettingsSchema` and `DEFAULT_SETTINGS`.
- `app/shared/src/pricing.ts`, `pricing.spec.ts`, delete; `app/shared/src/index.ts` drops the `pricing` export; `app/shared/src/contracts.spec.ts`, modify: drop the `DEFAULT_SETTINGS.models` assertions.
- `app/shared/src/runs.ts`, modify: delete `RunEngineName` once `grep -rn RunEngineName app/api app/web` finds no importer (`runs.service.ts`, `engines.module.ts`, `runner.service.ts`, `analytics.service.ts` and `web/src/api/client.ts` all moved to `EngineName` in B4, B5 and B8; fix any straggler here).
- `app/api/test/analytics-board.spec.ts`, `analytics-post-detail.spec.ts`, `run-detail.spec.ts`, modify: the expectations use `runs.recordUsage(id, { …, costUsd })` on the seeded runs and assert the stored number comes back, not a settings rate.
- `app/api/test/style-docs-migration.spec.ts`, modify: the settings fixture keeps `models` and `pricing` (it stands up a pre-0012 database, where those keys were real); no assertion change.
- `app/api/test/settings.spec.ts`, `http-surface.spec.ts`, modify: `s.models.retro` assertions go; the round-trip asserts on `retrievalK` only.
- `CONTEXT.md`, modify: add to the v2 section **Model registry** ("one row per task and backend: the engine, the model, the effort, the output cap and the prices. Replaces `settings.models`, `settings.pricing` and `engineForKind`. A row is data; changing a model is an edit on `/settings`, never a code change." Avoid: model config, model settings), **Ledger** ("one row per model call and attempt: backend, engine, model, category, the call's exit, usage with cache tokens, cost. Written on every exit path; survives the Run it describes. Slice 3 adds the Budget's reserved and settled columns." Avoid: cost log, usage table), **Engine backend** ("`api` or `cli`, chosen by the process entry file; `fake` is a test engine, not a backend." Avoid: mode, provider (a provider is one engine on the api backend)); the v1 **Run** entry's `engine (claude | codex)` becomes "engine name (`claude | codex` on cli, `anthropic | openai` on api)"; invariant 6 becomes "Every model call is an audited Run with its full prompt and output, usage with cache tokens and cost, on every exit path" (the context row clause waits for slice 6, which builds it).
- `CLAUDE.md`, modify: Gates gains "`@forge/engine-cli` builds before the api the same way `@forge/shared` does"; Code gains "drizzle returns `numeric` columns as strings; `RunsService` and the registry service convert with `Number()`, and nothing else reads those columns raw"; Records gains "Registry rows are data: a model, an engine within its backend, or a price changes on `/settings`, not in a migration; `PATCH /api/registry/:id` is the route" and "A cli run's cost from slice 2 on counts cache tokens and list prices; it is not comparable to the estimate shown on runs before 0021".
- `docs/adr/0019-three-engine-backends-and-the-cli-package-boundary.md`, modify: append a dated "Implemented (slice 2)" paragraph naming narrowings 1, 3, 6, 9 and 10 from this plan's header (engine name on `runs.engine`, the envelope rewritten at the provider edge, the retry in the runner, 529/503 to `quota`, the three fields not carried).

**Acceptance check:** `npm run typecheck` green across all four workspaces; `npm run lint -w web` 0/0; `npm test` from `app/` green (shared, engine-cli, api, web). Kevin restarts the api (`npm run start:dev`); then `WEB_URL=http://localhost:5174 node scripts/route-smoke.mjs` all `ok`; then one live triage on a scratch idea and one live draft on a scratch T3 post through the running app, and `select exit, tokens_input, tokens_cache_read, tokens_output, cost_usd from ledger order by id desc limit 2` shows two `succeeded` rows with numbers; then the scratch post deleted and its idea discarded.

**Boundaries:** The settings row is not edited by this plan (the first `PATCH /settings` after this task strips its dead keys, which is fine). Posts #1, #4 and #9 untouched. No `DROP`.

- [x] Readers and their specs, the last deletions, run green (the analytics readers select the stored cost with `::float8` and read no steps: a managed run's cost is already their sum; `pricing.spec`'s two non-pricing tests moved to `contracts.spec`; `http-surface` asserts the settings payload carries neither `models` nor `pricing`)
- [x] Documents, `unslop` pass (the three glossary entries went under **Engine execution** beside **Run**, not the Tenancy section, whose heading says its terms are not in code yet; the CLAUDE.md numeric line names the analytics `::float8` cast, which the plan's wording missed; the cost line also records the cli's 23k to 30k cache tokens a call)
- [x] Full gates, restart by Kevin, smoke, the two scratch runs, cleanup, commit (2026-09-25: `npm test` from `app/` green, shared 122 / engine-cli 31 / api 427 / web 223, typecheck 0, lint 0. The restart of the dev api on 3001 is still Kevin's: it is on `main.ts`, the `api` backend with no engines, and a control triage there answered 409 `engine anthropic is not installed in this process (backend api)`. The live runs went through `main.dev.js` built into `dist-trace/` and served on 3002 by `devserve`: draft run 133 on scratch post 14 succeeded ($0.075427, body written); a first triage declined for want of substance (run 132); triage run 134 on a real idea succeeded ($0.04174, 9,629 cache-read tokens). The last two ledger rows are `succeeded` with numbers. Post 14 deleted, ideas 14 to 19 discarded, the settings row untouched (`weeklyGoal` null).)
- [x] Session boundary: recommend `/clear`, then `pickup` on C1 (Part B closed 2026-09-25; C needs `ANTHROPIC_API_KEY` from Kevin)

---

# Part C: the `api` backend and R12 on real tokens (session 5)

Part C adds two SDK engines behind the seam, fills `main.ts`'s engine map, and measures. Every engine test uses the SDK's `fetch` option with a scripted response; no test touches the network. The live checks and the R12 runs spend real money on Kevin's keys and say so.

### Task C0: a lean cli argv, and Sonnet on the cli rows (added 2026-09-26, approved by Kevin)

**Why.** Measured 2026-09-25 on CLI 2.1.282 with a one-word Haiku prompt. Today's argv sends 22,140 prompt tokens, and forge's prompt is a handful of them. About 11k are Kevin's own user setup (global CLAUDE.md, skill list, MCP connectors), about 5k are tool definitions, about 6k are Claude Code's system prompt. `--tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --system-prompt <ours>` sent 405, and 1,151 with `--json-schema`, whose structured output still came back. The CLI processes the overhead on every call, cached or not, so it spends subscription quota on nothing. The user CLAUDE.md also reaches forge's drafts today, which is a correctness leak as well as a cost. `--bare` would do the same in one flag but authenticates strictly with `ANTHROPIC_API_KEY`, which moves cli runs onto metered billing, so it is out. A dummy `ANTHROPIC_API_KEY` in the child env was ignored by 2.1.282 (the call ran on the subscription); the scrub below is for the version that stops ignoring it.

**Files:**
- `app/engine-cli/src/claude.engine.ts`, modify: export `CLI_SYSTEM_PROMPT` and a pure `claudeArgv(req, prefixArgs = [])` that `command()` uses: `-p --output-format stream-json --verbose --model <model> --no-session-persistence --strict-mcp-config --setting-sources "" --disable-slash-commands --system-prompt <CLI_SYSTEM_PROMPT>`, then `--tools ""` without images or `--tools Read --allowedTools Read` with them, then `--json-schema` when set. `CLI_SCRUBBED_ENV` gains `ANTHROPIC_API_KEY` and moves to `process-engine.ts`, where both engines apply it (PR #28 fix pass: the codex child was scrubbed of `OPENAI_API_KEY` only).
- `app/engine-cli/src/index.ts`, modify: export `claudeArgv` and `CLI_SYSTEM_PROMPT`.
- `app/engine-cli/src/claude.engine.spec.ts`, `cli-engines.spec.ts`, modify: the argv carries each lean flag; `--tools ""` without images and `--tools Read` plus `--allowedTools Read` with them; the env has no `ANTHROPIC_API_KEY`.
- `app/api/scripts/probe-output-contract.mjs`, modify: its argv comes from `claudeArgv` (engine-cli `dist`), so the probe proves the engine's own flags, not a copy.
- Live data, no migration: the five `cli` rows on `claude-opus-4-8` (`draft_t1`, `draft_t2`, `image_html`, `image_review`, `retro`) move to `claude-sonnet-5` at Sonnet's list prices (2 / 2.5 / 0.2 / 10) through `PATCH /api/registry/:id`. Rows are data (CLAUDE.md); Kevin moves them back on `/settings` when he wants Opus.

**Acceptance check:** `npm test -w @forge/engine-cli` red on the new argv and env cases before the change, green after. `node scripts/probe-output-contract.mjs` PASS on calls 1, 2 and 5 with the engine's argv. Through the dev api on 3001 (cli backend): one draft on a scratch T3 post and one image review on post #5 (sacrificial; it has two candidates) succeed, and their ledger rows show the prompt tokens down from run 133's 25k-plus. `npm test` from `app/` and `npm run typecheck` green; route smoke PASS.

**Boundaries:** No change to `CodexEngine`. No schema change. The cli rows' prices change with their model and nothing else.

- [x] Specs red, argv and scrub green, probe on the engine's argv; commit (2026-09-26: five new cases red, then engine-cli 33 passed; the probe on `claudeArgv`: call 1 PASS, call 2 PASS at 1,434 prompt tokens, call 5 now answers through the schema where the old flags let it slip into prose. `npm test` from `app/` green, typecheck 0)
- [x] Registry rows to Sonnet; live draft and review; numbers into this note; commit (2026-09-26. The dev servers were down after a machine restart and docker was stopped; docker and `forge-db` were started, and the live calls went through `main.dev.js` built into `dist-trace/` on 3002 by `devserve`. The five Opus cli rows are on `claude-sonnet-5` at 2 / 2.5 / 0.2 / 10. Draft run 135, the same idea and model as run 133: 4,256 prompt tokens and $0.021849, against 25,251 and $0.075427. Review run 136 on post #5 read both candidates through `--tools Read` and scored them: 9,885 prompt tokens with the two images, $0.022857. Post #5's two review scores were restored to null; scratch post 15 deleted, idea 20 discarded. The route smoke waits for Kevin to restart the web and api dev servers.)

### Task C1: one provider-schema transform for both engines

**Files:**
- `app/api/src/engines/api/provider-schema.ts`, create: `toProviderSchema(schema: OutputJsonSchema, opts: { strict: boolean }): OutputJsonSchema` and `restoreOptionals(value: unknown, original: OutputJsonSchema): unknown`.
- `app/api/src/engines/api/provider-schema.spec.ts`, create.

**Work:** `toProviderSchema` deep-copies and, on every nested object, array item and union branch: rewrites `oneOf` to `anyOf` (narrowing 3); strips the keywords neither provider's grammar accepts (`minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `pattern`, `format`, `minItems` above 1, `maxItems`, `$schema`). With `strict: true` (OpenAI) it also, on every object, sets `required` to every key in `properties` and, for each key that was not required, rewrites its schema as `{ anyOf: [<original>, { type: 'null' }] }`; `additionalProperties: false` is kept (zod-to-json-schema already emits it). `restoreOptionals` walks a parsed value beside the original schema and deletes a property whose value is `null` where the original schema did not require it, so `image_concept: null` becomes absent and `DraftOutputSchema`'s `.optional()` parses. The post-hoc zod parse in the runner still enforces every bound zod carries (`min(1)` on a body, `max(2048)` on a Source ref); a value outside those is a broken contract and `invalid_output`, as ADR 0016 says. The rule "an overrun is never `invalid_output`" is about a Form's length and structure rules, which never enter the schema and arrive as a post-check in slice 5.

**Acceptance check:** `cd app/api && npx vitest run src/engines/api/provider-schema.spec.ts` green on: the draft envelope has `anyOf` and no `oneOf` at `properties.result`; under `strict` the payload branch has `required: ['body_linkedin','hashtags','image_concept','sources']` and `image_concept` nullable; `minLength` is gone from `body_linkedin` and from the decline's `reason`; the decline branch's `const` is kept; `restoreOptionals({ result: { body_linkedin: 'x', hashtags: [], image_concept: null, sources: null } }, envelope)` yields an object `DraftOutputSchema` parses after `unwrapResult`; a non-strict transform leaves `required` as it was.

**Boundaries:** No engine code. No change to `enforcedJsonSchema`.

- [x] Spec red, transform green, commit (2026-09-26: 8 cases red on the missing module, then green; typecheck 0)

### Task C2: the Anthropic engine

**Files:**
- `app/api/src/engines/api/anthropic.engine.ts`, create.
- `app/api/src/engines/api/anthropic.engine.spec.ts`, create, with SSE fixtures under `app/api/test/fixtures/anthropic/*.sse`.
- `app/api/package.json`, modify: `dependencies` gains `@anthropic-ai/sdk`.

**Interfaces:**
- Produces: `class AnthropicEngine implements Engine { readonly name = 'anthropic'; constructor(opts: { apiKey: string; fetch?: typeof fetch }) }`, the client built on first `run` (never in the constructor, so a keyless process boots).

**Work.** The request, load-bearing shape (names from R13 and the claude-api reference; the compiler is the final check):
- `new Anthropic({ apiKey, maxRetries: 0, timeout: req.timeoutMs, fetch })`.
- One `output_config` object, built once: `{ ...(req.effort ? { effort: req.effort } : {}), ...(req.outputSchema ? { format: { type: 'json_schema', schema: toProviderSchema(req.outputSchema, { strict: false }) } } : {}) }`, sent only when non-empty. Then `client.messages.stream({ model, max_tokens: req.maxOutputTokens, system: req.system.map((b) => ({ type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) })), messages: [{ role: 'user', content: req.user }], output_config }, { signal: controller.signal })`. No `thinking` parameter (adaptive by default on Sonnet 5 and Opus; `budget_tokens` is a 400 there). Adaptive thinking spends part of `max_tokens` before the text; the registry's 16384 on draft rows leaves room, and the `max_tokens` stop below is the signal when it does not. At most 4 breakpoints; the request has one in slice 2.
- `req.images` non-empty returns `{ output: '', failureKind: 'other', errorDetail: 'vision input on the api backend arrives with slice 10' }` without calling.
- Events: `message_start` gives `usage.input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` (kept in a local so a later abort still has them); `content_block_delta` text deltas are emitted as `chunk` events to the SSE console; `message_delta` gives `usage.output_tokens` and `stop_reason`. `finalMessage()` gives the content, `stop_reason`, `stop_details` and the request id (`_request_id` on the message or the stream's `request_id`; whichever the SDK exposes is the `providerRequestId`). The output text is the concatenation of the `text` blocks in `content`, never `content[0]`, because a `thinking` block comes first under adaptive thinking.
- Timeout: `setTimeout(() => controller.abort(), req.timeoutMs)`; the abort rejects `finalMessage()` with the SDK's abort error, which maps to `failureKind: 'timeout'`, `errorDetail: \`aborted after ${timeoutMs}ms\``, with whatever usage arrived. The SDK's own `APIConnectionTimeoutError` (the connect or first-byte phase exceeded the client `timeout`) also maps to `timeout`, and is checked before its parent `APIConnectionError`.
- Mapping of the final message: `stop_reason === 'refusal'` gives `failureKind: 'declined'` with `structured = { result: { outcome: 'declined', reason: stop_details?.explanation ?? 'the provider refused' } }` and the runner's decline path takes a `declined` that carries the envelope (B5, PR #28 fix pass); `stop_reason === 'max_tokens'` gives `invalid_output` (`'output cut at max_output_tokens'`); otherwise with a schema, `structured = JSON.parse(text)` (a parse failure is `invalid_output`); without a schema, `output = text`.
- Errors, most specific first: the SDK's abort error and `APIConnectionTimeoutError` to `timeout`; `RateLimitError` (429) to `quota`, with `retryable: { afterMs: Number(headers['retry-after']) * 1000 }` when the header is present and numeric, zero included (PR #28 fix pass) and the body's `error.details.error_code` is not `enforced_spend_limit_reached`, and no `retryable` otherwise; status 529 (`overloaded_error`) or 503 to `quota` with `retryable: { afterMs: 2000 }` (narrowing 9), the detail carrying the real status and type (PR #28 fix pass); `APIConnectionError` to `spawn_error`; any other `APIError` to `nonzero_exit` with `\`${status} ${type}: ${message}\`` as the detail. Every error result carries the usage captured so far, the text deltas that arrived as `output`, and the request id from the stream or the error (PR #28 fix pass).
- `usage` maps to `EngineUsage` as `{ inputTokens: input_tokens, cacheWriteTokens: cache_creation_input_tokens, cacheReadTokens: cache_read_input_tokens, outputTokens: output_tokens }`; a field the provider omits stays undefined. Anthropic's `input_tokens` is the uncached count, so no subtraction.

**Acceptance check** (`cd app/api && npx vitest run src/engines/api/anthropic.engine.spec.ts`), each case a scripted `fetch` returning an SSE `Response` from a fixture file or an error status:
1. success with schema: fixture streams `message_start` (input 1000, cache_creation 800, cache_read 0), a `thinking` block, then a text block with `{"result":{"source":"work","suggested_tier":"T2","news_expiry_days":null,"notes":"n"}}`, `message_delta` (output 40, `end_turn`), header `request-id: req_1`; result has `structured.result.suggested_tier === 'T2'`, usage `{1000, 800, 0, 40}`, `providerRequestId === 'req_1'`, no failure; the request body sent to fetch has `cache_control` on the system block and `output_config.format.type === 'json_schema'`; fetch was called once.
2. timeout after message_start: the fixture streams `message_start` then never ends; `timeoutMs: 50`; result `failureKind: 'timeout'`, `usage.inputTokens === 1000`, `outputTokens` undefined; the fetch's signal is aborted.
3. timeout before first byte: the scripted fetch never resolves; the SDK's connect timeout (client `timeout: 50`) fires; result `timeout`, usage undefined.
4. 429 with `retry-after: 3` gives `quota` and `retryable.afterMs === 3000`; 429 with `enforced_spend_limit_reached` gives `quota` and no `retryable`.
5. 529 gives `quota` with `retryable.afterMs === 2000`.
6. a fetch that rejects with a network error gives `spawn_error`.
7. 400 gives `nonzero_exit` with `400` in the detail.
8. `stop_reason: 'refusal'` gives `declined` with the structured decline envelope.
9. `stop_reason: 'max_tokens'` gives `invalid_output`.
10. `images: ['/x.png']` gives `other` and calls fetch zero times.
11. effort: with `effort: 'high'` and a schema the sent body has one `output_config` carrying both `effort` and `format`; with `effort: null` and no schema it has no `output_config` key.

**Boundaries:** No OpenAI code. No runner edits. No network in tests.

- [x] Install the SDK, write the spec with the fixtures, run red (2026-09-26: `@anthropic-ai/sdk` 0.128.0; 13 cases, the eleven plus a no-schema text case, red on the missing module)
- [x] Engine green case by case; commit (13 green; the images guard proved by sabotage; `output_tokens` is read from `message_delta` only, because `message_start` carries a placeholder of 1. The scripted fetch lives in `test/helpers/scripted-fetch.ts` for C3 to reuse.)

### Task C3: the OpenAI engine

**Files:**
- `app/api/src/engines/api/openai.engine.ts`, `openai.engine.spec.ts`, create; fixtures under `app/api/test/fixtures/openai/*.sse`.
- `app/api/package.json`, modify: `dependencies` gains `openai`.

**Interfaces:**
- Produces: `class OpenAiEngine implements Engine { readonly name = 'openai'; constructor(opts: { apiKey: string; fetch?: typeof fetch }) }`, client built on first `run`.

**Work.** Responses API, streaming: `client.responses.create({ model, instructions: req.system.map((b) => b.text).join('\n\n'), input: req.user, max_output_tokens: req.maxOutputTokens, ...(req.effort ? { reasoning: { effort: req.effort } } : {}), ...(req.outputSchema ? { text: { format: { type: 'json_schema', name: 'result', strict: true, schema: toProviderSchema(req.outputSchema, { strict: true }) } } } : {}), stream: true }, { signal })`. OpenAI caches prefixes on its own (no breakpoints); `cache: true` on a block is ignored. Text deltas (`response.output_text.delta`) go to the console as `chunk`. The completed event carries `usage`: `inputTokens = input_tokens - input_tokens_details.cached_tokens`, `cacheReadTokens = cached_tokens`, `cacheWriteTokens` undefined (OpenAI has no write charge), `outputTokens = output_tokens`. This subtraction is the load-bearing arithmetic: OpenAI's `input_tokens` includes the cached tokens and Anthropic's does not, and the ledger stores the uncached count for both. `providerRequestId` from `_request_id`. A `refusal` output item maps to `declined` with the refusal text as the reason. `structured = restoreOptionals(JSON.parse(output_text), req.outputSchema)`. `incomplete_details.reason === 'max_output_tokens'` maps to `invalid_output`. Errors as in C2 with the OpenAI SDK's classes (`RateLimitError` with `retry-after`; the SDK's connection-timeout error and the abort to `timeout`; `APIConnectionError` to `spawn_error`; 503 to `quota` with `retryable: { afterMs: 2000 }` (narrowing 9); other 4xx and 5xx to `nonzero_exit`); `images` refused as in C2. `cacheReadTokens` is set only when `input_tokens_details` was sent; a completed response whose body then errors keeps its usage (PR #28 fix pass).

**Acceptance check:** the same eleven-case shape as C2 on the OpenAI fixtures, plus: usage fixture `input_tokens 5000, cached_tokens 4000, output_tokens 300` yields `inputTokens 1000, cacheReadTokens 4000, outputTokens 300`; the sent body's schema has every payload key in `required`, `image_concept` nullable and `anyOf` where shared has `oneOf`; a response with `image_concept: null` yields `structured.result` without that key.

**Boundaries:** As C2.

- [x] Install, spec red, engine green, commit (2026-09-26: `openai` 7.23.0; 14 cases red on the missing module, then green; images guard proved by sabotage. OpenAI streams usage only on the terminal event, so a mid-stream timeout carries none. The spend-limit twin of C2's case is a 429 with `code: insufficient_quota`, never retried. The SDK ends the stream quietly on abort, so the engine reads a missing terminal event after an abort as the timeout.)

### Task C4: the `api` entry installs the engines; one live call per provider through the app

**Files:**
- `app/api/src/engines/api/index.ts`, create: `apiEngines(env = process.env): Partial<Record<EngineName, Engine>>` returning `anthropic` when `ANTHROPIC_API_KEY` is set and `openai` when `OPENAI_API_KEY` is set; a missing key means no engine, and the runner's `RunRefused` says which is missing when a row needs it.
- `app/api/src/main.ts`, modify: `loadEnv()` first (the keys come from `app/api/.env`), then `installEngines({ backend: 'api', engines: apiEngines() })`, then `bootstrap()`.
- `app/api/.env`, no edit by the plan: Kevin adds `ANTHROPIC_API_KEY`; `app/api/src/env.ts`'s comment lists the two keys.
- `app/api/scripts/probe-api-backend.mjs`, create: from `app/api`, against an api started on a second port: creates a scratch idea, `POST /api/ideas/:id/triage`, reads `GET /api/runs/:runId` and the ledger row (`psql`); patches the `triage` api row to `{ engine: 'openai', model: 'gpt-5.6-terra' }` through `PATCH /api/registry/:id`, triages a second scratch idea, reads its run and ledger row, then restores the row to `{ engine: 'anthropic', model: 'claude-haiku-4-5' }`; promotes the first idea to a T3 scratch post, `POST /api/posts/:id/draft`, waits on `GET /api/runs/:id` until terminal, reads its ledger row; then deletes the scratch post and discards both ideas. Exits non-zero if any run is not `succeeded` or the registry row was not restored.
- `app/api/test/no-cli-in-prod.spec.ts`, unchanged; it must still pass with the SDKs in the trace (they are allowed).

**Work:** The second port, from `app/api`, is `PORT=3002 devserve run --port 3002 -- npm run start:api`; the dev api on 3001 stays as it is. Both providers go through the runner and the ledger, because B3 made `engine` patchable within a backend; the probe restores what it patched in a `finally`.

**Acceptance check:** `node scripts/probe-api-backend.mjs` prints three `succeeded` runs, two `anthropic` and one `openai`, each with `tokens_input`, `tokens_output` and `cost_usd` numeric and the cache fields present where the provider reported them. `npm test -w api` green. The spend is a few cents; say the number in the hand-off.

**Boundaries:** Scratch records only; post #9 untouched. `main.dev.ts` untouched.

- [x] `apiEngines`, `main.ts`, the probe script (2026-09-26: the key map lives in `engines/api/keys.ts` so the runner names a missing key without loading the SDKs; a runner test proves the refusal says `ANTHROPIC_API_KEY is not set`. The probe restores the triage row to the values it read, not to hard-coded ones. `npm test -w api` 76 files / 465 green with `no-cli-in-prod.spec.ts`; typecheck 0)
- [x] Kevin sets the key; start the second-port api with `devserve`; run the probe; record the numbers; commit (2026-09-26, both keys already in `.env`. `start:api` on 3002 by `devserve`; probe PASS. Run 137 triage `anthropic · claude-haiku-4-5`: 1,137 in, 0 cache write, 0 cache read, 75 out, $0.001512; the Constitution is under Haiku's 4,096-token cache minimum, so nothing cached. Run 138 triage `openai · gpt-5.6-terra`: 742 in, 0 cached, 174 out, $0.001612, priced at the Haiku row's 1 / 5 because the probe patches only engine and model, so that figure is not OpenAI's price. Run 139 draft T3 `anthropic · claude-sonnet-5`: 882 in, 2,404 cache write, 0 read, 548 out, $0.013254 (882×2 + 2,404×2.5 + 548×10 per million). Every ledger row carries a provider request id. Total $0.016378. Scratch ideas 21 and 22 discarded, post deleted, posts back to 4, row 12 back on Haiku.)

### Task C5: R12 re-run on the ledger

**Files:**
- `app/api/scripts/r12-measure.mjs`, create: against the second-port `api` instance, with scratch records: two triages of the same scratch idea 30 seconds apart (the second reads the cache only if the Constitution clears Haiku's 4096-token minimum; the note records whether it did), then three scratch posts promoted at T3, T2 and T1 from three scratch ideas, one draft each, and one refine on the T1 within five minutes of its draft (the cache-read case); prints a table from `ledger` joined to `runs`: kind, tier, model, tokens_input, tokens_cache_write, tokens_cache_read, tokens_output, cost_usd, and the cache-read share of input on the refine; then deletes the three posts and discards the four ideas.
- `docs/research/2026-09-24-r12-cost-per-post.md`, modify: append "## Measured on the api backend (slice 2, <date>)" with the table, the cache observation, and the recomputed text cost per Tier at the registry's prices (draft + triage + one refine for T1; draft + triage for T2 and T3), then the sentence that images and the Inputs-plus-Research shape (about 80k input tokens, ADR 0023) remain unmeasured until slices 10 and 9, so decision 6's ceiling stays provisional.
- `docs/research/2026-09-24-forge-v2-research-memo.md`, modify: the R12 row's "Input tokens unmeasured" becomes "text input tokens measured on 2026-09-XX (slice 2); images and the Inputs shape pending".

**Acceptance check:** the script prints the table with no null token cells on the six text runs; the note's per-Tier numbers recompute from the table (show the arithmetic in the note: for each run `cost = in/1e6*2 + cw/1e6*2.5 + cr/1e6*0.2 + out/1e6*10` on Sonnet rows, `in/1e6*1 + cw/1e6*1.25 + cr/1e6*0.1 + out/1e6*5` on the Haiku row, and the sum per Tier). `unslop` on the note. The spend is roughly six Sonnet calls at 5k output tokens each, on the order of $0.50; say the real figure. Scratch records gone afterwards (`select count(*) from posts` back to what it was).

**Boundaries:** No registry edits. No model swaps for the measurement; the rows as seeded are the measurement's subject. Post #9 untouched.

- [x] Script, run, table, cleanup (2026-09-26: PASS on the second attempt, runs 145 to 150, no null token cells, posts 4 before and after, $0.066967. The first attempt stopped on a 409: the draft's run row goes terminal a moment before the post leaves `drafting`, so the script now waits for `draft_ready` before the refine. Its five runs, 140 to 144, succeeded and were cleaned up. Triage never caches, being under Haiku's 4,096 minimum; every draft read a 2,404-token prefix.)
- [x] Note and memo edits, `unslop`, commit (per-Tier text, warm cache: T3 $0.0078, T2 $0.0144, T1 $0.0464; cold first draft +$0.0055)
- [x] Open the PR against `ai-staging`; hand-off with the manual test steps (below) and the warning that cli cost figures from 0021 on are not comparable to the estimates on older runs (2026-09-26: PR #28, stacked on #27. Route smoke PASS; manual steps 3, 4's refusal half, 5, 6 and 7 driven by the executor; 1, 2 and 4's draft half are Kevin's.)

---

## Review and hand-off

One review wave ran on this document (record below); the fix pass is applied. The fixed move: `/handoff`, `/clear`, `/model opus`, `pickup` on A1. Five sessions: A; B1 to B3; B4 to B6; B7 to B9; C.

At the end of Part C the PR rundown for Kevin's manual pass:
1. `/settings` shows the models panel with 13 rows, `cli` first; change `draft_t3`'s model on the cli row to `claude-sonnet-5` and back; each save shows `saved ✓`; the engine select on a cli row offers `claude` and `codex` only.
2. With the dev api (`npm run start:dev`, cli backend), make a scratch post (idea, promote at T3) and click draft: the run succeeds, `/runs` shows it with `claude · <model>`, tokens `N in · M cached · K out` (or `N in / K out` when the CLI reported no cache fields), and a `cost` figure; the ledger has one row for it. Delete the post, discard the idea.
3. Open post #9 and click draft: a 409 saying the post has 4 inputs and that inputs return with slice 9. Its four Inputs are still listed.
4. Attach a pasted text to post #5, click draft: the same 409 with 1 input; remove the input; draft again succeeds. Restore #5's body from its revision list.
5. `POST /api/posts/5/draft` with `{"research": true}` from curl answers 400.
6. On the second-port api (`start:api`, `ANTHROPIC_API_KEY` set), the probe script's three runs appear in `/runs` as `anthropic · claude-haiku-4-5`, `openai · gpt-5.6-terra` and `anthropic · claude-sonnet-5`, cache tokens visible on the run detail where the provider reported them.
7. `npm test -w api` from `app/` includes `no-cli-in-prod.spec.ts` green.

Only Kevin's GREEN closes it.

## Review record (2026-09-24, two Claude legs, one fix pass)

Blockers. **1** (post #9 holds every live Input) fixed: #9 is undraftable until slice 9 (narrowings 4 and 5, Global constraints, A4's CLAUDE.md trap, manual step 3); every live draft runs on a scratch post, procedure under "Vocabulary"; B9, C4, C5 rewritten on it; the T1/T2/T3 measurement promotes three scratch ideas at those tiers, since `PatchMetaSchema` has no tier. **2** (A1 deleted what A2's targets import) fixed: the tasks are swapped, staging goes first (A1) and the walker second (A2); `contracts.spec.ts` and the contract probe are in A1's file list. **3** (live database behind the drizzle schema from B2) fixed: 0021 is expand-only and is applied live at the end of B2, with the route smoke as the check.

Major. **4** (image cost $0) fixed: `usage.images` is the runner's field, set to 1 per successful managed image call and to `finalize`'s returned count for the raster lane, before pricing; the raster lane settles after `finalize`; two image rows in the matrix; a `costUsd` vector shows the codex session total pricing at nothing. **5** (red windows, unlisted files) fixed: B1 is additive and touches neither `RunEngineName` nor `contract.ts`; the helpers die in B5 and the settings keys in B9; the probe is trimmed in A1; `image-gen.spec.ts`'s import is in B4; B5 keeps a one-task `prompt` compatibility field so the api suite is green, and B6 deletes it; `contracts.spec.ts` and `pricing.spec.ts` are listed in A1, A2, B5 and B9; the preamble states the red window as B4 only. **6** (Part B too big for one sitting) fixed: three sessions at green points, B1 to B3, B4 to B6, B7 to B9; the registry services (now B3) precede the cli package (now B4) as suggested. **7** (managed run's own row) fixed in B5: the parent resolves the row for its own kind and a hybrid on `api` is refused at launch. **8** (cli failure paths drop usage) fixed in B4: `interpret` parses usage on `is_error` and non-zero exit, codex parses the session total on every path, four engine-cli tests. **9** (OpenAI engine without a caller; Google narrowing) fixed: `engine` is patchable within a backend (B1 schema, B3 service and http test, B8 select), the probe runs both providers through the runner and ledger; narrowing 2 is flagged for Kevin's explicit OK in the header.

Minor, fixed: one price rule (list prices on every row, the settings row's pricing read once for the backfill; narrowing 7; the backfill fixture uses a non-default model to prove the `models` map is read); `ledger.exit` is the call's outcome (B2, matrix rows for invalid_output and finalize-threw); the run row takes the final attempt only and managed calls share the attempt loop (narrowing 6, B5); settle before the terminal write, with a `settled` flag (B5); `APIConnectionTimeoutError` to `timeout` with a first-byte case, text blocks concatenated, thinking's share of `max_tokens` noted, one `output_config` object (C2); 529/503 to `quota` recorded as narrowing 9 and in ADR 0019's note; C1's wording on zod's bounds; tool cap, result cost and image output recorded as narrowing 10; invariant 6's wording in B9; `Number()` at `RunsService` for every row-returning method and `Omit` on `RunDetailDto` (B5); the trace test builds into `dist-trace/` with a 120 s hook timeout and a fallback if `--path` ignores `outDir` (B7); `loadEnv()` before `apiEngines()` (C4); scratch cleanup uses `DELETE /posts/:id` and `PATCH /ideas/:id { status: 'discarded' }`, and post #5 restores from its revisions; the "dead keys stay" sentence corrected (A1, B9); A1 moves only `ToolCall` and `StagedManifestEntry`; B6 names `image-compose.service.ts:50` for `assembleImageHtmlPrompt`, adds the html lane and the variator, and proves byte identity for seven builders including an exemplar-less draft; `ModelRowPatchSchema` is the one name and `EngineBackend`/`EngineName` live in `engine.ts` only (B1); `RunsLog.tsx` dropped from B8 and the `SettingsDto` note corrected; `oneOf` stays in shared and the rewrite moves to `toProviderSchema`, so B1's probe is gone (narrowing 3); slice-10 uniqueness and numeric rounding noted (narrowing 12); the cost-comparability warning is in B9's CLAUDE.md line and C5's hand-off.

Rejected: "CONTEXT.md has no Retired language section": it does, at `CONTEXT.md:299`; A4 moves the four terms into it. "Assumptions cite R12 for Opus 4.8 multipliers": the multipliers are R13 item 4 and the Opus 4.8 base price is the claude-api model table; the Assumptions now say so.

## PR #28 review record (2026-09-27, three legs, one fix pass)

The legs: `reviewer` on Opus 5.5 at xhigh, run locally; codex `gpt-6-astra` at xhigh; `reviewer` on Fable in a claude.ai/code session. A second Fable session consolidated the three into one fix pass. The records are kept at tag `review-pr28` under `docs/reviews/pr28/` (the branch `review/pr28-fable` that carried them is deleted): the two cloud prompts, `other-legs.md`, `01-fable-review.findings.md` and `fix-pass.md`, which holds the reasoning behind each ruling. No leg found a blocker or a major.

Fixed, one commit each, in this order:
- L: `@forge/engine-cli` loses its `prepare`, so `npm ci` on a fresh clone installs.
- D: the codex child is scrubbed of both provider keys and `DATABASE_URL`, like the claude child (C0 amended).
- B: an Anthropic 503 is `quota` and retried like a 529, because narrowing 9 wins over C2's text (C2 amended).
- F: a `retry-after` of 0 is retried and an absent header is not (C2 amended).
- C, E, M: every failure path of the api engines keeps the request id, the text that arrived and the usage of a completed response. OpenAI reports no cache read when the provider sent no detail (C2 and C3 amended).
- A: a provider refusal takes the runner's decline path, schema or not, so `runs.declined` and the tell lint are set (B5 and C2 amended, matrix row added).
- H, N: the matrix covers a managed call's engine throw and its retry, closes its modules, and pins the seeded prices as hand-computed literals.
- I, J: a registry price fits `numeric(12,6)`, and `google` leaves the api engine list until slice 10 (narrowing 2 and B1 amended).
- G: a mixed managed run's `N total` counts its cache tokens (B8 amended).
- P: narrowing 7's cost sentence corrected (this commit).

Deferred:
- F2, the HTTP-date form of `retry-after`: to #24. Both providers send seconds.
- K, `restoreOptionals` taking a null-first branch: to slice 10, the first slice that adds a union. The mechanism is real, but no envelope shared emits today reaches it.
- R, eight forward seams: to #24 under "Slice 2 seams". The text for Kevin to paste is below.

Rejected:
- O, a node with both `oneOf` and `anyOf`: zod-to-json-schema never emits one.
- Q1, usage lost on a cli timeout or an OpenAI mid-stream abort: there is no usage to record.
- Q2, `ledger.exit` differing by who detected the invalid output: B2's definition holds.
- Q3, the retry capped at 30 s: by design (narrowing 6).

Text for #24, to paste under a new heading "Slice 2 seams (from the PR #28 review)":

- Slice 3: `LedgerService.record()` is fail-open and takes `runId: number`. A Budget reservation needs a write that can refuse, and a row that can exist before a run.
- Slice 3: `PATCH /api/registry/:id` edits one global table with no guard. Per-Tenant pages need an owner and a role check.
- Slice 3: `ledger.run_id` is `ON DELETE SET NULL`. The tenant backfill needs `tenant_id` on the ledger itself, not a join through runs.
- Slice 3: `installed.ts:11` defaults to the `cli` backend when no entry installs engines. A production container that never calls `installEngines` gets cli with no engines and an unhelpful message.
- Slice 8: the ledger's `category` is derived from the run kind (`image_gen | image_refine` → image). Other image-producing kinds will need it set by the caller.
- Slice 10: a registry row's model and prices are independent fields, so a model change keeps the old prices. Run 138 was mispriced this way.
- Slice 10: the runner sets `images: 1` per managed image call. `ImageGenerator` should report its own count.
- Slice 10: `model_registry`'s unique `(task, backend)` blocks two image generators on `api` (narrowing 12).
- F2: a `retry-after` given as an HTTP date is not retried.
- K: `restoreOptionals` can pick a `{type:'null'}` branch for a non-null value when null comes first in a union. Fix it with slice 10's first new union, tested on a real envelope.
