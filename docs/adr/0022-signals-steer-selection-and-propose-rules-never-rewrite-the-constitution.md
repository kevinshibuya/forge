# Signals steer selection and propose rules; nothing rewrites the Constitution unasked

The founding line, "the operator keeps final say on every rule change", becomes the mechanism of
adaptation. A **Signal** is one observation of how a Voice's owner behaves toward what forge produced,
in four kinds: `edit`, the difference between the last Run's Revision and the `approved` Revision
(Approve writes that Revision, because approval is the event every Post reaches and publishing is not;
a Revision restored after the last Run counts as the approved body, and the diff is still against the
Run's); `instruction`, the text typed into a Refine or Selection refine, which today survives only inside
`runs.prompt`; `verdict`, approve or Discard with an optional reason, the positive row doubling as the
human-review record (who, when, which Revision); `outcome`, a platform metric landing on a published
Post, written whenever a fact lands, by API pull or by export link, so a LinkedIn Voice on the export
path learns too. Two layers may act on them. Silently and reversibly: Exemplar selection prefers the
approved body as the retrievable text and weights neighbours by `verdict` and `outcome`. Explicitly and
approved: a preference inferred from a (draft, edit) pair (CIPHER-style, `docs/research/2026-09-24-r04-learning-from-edits.md`)
or stated in an `instruction` becomes a row in `rule_proposals` the user accepts or rejects, like a
Retro proposal. Never: a rewrite of the persona or a Style doc by the system. Prompt optimisers that
rewrite instructions (GEPA, MIPROv2) are admissible only through the proposal queue.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` decisions 5, 17, 19, 20;
`docs/research/2026-09-24-r03-what-forge-captures.md`.

## What the proposal path must do to be bearable

Classify each edit as style, fact or topic (run kind `edit_classify`) and infer from style edits only;
cap proposals per week; deduplicate against active rules. Without that, factual corrections, which
dominate LinkedIn edits, become proposal fatigue. The path is validated offline on tenant 1's 29
existing manual edits before it is built for anyone else. Every rejection is recorded as well as every
acceptance: a rejected `rule_proposals` row, a Discard, an image patch rejection; `signals` carries a
polymorphic subject (post, revision, proposal, candidate) so each has a home.

## An approved Post that changes is no longer approved

Today `updateBody` and `patchMeta` gate only on `measured`, so an approved body stays editable and would
publish unseen. Any content change to an approved Post (body, hook, hashtags, an accepted selection
refine, a restored Revision, a changed selected Candidate) returns it to `draft_ready` and disarms it,
which keeps the `approve` Revision, the `edit` Signal, the human-review record and X's consent rule all
pointing at the same text.

## Considered

`hook_pick` as a fifth kind. Retired before it was built: the code never proposed a Hook set (the hook is
derived from the body's first line), building one adds a gate before approve, and at beta volume it
yields too few pairs to read. Kevin ratified the replacement by `instruction` on 2026-09-24.

Predicted performance as a shown estimate. Dropped: no method supports it, and an unvalidated number
contradicts the honesty the Draft score rests on.

Fine-tuning per Voice. Rejected on the literature's own grounds: costly, non-scaling per user, and
possibly degrading.

## Consequences

Retro reads Signals as well as measurements, and its trigger becomes "N new measured Posts or a week,
whichever first", per Voice, since measurement now lands within a day of every publish.

Engagement is a weak prior on Exemplar weight only. Nothing in the literature supports more, and for one
author it is noisy and low-n.

What a Run stores, and how deletion terms are met, moved to ADR 0026, where a reader looking for "why is
the prompt stored this way" will find it.

The marketing claim "it learns from every edit you make" is pending until the offline validation says
the inferred preferences are ones Kevin recognises as his.
