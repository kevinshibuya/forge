# Postgres owns all content and state; the engines are pure prompt→JSON

The system needed one place where a post's text, its history and its status actually live. We chose DB-first: Postgres owns all content and state, headless `claude -p` runs are pure prompt→JSON with tools disabled, and the filesystem holds only rendered PNGs and uploaded spreadsheets. A model call can therefore never write to the repo or the disk, and a post's rollback path is `post_revisions` rather than git.

Source: `docs/superpowers/specs/2026-07-11-forge-content-system-design.md` (§Decisions locked, §Data model, §Runners).

Amended by ADR 0015 (a research run calls tools against a staged snapshot), ADR 0016 (the engine enforces the output contract) and ADR 0017 (a run reads the Post's attached Inputs, stored under `uploads/inputs/`). The DB-first rule stands. "Tools disabled" and "only rendered PNGs and uploaded spreadsheets" no longer do.

## Consequences

- Drafts are diffable and rollbackable only through `post_revisions`. There is no git safety net for content, so every draft, refine and manual save must write a revision row.
- The engine layer stays swappable: a run is a prompt, an output and a result. Since ADR 0016 the output shape is enforced by the engine: a decline is a failed run carrying its reason, and `invalid_output` means a broken contract, not the model talking back.

## Amended for v2 (2026-09-24)

Postgres stays the source of truth for content; what changes is where the bytes beside it live and who may read a row. Candidates, uploaded Inputs and export files move from `uploads/` on the operator's disk to object storage (R2) under a Tenant prefix, referenced by storage key from their rows, and the nightly sweep deletes an object with no owning row (ADR 0020). Every content row gains a Tenant and a Voice, and row-level security under a non-owner role is the backstop on reads. A Run keeps its rendered prompt as the audit and gains a context row beside it (ADR 0026); `post_revisions` stays the only rollback path. The imported history a Voice starts from is its own table, `corpus_items`, not Posts, so the weekly goal, the streak and the Planner never see it.
