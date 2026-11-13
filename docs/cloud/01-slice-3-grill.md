# Cloud prompt 1: grill forge v2 slice 3 (tenancy schema and roles)

Open a Claude Code session on claude.ai/code, repository `kevinshibuya/forge`, branch `feat/forge-v2-slice-3`, model Fable. Paste one line:

```
Check out branch feat/forge-v2-slice-3, pull, and follow docs/cloud/01-slice-3-grill.md
```

---

You are running a design grill with Kevin for slice 3 of forge v2. The grill ends with its decisions committed to this branch. It does not end with a plan: the plan is a separate session with its own prompt, `docs/cloud/02-slice-3-plan.md`, which the local session writes after you push.

## What this clone lacks, and the rules those files would have given you

This is a fresh clone. Kevin's global instructions, his user-level skills (`grilling`, `domain-modeling`, `writing-plans`), his agents and codex are missing. There is no `app/api/.env`, no docker, no Postgres on 5433 and no browser, and the egress policy blocks vendor pages. The project `CLAUDE.md` is present. Read it before anything else, because it lists the traps.

What the missing files would have told you:

**Grilling.**
- Map the work as a design tree. Every decision branches into the decisions that hang off it.
- Work in rounds. Each round asks the whole frontier: every decision whose prerequisites are already settled. A question that depends on another question still open in the same round waits for a later round.
- Ask each round as plain text, numbered, each question with your recommended answer:

  ```
  ❓ **Q1** - **<title>**: <question, with the options>

  ➡️ <your recommended answer, and why>

  ---
  ```

- Kevin types his answers. `AskUserQuestion` is only for approving a finished design or draft, never for the design questions themselves.
- Facts are your job, decisions are Kevin's. Read the code and the docs yourself before asking. Never ask Kevin something the tree can answer.
- The grill ends when the frontier is empty. Don't write the closing record until Kevin confirms you share the same understanding.

**Domain modelling, as you go.**
- `CONTEXT.md` is a glossary and nothing else. No implementation details. Follow the entry format already in it (term, definition, `_Avoid_:` list). Its "Tenancy" section holds v2 terms settled in the brief but not yet in code.
- When Kevin uses a term that conflicts with the glossary, say so at once. When a term is fuzzy, propose a precise one.
- Test the relationships with concrete edge-case scenarios, and check what Kevin says against the code. Surface every contradiction.
- Add or sharpen a term in `CONTEXT.md` when it settles, not in a batch at the end. Slice 3 will likely need Tenant member, the Budget's reservation and settlement, and a word for the tenant setting a request runs under. Check the existing `_Avoid_:` lists first.
- Offer an ADR (`docs/adr/`, next free number, same shape as the existing ones) only when a decision meets all three tests. It is hard to reverse. A later reader would find it surprising without the context. It came out of a real trade-off. If one test fails, skip the ADR.

**Kevin's standing rules that apply here.**
- English for everything written down.
- Prefer the simpler solution, and propose it when one exists.
- Nothing gets implemented in this session. You edit nothing under `app/`. Your output is decisions.
- Write plainly: short sentences, no filler, no inflated words, no em dashes.
- Invent no facts. When something can't be checked from the clone (the live database's contents, a Supabase setting, a price), say so and mark it open.
- TypeScript: no `any` unless nothing else compiles.

## Where things stand

- Slice 2 (engine v2, the model registry and the ledger) merged as PR #28. Its plan is `docs/plans/2026-09-24-forge-v2-slice-2-engine-v2.md`. The "Spec conflicts and narrowings" section and the "PR #28 review record" at the end show how this project records a departure from the spec.
- There is no CNPJ for now (Kevin, 2026-09-26). The beta runs plan B: X first, LinkedIn on reminders and xlsx. Slice 1, the LinkedIn application pack, is parked.
- Slice 3 has no spec work, branch commits or plan yet, apart from this prompt.

## What slice 3 is

Read these, in this order:

1. The slice graph, item 3: `docs/superpowers/specs/2026-09-24-forge-v2-architecture.md:321-325`. Read the dependencies paragraph after the list too, and the invariants (line 256 on). Invariant 1 puts the Budget reservation in slice 3.
2. ADR 0020, `docs/adr/0020-tenancy-sign-in-and-where-things-live.md`. Slice 3 is its first half: "RLS that can go red", "Keys and deletes", "Ownership". Sign-in, connections and hosting belong to slice 7 and later.
3. `docs/research/2026-09-24-r15-tenancy-auth-hosting.md`, for the evidence behind ADR 0020.
4. The localhost audit, `docs/research/2026-09-24-forge-v2-research-memo.md`, item S4-Q5 (line 144) and row 10 of the findings table (line 183). Slice 3 carries "the localhost audit's fixes".
5. `CONTEXT.md`, then the code the slice touches: `app/api/src/db/` (schema, `migrate.ts`, the migrations and journal), `app/api/src/runner/`, `app/api/src/ledger/`, `app/api/src/registry/`, `app/api/src/engines/installed.ts`, and the test helpers under `app/api/test/`.

