# forge

A local, single-user app that runs one person's LinkedIn content. Domain language lives in `CONTEXT.md`, decisions in `docs/adr/`, parked work in GitHub issue #24. This file holds the traps: each one has bitten at least once.

## Layout

- The npm workspaces are under `app/` (`api` NestJS, `web` React and Vite, `shared` types). The repo root has no `package.json`: every script runs from `app/`.
- New plans go to `docs/plans/`, specs to `docs/superpowers/specs/`.
- `seed-content.spec.ts` compares appendices A to C of `docs/superpowers/specs/2026-09-02-style-docs-and-research-runs-design.md` byte for byte. That file keeps its path and its appendices.
- `research/` and `post-assets/idle-transaction.*` are seed inputs (the image pair is built by `app/api/scripts/make-seed-asset.mjs`), and post #1's selected asset points into `post-assets/`.
- `HANDOFF*.md` and `.claude/RESUME.md` are in `.git/info/exclude`: local notes, never part of a PR.

## Servers and databases

- api on 3001, web on 5174. Port 5173 is the operator's portfolio: check the page `<title>` says forge before debugging a smoke.
- `npm run start:dev` boots the api on the `cli` backend through `src/main.dev.ts`; `src/main.ts` is the `api` backend and never imports `@forge/engine-cli`. The trace test builds into `dist-trace/`, never into the `dist/` the watcher writes.
- `forge-db` runs in docker on 5433. Live database `forge`; test database `postgres://forge:forge@localhost:5433/forge_test`.
- `npm run db:migrate` and every script under `app/api/scripts` hit the **live** database when `DATABASE_URL` is unset, and `app/api/.env` sets none.
- When docker stops, every api spec fails on connection refused. Check `docker info` before reading a mass failure as a regression, and keep the whole log of a failed run: read the error, not the tally.
- One api vitest process at a time. `fileParallelism: false` covers the files inside one run; two runs against the shared `forge_test` destroy each other's fixtures.

## Migrations

- Hand-written `.sql` plus a journal entry (`version: "7"`, `when` in epoch ms and greater than the previous entry's, statements split by `--> statement-breakpoint`). No `drizzle-kit generate`.
- Applied migrations are frozen. The SQL generators refuse to overwrite a file without `--force`.
- postgres.js binds a JS string against `::jsonb` as a JSON string: pass `sql.json(...)`.

## Records

- Post #5 is the sacrificial record: `route-smoke.mjs` mutates it and restores it.
- Post #9 holds the four live Inputs and is not draftable until slice 9; a live draft runs on a scratch post (idea, promote, run, delete the post, discard the idea).
- Posts #1 and #4 and the settings row stay as they are. After any settings work, `scheduling.weeklyGoal` reads `null`.
- There is no `GET /api/ideas/:id`. Read an idea with `GET /ideas?promotedPostId=<postId>`; assuming the singular route once blanked post #9's idea.
- A draft that returns `sources: []` clears a hand-curated list, so a live check that adds a Source by hand runs after the draft.
- Registry rows are data: a model, an engine within its backend, or a price changes on `/settings`, not in a migration. `PATCH /api/registry/:id` is the route.
- A cli run's cost from slice 2 on counts cache tokens at list prices. It is not comparable to the estimate runs showed before 0021. Cli runs made between 0021 and 2026-09-26 also carry about 22k tokens of Claude Code's own prompt each; `claudeArgv`'s lean flags removed that, so compare cli costs only from run 135 on.

## Gates

- `noUncheckedIndexedAccess` is on, so vitest green is not typecheck green. `npm run typecheck` from `app/` is its own gate.
- `npm run lint -w web` stands at 0 errors and 0 warnings.
- The api loads `@forge/shared` from `dist/`. After a shared change, `npm run build -w shared` and an api restart come before any live check counts; `npm run typecheck` and `npm test -w api` rebuild it themselves.
- `@forge/engine-cli` builds before the api the same way `@forge/shared` does. It has no `prepare`: on a fresh clone it would compile before `@forge/shared` has a `dist/` and `npm ci` rolls back. The api's pre-scripts and the root `typecheck` and `test` build it, and `probe-output-contract.mjs` needs one build first.
- Palette and UI changes pass every gate while unreadable. Reading the rendered page, in both themes, is the check.
- An api-edge test goes through `createNestApplication` plus supertest. A controller method called directly skips its `ZodBody` pipe and its interceptors.
- A test whose assertion is an absence is proved once by sabotage: remove the guard, watch it go red, restore.
- `route-smoke.mjs` runs from `app/api` with `WEB_URL=http://localhost:5174`. Its `<title>` guard is load-bearing.

## Code

- Composite keys in source use `\x1f`, never a literal NUL, which makes the file binary to git and invisible to grep. `test/ingest-regressions.spec.ts` guards it.
- A block comment that contains `**/*` closes at its `*/`.
- drizzle returns `numeric` columns as strings. `RunsService`, the registry and the ledger convert with `Number()`; the analytics readers cast with `::float8` in the select. A new reader does one of the two.
- Pricing is a display estimate, never billing truth.
- A blur handler that commits an add-row belongs on the row container, guarded with `!e.currentTarget.contains(e.relatedTarget)`. `onDragLeave` needs the same guard or the drop zone flickers.

## Deliberate design, kept as is

`WarnBanner` stays hueless. No accent rail on a left edge: it is a banned design tell. `ImageCard` keeps its two rings. Band 3, salmon spend-by-kind beside mint cost-vs-return, carries both hues with the list as the unit; the contradiction is in its spec, not the code. The Workspace toolbar is full-bleed bone. `ErrorNote.label` is required and its lead stays `font-semibold`. `Metric` takes `string | null` and never classifies by display string.

## Delegated agents

- The codex sandbox has no docker, no port 5433 and no Chromium. Its mass test failures there are not real; re-run the suite yourself.
- macOS has no `timeout` binary. Give `codex-run.sh` its limit through the Bash tool's timeout.
- `codex-computer-use` drives the browser well and reports badly: ask for JSON with raw counts and booleans, and read the `observations.json` it writes.
- A Bash command that merely contains the words of a PR-merge command trips the merge hook. Write docs with the file tools.
