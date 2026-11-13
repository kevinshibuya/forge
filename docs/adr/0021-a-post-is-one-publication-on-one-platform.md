# A Post is one publication on one Platform

`posts` carried `body_linkedin` and `body_x` and one status, schedule, hook and image between them, which was a second platform kept "schema-ready" and never given a state of its own. v2 gives a Post a `platform` and drops `body_x`. Promote takes a Platform; an Idea may promote to several Posts, and **Sibling posts** from one Idea know each other. **Adapt** derives a Post on one Platform from an existing Post on another, on demand from that Post's Workspace, carrying its edited and approved body as the source and optionally its selected Candidate as a Reference image for the target's aspect. **Form** is the shape on the Platform (`linkedin`: `text`, `text_image`, `document`; `x`: `post`, `post_image`, `thread`) and picks the Output contract; Tier stays the platform-independent weight class, suggests a Form and selects the model.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` decisions 10, 11, 12, 18; S4 round
2 Q26 (the cross-Voice rule).

## Siblings in the schema

`ideas.promoted_post_id` is one foreign key (`schema.ts:35`) and cannot hold several siblings; Post
delete flips the Idea back on it (`posts.service.ts:336`), which with two siblings would return an Idea
to the backlog while its other Post still exists. The pointer reverses: `posts.idea_id` (set null on
Idea delete), siblings are `posts WHERE idea_id = ?`, and an Idea returns to the backlog only when its
last Post is deleted (ADR 0018, amended). The `GET /ideas?promotedPostId` read in CLAUDE.md's traps
becomes a read by `idea_id` on the Post.

## Considered

One Post with N per-platform variants, each with body, hook, schedule, status, URL and measurements. Rejected: it moves the state machine, the Planner, the Workspace and the analytics link onto a new entity for no gain over siblings, and the glossary already said a Post is "the unit of publication", which happens on one platform.

Promote creating N sibling Posts up front. Rejected: the draft on the first platform is where the thinking happens, adapting an approved body beats a parallel draft from the Idea, and Ideas that never earn a second platform cost nothing extra.

## Consequences

`document` is modelled and out of v1; when it enters it is LinkedIn's Documents API (PDF), because organic carousels do not exist in the Posts API.

forge never posts the same body twice to one Platform. Adapt targets a different Platform by definition; a second Post for the same Platform under another Voice derived from the same source, whether by Adapt through an intermediate Platform or by Promote from a shared Idea, is refused: it is "substantially similar content across multiple accounts", which X's policy bans, and refusing it now costs nothing.

A Post gains `platform_post_id`, `platform_url` (renamed from `linkedin_url`), `body` (renamed from `body_linkedin`) and `segments` for threads; the renames are expand steps with the old columns kept for one release.

Triage may suggest a Platform; Promote requires one. The Planner and the Workspace show a Post's Platform and Form, and the Workspace shows the Platform's own rendering of the body before approval, which is X's consent rule.

Tenant 1's four posts migrate as `linkedin` Posts; `body_x` was never populated.