The slice's list, as the spec states it: `tenants`, `tenant_members`, `voices`; `tenant_id` and `voice_id` on every table with the tenant 1 backfill; every collided key rekeyed; the three database roles in docker, CI and Supabase; RLS with `FORCE`; the request transaction; a test fixture that runs every spec as a Tenant; the sabotage test; the HNSW index dropped; `style_docs` and `playbook_rules.voice_id`; `budgets` and the reservation path; the localhost audit's fixes.

**Four seams from slice 2 land here.** They come from the PR #28 review, recorded on issue #24 ("Slice 2 seams"):

- `LedgerService.record()` fails open and takes `runId: number`. A Budget reservation needs a write that can refuse, and a row that can exist before a run.
- `PATCH /api/registry/:id` edits one global table with no guard. A per-Tenant page needs an owner and a role check.
- `ledger.run_id` is `ON DELETE SET NULL`. The tenant backfill needs `tenant_id` on the ledger itself, not a join through runs.
- `app/api/src/engines/installed.ts:11` falls back to the `cli` backend when no entry installs engines. A production container that never calls `installEngines` gets cli with no engines and an unhelpful refusal.

The reasoning behind each seam is at tag `review-pr28`: `git show review-pr28:docs/reviews/pr28/fix-pass.md`.

## The first frontier

Open with a short summary of where things stand. Don't redo work this file already records. Then ask the first round. It should cover at least these, plus anything your reading turns up:

- **Scope and size.** The list above is large. Is it one plan or two (for example, schema, roles and RLS first, then the Budget and the seams)? What does "done" mean for slice 3: which gates, and which live checks?
- **Roles now or later.** CI arrives in slice 13 and Supabase in slice 12. Do the three roles land in docker only for now, with CI and Supabase carried as notes? Check what `app/docker-compose.yml` and `app/api/src/db/migrate.ts` do today.
- **Where a request's tenant comes from before sign-in.** Better Auth arrives in slice 7. Until then, how does a request know its Tenant and Voice (a fixed tenant 1, a config value, a header)? And what replaces it in slice 7?
- **The request transaction in NestJS.** One transaction per request opened with `set_config('app.tenant_id', $1, true)`. How does a drizzle service get that transaction (AsyncLocalStorage, an explicit argument, a request-scoped provider)? How does the runner's short per-row transaction reuse the same mechanism? Recommend one, with the code that shows why.
- **Tenant-owned against Voice-owned, table by table.** ADR 0020 names the split. Draw it against the actual schema, and flag each table whose owner is unclear (`settings`, the analytics facts, `source_files`, the ledger, `runs` of each kind).
- **The Budget.** The ceiling for tenant 1, the month boundary and time zone, what a reservation holds (the estimate from the registry, or a fixed hold per Run kind), what happens on the `cli` backend (invariant 1 says "in production"), and how refusal reaches the UI.
- **The registry.** It stays global (ADR 0020 exempts `model_registry`). What does the guard on `PATCH /api/registry/:id` check when there is no sign-in yet?
- **The localhost audit.** Which of its items land in slice 3 (the 12 MB body limit against ADR 0020's 1 MB cap, hand-fixed stuck runs, tolerated orphan uploads, retrieval serving deleted posts), and which wait for the slice that needs them?
- **The web surface.** Each slice ships its own web surface. What is slice 3's, if any (a refused-by-Budget failure strip, a Budget read-out)?

`app/docker-compose.yml` pins `pgvector/pgvector:pg16`, so the column list in `ON DELETE SET NULL (col)` (Postgres 15 and later) is available for the composite foreign keys ADR 0020 describes.

## Output and wrap-up

Commit to `feat/forge-v2-slice-3` as the grill goes, and push after each commit:

- `CONTEXT.md` terms, when they settle;
- any ADRs, when Kevin approves them;
- the closing record, `docs/plans/2026-09-27-slice-3-grill.md` (use the real date), holding:
  - the settled design tree, with each decision and who made it;
  - every departure from the spec or ADR 0020, numbered, in the shape of the slice 2 plan's "Spec conflicts and narrowings";
  - the open items, each marked with what would settle it;
  - the facts you checked, with `file:line`, so the planner does not re-derive them;
  - the first tasks, in order, as the planner's starting point.

Commit messages are one line in the form `docs(grill): <what>`. Never push to `ai-staging` or `main`, and don't open a PR. Don't edit the spec or an existing ADR in place. A change to either goes into the closing record as a departure, and the plan carries it.

When the record is pushed, tell Kevin it is done and that the plan prompt comes next, written by his local session.
