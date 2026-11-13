# Analytics arrive as hand-exported spreadsheets, not through the LinkedIn API

LinkedIn analytics reach the app as xlsx files the operator downloads by hand, roughly a minute of clicking per week; everything after the file hits disk is automated. The two alternatives were both closed off, and this is recorded so nobody re-litigates it.

Source: `docs/superpowers/specs/2026-08-10-overhaul-roadmap.md` (§Phase-2 contract — "Why this shape (so future-me doesn't re-litigate it)").

## Considered options

- **The official API** (`memberCreatorPostAnalytics` + `memberFollowersCount`, Community Management API). Gated behind a registered legal org, a commercial use case, a business email, an app verified by a super admin of the org's LinkedIn Page, and a Dev→Standard tier promotion requiring a narrated screencast. Not reachable for a solo personal project.
- **Automating the export button** (headless browser or extension). LinkedIn's User Agreement §8.2 bans "bots or other unauthorized automated methods to access the Services" and names browser plugins and add-ons explicitly. The clause governs the *access method*, so owning the data does not help. The exposure is contract breach rather than a crime — cf. hiQ v. LinkedIn, won on CFAA, lost on breach of the UA — and the consequence is a ban on the exact account holding the history.
- **The "Get a copy of your data" archive.** Contains no analytics at all: `Reactions.csv` and `Comments.csv` record what the account gave others. No impressions, no reach, no demographics.

## Consequences

The manual click is the only ToS surface, and it is zero. If API access ever opens, the canonical fact tables are the adapter target (see ADR-0007).

## Amended for v2 (2026-09-24)

Every gate this ADR named is still there, confirmed from the current docs (`docs/research/2026-09-24-r10-linkedin.md`): a registered legal organization, a business email, an app verified by a Page super admin, a Development tier capped at 500 calls per app per day, and a Standard tier LinkedIn grants "at its discretion". What changed is the product, not the facts: a company can apply, and v2 is a hosted product with a company behind it. So the API path opens for **analytics only**, under Community Management approval, for the members the per-app cap can serve (about thirty at five metrics per post on days 1, 3, 7 and 28, with a weekly `me` aggregate), and the export stays the primary LinkedIn analytics path until Standard tier lands, which it may never do. History import stays the export: the scope that lists a member's posts (`r_member_social`) is restricted and outside the Community Management grant. The export parser, pt-BR only today, gains a per-locale label map. The fact tables gain a platform on `dim_post` and a pull provenance beside the Source file, and a pull's idempotency key is `(post, metric, as_of)`, not a file hash. Option 2 of the considered list, automating the export button, stays closed for the same §8.2 reason.
