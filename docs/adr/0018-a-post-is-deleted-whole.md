# A post is deleted whole; its audit and its measurements are not the post's to take

A post can now be deleted from its Workspace. What it owns goes with it, what only records it stays, and a measured post or one with a run in flight refuses.

Source: `docs/superpowers/specs/2026-09-11-post-delete-design.md`, decisions D1 to D10.

## Decision

Deleting a post removes the post and everything it owns: its revisions, its inputs and their
stored copies, its assets and their files, its embeddings, and the promotion that made it, which
returns the idea to the backlog: `triaged` when it carries a tier, `new` otherwise. Two things
survive with the pointer cleared:
the runs, because every model call stays an audited run whether or not what it was for still
exists, and the analytics dimension, because an export's facts are LinkedIn's record, not the
post's. A measured post refuses deletion for the same reason it refuses every other write: its
facts are the one thing on a post that cannot be regenerated, and with the post gone there is no
URL left to heal them against. The app has no escape hatch; when one is needed it is a `force`
option on the service reached through a script, never the route, because a bare `DELETE` in psql
leaves the embeddings, the idea and the directories behind. A published post may be deleted: the
record of a publication is the operator's to keep or drop, and refusing would force the app to
keep records of what was unpublished. The weekly goal and the streak are recounted from the posts
that exist, as they already are when the goal changes; a later export of a deleted post lands
unlinked and stays so, which the confirm step says before the operator commits. A run in flight
refuses deletion too. The ownership is declared in the schema (`ON DELETE cascade` on the owned
tables, `set null` on the run log and the dimension) so nothing but the app's own transaction can
leave an orphan; what the schema cannot say, the polymorphic embeddings, the idea's status, the two
directories on disk, the service does inside the same lock `updateBody` takes, with the
directories removed after commit, because an unreachable orphan directory is the cheaper failure
and post ids are never reused.

## Considered

Soft delete. Rejected because every reader would have to filter deleted rows forever.

Refusing to delete a published post. Rejected because the app would keep records of posts the operator took down.

A publication ledger, so the streak could never move. Rejected because it adds a second source of truth for a badge, and it would record a publication the operator says did not happen.

Cascading the run log. Rejected because it breaks invariant 6: every model call stays an audited run.

A sweeper for orphan directories. Rejected because it deletes files on the operator's disk under a configurable root, to reclaim bytes nobody can reach.

## Consequences

A run left `running` by an api crash blocks its post's deletion until someone fixes the row by hand. The 409 names the run, so the operator knows which one.

Another post that pinned one of the deleted post's hybrid candidates as its reference loses the pin without a word. That already happens when the candidate itself is deleted.

Cost by post is lost for a deleted post's runs. The runs keep their cost; they no longer say which post it was spent on.

A crash between the commit and the directory removal leaves an orphan directory under `uploads/inputs/` or `uploads/assets/`. The app never reaches it again, because post ids are never reused, and nothing sweeps it.

A `DELETE` in psql keeps referential integrity through the cascades, but it leaves the embeddings, the idea's status and both directories behind.

The row lock does not close two races, and both are accepted here so a later slice can close them.

- A draft launch commits its `drafting` status before it inserts its run. A delete in that gap finds no running run, passes both gates and succeeds. The launch then fails loudly on the run's foreign key. No orphan run row can exist.
- `updateBody`, `patchMeta`, the retry poller and a finished draft all write their embedding after their own transaction has committed. A delete that lands during the provider's embed call purges first, and the vector lands after it. Retrieval reads `embeddings` without joining `posts`, so it serves the deleted post's text to the next prompt. The fix is a join on `posts` in `retrieval.similar` that drops a post hit with no row. That also covers a psql delete and a crash between commit and purge. It is not built here, and issue #24 tracks it.

An input attach or a canvas edit is not a run, so the in-flight gate does not see it. One that lands during a delete can recreate `uploads/inputs/<id>/` or `uploads/assets/<id>/` after the removal. The result is an orphan directory of the kind this ADR already accepts. An image launch has the same window: `launchHybrid` makes its candidate directory before its run row exists, and a batch has a gap between its variator run and its hybrid runs. A delete that completes inside either gap can leave the new directory behind, and the launch then fails on the run's foreign key. It is the orphan this ADR already accepts.

## Amended for v2 (2026-09-24)

Four things this ADR accepted were accepted because one operator sat at the machine, and a hosted Tenant changes each. A **measured Post is deletable**: its facts stay as unlinked rows, the loss this ADR refused, because with outcomes arriving through an API every published Post is measured within a day and a ban would make nothing published deletable; the reason recorded above (facts cannot be regenerated and no URL is left to heal them against) is still true, and v2 accepts the loss knowingly. **Orphan objects are swept**: the sweeper rejected above now runs nightly against object storage, because an orphan holds a Tenant's data and the data promise (brief decision 24) requires it gone; it deletes objects with no owning row and nothing else. **A stuck `running` Run is reaped**: a job marks any Run past its timeout as `timeout` and cleans its files, so no deletion waits for a hand. **Retrieval joins `posts`**: the similarity query filters by Tenant and Voice and drops a hit with no row, closing the race this ADR left to issue #24. Tenant deletion is this ADR at a larger grain: `DELETE … WHERE tenant_id` through the cascades, the storage prefix purged, X tokens revoked, sub-processors told, on the per-source timelines the brief records. With siblings (ADR 0021) the Idea's return to the backlog happens only when its last Post is deleted, and the pointer that says so is `posts.idea_id`, not `ideas.promoted_post_id`.
