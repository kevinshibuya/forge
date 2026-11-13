import { useEffect, useId } from 'react';
import type { PostDto } from '../../api/client';
import { useLinkPost, usePosts } from '../../api/hooks';
import { ErrorNote, TierBadge } from '../primitives';
import { Skeleton, SkeletonList } from '../skeleton';

/**
 * The unlinked-import affordance: an imported `dim_post` row that no app post owns yet gets a
 * small picker of app posts that aren't attached to some other urn.
 *
 * It LINKS and nothing else — it never imports a file and never marks a post measured on the
 * client (the server decides that, from the facts it already holds). Candidates are derived
 * here rather than served: they are just the app's posts minus the ones the board already
 * shows carrying a `postId`.
 */

/** The post's own words if it has any, else its number — never an invented label. */
function candidateLabel(p: PostDto): string {
  const line = p.hook ?? p.bodyLinkedin?.split('\n').find((l) => l.trim() !== '') ?? null;
  return line?.trim() ? line.trim() : `post #${p.id}`;
}

export function AttachPicker({ postUrn, linkedPostIds, onClose }: {
  postUrn: string;
  /** App-post ids the board already shows as attached — the only ones excluded. */
  linkedPostIds: ReadonlySet<number>;
  onClose: () => void;
}) {
  const posts = usePosts();
  const link = useLinkPost();
  const titleId = useId();

  // Escape closes from anywhere: the panel doesn't trap focus, so a panel-scoped handler would
  // die as soon as focus left it (the schedule-popover rule).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = (posts.data ?? []).filter((p) => !linkedPostIds.has(p.id));

  return (
    <>
      {/* click-away sheet: not a button — it covers the viewport, so in the tab order it would
          announce itself as a control. Escape is the keyboard route out. */}
      <div aria-hidden="true" className="fixed inset-0 z-30 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-probe="attach-picker"
        className="absolute right-0 top-full z-40 mt-1 w-[280px] rounded-card border border-hairline bg-paper p-3 text-left"
      >
        <div id={titleId} className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">
          attach to a post
        </div>

        {/* The error arm sits ABOVE both the pending and the zero-candidates arms on purpose: a
            failed load leaves `data` undefined, so `candidates` is empty for a reason that has
            nothing to do with the user's posts, and the copy below would state a falsehood
            about them. */}
        {posts.isError
          ? <ErrorNote label="posts failed to load">{posts.error.message}</ErrorNote>
          : posts.isPending
            ? (
              <SkeletonList
                probe="skeleton-attach-picker"
                gap="gap-1"
                row={(
                  <div className="flex items-center gap-3 py-2">
                    <Skeleton className="h-3 w-8" />
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-7 w-16 rounded-pill" />
                  </div>
                )}
              />
            )
            : candidates.length === 0
              ? <p className="text-[12px] lowercase text-soft">every post is already attached to an import</p>
              : (
                <ul className="max-h-[240px] space-y-1 overflow-y-auto">
                  {candidates.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={link.isPending}
                        onClick={() => link.mutate({ postUrn, postId: p.id }, { onSuccess: onClose })}
                        className="flex w-full items-start gap-2 rounded-card border border-hairline-soft px-2.5 py-2 text-left transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <TierBadge tier={p.tier} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{candidateLabel(p)}</span>
                          <span className="mt-0.5 block text-[11px] lowercase text-soft">{p.status.replace('_', ' ')}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

        {link.isError && (
          <div className="mt-2"><ErrorNote label="could not attach">{(link.error as Error).message}</ErrorNote></div>
        )}
      </div>
    </>
  );
}
