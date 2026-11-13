# A Run keeps its rendered prompt and a context row beside it; deletion terms are met by redaction

Invariant 6 says every model call is an audited Run with its full prompt and output. The S4 grill had
proposed replacing the rendered prompt with "a template plus a structured context row" so that
deleting platform data a term requires deleted (LinkedIn's Marketing API Terms, 10 days) would be a row
delete. Both review legs showed the template idea does not reconstruct anything: templates are code
with no version, the Constitution's parts (persona, Style docs, rules) are edited in place with no
snapshot, an Exemplar id points at a body that changes on every save, and three readers depend on the
rendered text today (`web/src/ui/run-detail.tsx:290`, `images/image-refine.service.ts:197`,
`runs.service.ts`). Decision: the Run keeps `runs.prompt`, the text the model saw, as the audit, and
gains a `run_contexts` row beside it holding the structured fields (Exemplar Revision ids and their
stats, a hash of the Constitution snapshot, the Inputs' text, the fetched Research text, the Idea text
and the refine instruction at run time). A LinkedIn deletion request is met by a redaction job that
nulls the stats fields in `run_contexts` and the stats block in the rendered prompt, which is a
delimited section the prompt builder writes for exactly this reason. Invariant 6 stands as written,
with "context row, usage with cache tokens and cost, on every exit path" added. This changes the answer
Kevin gave in S4 round 1 Q2; he ratified the change on 2026-09-24.

Source: the S4 review (both legs, findings on reconstructability and readers of `runs.prompt`);
`docs/research/2026-09-24-r10-linkedin.md` items 12-13.

## Considered

Template plus context as the only record, with `constitution_versions` (a hash-addressed snapshot
written on every persona, Style doc or rule change), a template version in code, and Exemplar Revision
ids. Reconstructable in principle, at the cost of versioning three things that are edited freely today
and migrating every reader, to make one deletion path simpler. Rejected as the first build; the hash of
the Constitution snapshot is kept in the context row because it is cheap and makes "which rules were
active" answerable without it.

Storing no prompt and keeping only the output. Rejected: it breaks the invariant outright and every
run-detail surface.

## Consequences

Usage is recorded on every exit path, including timeouts and failures, because the API bills them;
today the runner records usage only on success or decline.

`run_steps.prompt` (the hybrid lane's plan step) keeps the same rule.

The ledger row for a Run survives Tenant deletion anonymised; the Run's prompt and context do not.

The brief's inherited constraint "every model call is still an audited Run with its full prompt and
output" is unchanged, and the glossary's Run (v2) entry is rewritten to match this ADR.
