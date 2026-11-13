import { useState } from 'react';
import type { PostDto } from '../api/client';
import { useDeletePost } from '../api/hooks';
import { fmtDateTime } from '../lib/format';
import { Button, ErrorNote } from './primitives';

/** D3's two sentences, verbatim. The published one names what the app cannot undo on LinkedIn. */
function costOf(post: PostDto): string {
  return post.publishedAt
    ? `This post was published on ${fmtDateTime(post.publishedAt)}. Deleting removes its record here, `
      + 'not on LinkedIn: a later export of it will land unlinked, and the goal and streak for that week '
      + 'are recounted without it. Its runs stay in the log, and the idea goes back to the backlog.'
    : 'Deleting removes this post, its revisions, inputs and images. Its runs stay in the log, and the '
      + 'idea it came from goes back to the backlog.';
}

/**
 * Two clicks: `delete post`, then the sentence that says the cost beside `delete for good` and
 * `keep`. The Workspace renders it only on a post that is not measured, so the api's measured
 * refusal is never offered as a button. `busy` disables the trigger and `delete for good` alike,
 * because the confirm block can stay open while a run is launched from the band beside it. A
 * refusal the app cannot see ahead, a run already in flight, reaches the operator through the note.
 */
export function DeletePost({ post, busy }: { post: PostDto; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const del = useDeletePost(post.id);

  if (!confirming) {
    return (
      <Button variant="subtle" disabled={busy || del.isPending}
        title={busy ? 'a run is in flight' : ''}
        onClick={() => setConfirming(true)}>
        delete post
      </Button>
    );
  }
  // basis-full wraps the block onto its own line inside the band's flex-wrap row.
  return (
    <div className="basis-full pt-2">
      <p className="text-[13px] text-soft">{costOf(post)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy || del.isPending}
          title={busy ? 'a run is in flight' : ''}
          onClick={() => del.mutate()}>
          {del.isPending ? 'deleting…' : 'delete for good'}
        </Button>
        <Button variant="subtle" disabled={del.isPending}
          onClick={() => { del.reset(); setConfirming(false); }}>
          keep
        </Button>
      </div>
      {del.error && <div className="mt-2"><ErrorNote label="delete failed">{del.error.message}</ErrorNote></div>}
    </div>
  );
}
