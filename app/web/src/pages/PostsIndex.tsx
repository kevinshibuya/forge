import { useState } from 'react';
import { Link } from 'react-router';
import { usePosts } from '../api/hooks';
import type { PostDto } from '../api/client';
import { fmtDateOnly } from '../lib/format';
import { EmptyState, ErrorNote, PageHeader, StatusPill, TierBadge } from '../ui/primitives';
import { Reveal, Skeleton, SkeletonList } from '../ui/skeleton';

const FILTERS = ['all', 'queued', 'drafting', 'draft_ready', 'approved', 'published', 'measured'] as const;

export default function PostsIndex() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const posts = usePosts(filter === 'all' ? undefined : filter);
  return (
    <div className="max-w-[880px]">
      <PageHeader label="the posts" />
      <div className="mb-4 flex flex-wrap gap-2 rounded-card border border-hairline bg-paper p-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1 text-[11px] font-medium lowercase transition-colors ${
              filter === f ? 'border-ink bg-ink text-bone' : 'border-hairline bg-bone text-soft hover:bg-paper'}`}>
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>
      {posts.isError && (
        <ErrorNote label="posts failed to load">{(posts.error as Error).message}</ErrorNote>
      )}
      {!posts.isError && posts.data?.length === 0 && (
        <EmptyState>
          {filter === 'all'
            ? 'no posts yet — promote an idea from the backlog to start one'
            : `no ${filter.replace('_', ' ')} posts right now — pick another filter above`}
        </EmptyState>
      )}
      <Reveal
        pending={posts.isPending}
        skeleton={<SkeletonList probe="skeleton-posts" row={<PostRowSkeleton />} />}
      >
      <div className="flex flex-col gap-2">
        {posts.data?.map((p) => (
          <Link key={p.id} to={`/posts/${p.id}`}
            className="flex items-center gap-3 rounded-card border border-hairline bg-paper px-4 py-3 hover:bg-bone">
            <Thumb post={p} />
            <span className="text-[11px] tabular-nums text-soft">#{p.id}</span>
            <TierBadge tier={p.tier} />
            <StatusPill status={p.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{title(p)}</span>
              {p.ideaText && p.hook && (
                <span className="block truncate text-[12px] text-soft">{p.hook}</span>
              )}
            </span>
            {p.scheduledDate && (
              <span className="text-[12px] tabular-nums lowercase text-soft">
                {fmtDateOnly(p.scheduledDate)}{p.scheduledTime && ` · ${p.scheduledTime.slice(0, 5)}`}
              </span>
            )}
          </Link>
        ))}
      </div>
      </Reveal>
    </div>
  );
}

/** The row's title: the idea the post came from, else its hook, else nothing to say. */
function title(p: PostDto): string {
  const t = p.ideaText ?? p.hook ?? 'untitled';
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

/** The selected image at 44px, or the same frame on paper carrying the tier code. The tier code
 *  is a data code, exempt from the lowercase rule. */
function Thumb({ post }: { post: PostDto }) {
  if (post.selectedAsset) {
    return (
      <img alt="" src={`/api/images/${post.selectedAsset.id}/file`}
        className="h-11 w-11 shrink-0 rounded-sm border border-hairline object-cover" />
    );
  }
  return (
    <div data-probe="thumb-placeholder"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-hairline bg-paper text-[11px] text-soft">
      {post.tier}
    </div>
  );
}

/** Mirrors the real row: same box, same cell order, ~50px tall. */
function PostRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-hairline bg-paper px-4 py-3">
      <Skeleton className="h-11 w-11 rounded-sm" />
      <Skeleton className="h-4 w-8" />
      <Skeleton className="h-6 w-8 rounded-pill" />
      <Skeleton className="h-6 w-20 rounded-pill" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
