# Post identity is a typed URN, and linking matches on URL equality first

`dim_post` is keyed on the full typed URN (`urn:li:share:<N>`), but matching an export row to an app post tries **exact `linkedin_url` equality first** and URN comparison only second. The reason is a measured fact rather than a preference: the same LinkedIn post carries *different numeric ids under different URN types* — one real post appeared as activity id `9990000000000000106` in an export filename and share id `9990000000000000101` in its URL (both ids are placeholders here) — while the slug URL stays identical across export types.

Source: `docs/superpowers/specs/2026-08-11-analytics-ingestion-design.md` (§Decision 3, §Post identity). The redesign came out of a review finding recorded in `HANDOFF-analytics-ingestion.archived.md` (§What worked): the originally-planned `activity[:-](\d+)` regex matched **zero** real URLs, because every real export and stored post URL uses the `-share-` or `-ugcPost-` slug form.

## Consequences

- Dedupe order on every `dim_post` upsert is fixed and must not be reordered: exact URL equality, then `post_urn`, then insert. `activity_urn` / `share_urn` / `ugc_urn` are filled in as each becomes known.
- Ingestion never fails for lack of an app post. An unmatched export lands unlinked with a warning; re-uploading the file once the post has its URL heals the link.
- The general lesson the record attaches to this: verify a regex against the real files, never against a remembered URL shape.
