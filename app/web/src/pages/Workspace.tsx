import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DraftOutputSchema, extractJson } from '@forge/shared';
import {
  useDraft, useIdeaForPost, usePost, usePostAction, usePostRuns, useRefine, useUpdateBody,
} from '../api/hooks';
import { type RunDto } from '../api/client';
import { durationS, fmtDateOnly, fmtDateTime } from '../lib/format';
import { RUN_DOT } from '../lib/run-status';
import { HashtagEditor } from '../ui/hashtag-editor';
import { SourcesEditor } from '../ui/sources-editor';
import { IdeaEditor } from '../ui/idea-editor';
import { InputsPanel } from '../ui/inputs-panel';
import { DeletePost } from '../ui/delete-post';
import { useRunWatcher } from '../ui/run-watcher';
import { FailureStrip } from '../ui/failure-strip';
import { newestRunOfKinds } from '../ui/run-failure';
import { RunDetailModal } from '../ui/run-detail';
import { SelectionRefine } from '../ui/selection-refine';
import { TellOverlay } from '../ui/tell-overlay';
import {
  Button, Card, EmptyState, ErrorNote, Field, PageHeader, Panel, Pill, StatusPill, TierBadge, WarnBanner, inputCls,
} from '../ui/primitives';
import { FadeIn, Reveal, Skeleton, SkeletonList, useShowedSkeleton } from '../ui/skeleton';
import { WorkspaceSkeleton } from '../ui/workspace-skeleton';
import ImagePanel from './ImagePanel';

function parseImageConcept(run: RunDto | null): string {
  if (!run?.output || run.status !== 'succeeded') return '';
  try { return DraftOutputSchema.parse(extractJson(run.output)).image_concept ?? ''; } catch { return ''; }
}

/** First error message among a set of mutations, so a shared ErrorNote can surface whichever fired. */
function firstMutationError(...mutations: { isError: boolean; error: Error | null }[]): string | null {
  return mutations.find((m) => m.isError)?.error?.message ?? null;
}

const TABS = ['write', 'image', 'history'] as const;
type Tab = (typeof TABS)[number];

export default function Workspace() {
  const id = Number(useParams().id);
  const detail = usePost(id);
  const idea = useIdeaForPost(id);
  const draft = useDraft(id);
  const refine = useRefine(id);
  const saveBody = useUpdateBody(id);
  const action = usePostAction(id);
  const postRuns = usePostRuns(id);
  const { isPostBusy, notifyLaunched } = useRunWatcher();

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [tab, setTab] = useState<Tab>('write');
  const [body, setBody] = useState('');
  const [feedback, setFeedback] = useState('');
  const [publishUrl, setPublishUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [openRun, setOpenRun] = useState<number | null>(null);

  const post = detail.data?.post;
  const latestDraft = detail.data?.latestDraft ?? null;
  const imageConcept = useMemo(() => parseImageConcept(latestDraft), [latestDraft]);
  const serverBody = post?.bodyLinkedin ?? '';
  useEffect(() => { setBody(serverBody); }, [serverBody]);

  // Latched above the guard, so hook order never changes.
  const showedSkeleton = useShowedSkeleton(!post);

  // Same shape as Planner, and no `Reveal`: ~180 lines below dereference `post`, and JSX children
  // are evaluated before Reveal runs, so the guard's narrowing would be lost. Do NOT extract the
  // body into a child component to regain Reveal — that would move every hook above this line.
  if (!post) {
    return (
      <div className="max-w-[880px]">
        <PageHeader label="post workspace" />
        {detail.isError
          ? <ErrorNote label="post failed to load">{detail.error.message}</ErrorNote>
          : <WorkspaceSkeleton />}
      </div>
    );
  }
  const busy = isPostBusy(id) || draft.isPending || refine.isPending;
  // On a measured post nothing is editable. Computed once and handed down, so the panel, the
  // editors, the textarea and its save button cannot disagree about it.
  const readOnly = post.status === 'measured';
  const dirty = body !== serverBody;
  // The strip shows the newest draft or refine run only while it is the failure that stands: a
  // newer succeeded or running run of those kinds retires it. Nothing to dismiss.
  const newestWrite = newestRunOfKinds(postRuns.data ?? [], ['draft', 'refine_selection']);
  const failedWrite = newestWrite && (newestWrite.status === 'failed' || newestWrite.status === 'timeout') ? newestWrite : null;
  const canDraft = post.status === 'queued' || post.status === 'draft_ready';
  const actionError = action.isError ? action.error.message : null;
  const editError = firstMutationError(draft, refine, saveBody);

  const onLaunched = (res: { runId: number; degraded?: boolean }) => {
    notifyLaunched(res.runId, id);
    setDegraded(res.degraded ?? false);
  };
  const launchDraft = () => draft.mutate(undefined, { onSuccess: onLaunched });
  const launchRefine = () =>
    refine.mutate({ feedback }, { onSuccess: (res) => { onLaunched(res); setFeedback(''); } });

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(`${serverBody}\n\n${post.hashtags.join(' ')}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const revisions = detail.data?.revisions ?? [];

  return (
    <div className="max-w-[880px]">
      <PageHeader label="post workspace" />

      <FadeIn enabled={showedSkeleton}>

      {/* Full-bleed sticky band, so `bg-bone` (not §5.1's bounded paper strip): what has to separate
          here is the strip from the PAPER panels scrolling under it, which bone + the hairline does.
          Tried paper — it merged with the panels on scroll and left an unanchored right edge where
          the `-mx-10` bleed ends. Auditor's note (S13): the bounded-card strip would need a layout
          change, which is a spec stay-out for this page. */}
      <div className="sticky top-0 z-40 -mx-10 mb-4 border-b border-hairline bg-bone px-10 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] tabular-nums text-soft">#{post.id}</span>
          <TierBadge tier={post.tier} />
          <StatusPill status={post.status} />
          {post.scheduledDate && (
            <Pill>
              scheduled · {fmtDateOnly(post.scheduledDate)}
              {post.scheduledTime && ` · ${post.scheduledTime.slice(0, 5)}`}
            </Pill>
          )}
          {post.publishedAt && <Pill>published · {fmtDateTime(post.publishedAt)}</Pill>}
          {post.status === 'measured' && (
            <Link className="text-[13px] lowercase text-ink transition-colors hover:text-soft" to={`/analytics/${post.id}`}>view analytics →</Link>
          )}
          <span className="flex-1" />
          {(post.status === 'queued' || post.status === 'draft_ready') && (
            <>
              <Button disabled={busy} onClick={launchDraft}>
                {post.bodyLinkedin ? 're-draft' : 'draft with claude'}
              </Button>
            </>
          )}
          {post.status === 'draft_ready' && (
            <Button variant="ghost" disabled={dirty || action.isPending}
              title={dirty ? 'save the body first' : ''}
              onClick={() => action.mutate({ action: 'approve' })}>
              approve
            </Button>
          )}
          {(post.status === 'approved' || post.status === 'published' || post.status === 'measured') && (
            <Button variant="subtle" onClick={() => void copyToClipboard()}>{copied ? 'copied ✓' : 'copy to clipboard'}</Button>
          )}
          {post.status !== 'measured' && <DeletePost post={post} busy={busy} />}
        </div>
        {actionError && <div className="mt-2"><ErrorNote label="action failed">{actionError}</ErrorNote></div>}
        {editError && <div className="mt-2"><ErrorNote label="update failed">{editError}</ErrorNote></div>}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          // These chips sit directly on the page ground rather than inside a paper strip, so the
          // inactive fill is the raised token — `bg-bone` would have made them fill-less.
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full border px-3.5 py-1 text-[11px] font-medium lowercase transition-colors ${
              tab === t ? 'border-ink bg-ink text-bone' : 'border-hairline bg-paper text-soft hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'write' && (
        <>
          {idea.data && <IdeaEditor idea={idea.data} readOnly={readOnly} />}

          <InputsPanel postId={id} readOnly={readOnly} />

          {degraded && (
            <div className="mb-4">
              <WarnBanner>retrieval was unavailable — this draft used the constitution only (no exemplars)</WarnBanner>
            </div>
          )}
          {failedWrite && !busy && (
            <div className="mb-4">
              <FailureStrip run={failedWrite} {...(canDraft ? { onRelaunch: launchDraft } : {})} />
            </div>
          )}

          <Panel className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">body</div>
              <Button variant="subtle" disabled={!dirty || saveBody.isPending || readOnly} onClick={() => saveBody.mutate({ body })}>
                {saveBody.isPending ? 'saving…' : dirty ? 'save revision' : 'saved'}
              </Button>
            </div>
            {/* The popup is absolutely positioned against this wrapper, which shares the textarea's origin. */}
            <div className="relative">
              <textarea ref={bodyRef} className={`${inputCls} min-h-[420px] font-sans leading-relaxed disabled:opacity-50`} value={body}
                disabled={busy || readOnly} onChange={(e) => setBody(e.target.value)}
                placeholder="no body yet — draft with claude or write by hand" />
              {/* `body` is the local state, so typed edits re-lint live. z-0 under the refine layer. */}
              <TellOverlay textareaRef={bodyRef} text={body} />
              {post.bodyLinkedin && post.status !== 'measured' && (
                <SelectionRefine
                  postId={id} textareaRef={bodyRef} blocked={dirty}
                  saving={saveBody.isPending}
                  onSaveEdits={() => saveBody.mutateAsync({ body }).then(() => undefined)}
                />
              )}
            </div>
            <div className="mt-2">
              <HashtagEditor postId={id} hashtags={post.hashtags} readOnly={readOnly} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <SourcesEditor postId={id} sources={post.sources} readOnly={readOnly} />
            </div>
          </Panel>

          {post.bodyLinkedin && post.status === 'draft_ready' && (
            <Panel className="mb-4">
              <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">refine with feedback</div>
              <div className="flex items-end gap-2">
                <textarea className={`${inputCls} min-h-16 flex-1`} value={feedback}
                  placeholder="e.g. tighten the middle, land the aphorism harder"
                  onChange={(e) => setFeedback(e.target.value)} />
                <Button disabled={!feedback.trim() || busy} onClick={launchRefine}>refine</Button>
              </div>
            </Panel>
          )}

          {post.status === 'approved' && (
            <Panel className="mb-4">
              <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">mark published</div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="linkedin post url">
                    <input className={inputCls} value={publishUrl} placeholder="https://www.linkedin.com/posts/…"
                      onChange={(e) => setPublishUrl(e.target.value)} />
                  </Field>
                </div>
                <Button disabled={!publishUrl.startsWith('http') || action.isPending}
                  onClick={() => action.mutate({ action: 'publish', linkedinUrl: publishUrl })}>
                  mark published
                </Button>
              </div>
            </Panel>
          )}
        </>
      )}

      {tab === 'image' && (
        <ImagePanel postId={id} post={post} imageConcept={imageConcept} />
      )}

      {tab === 'history' && (
        <>
          <Panel className="mb-4">
            <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">revisions</div>
            {revisions.length === 0 && <EmptyState>no revisions yet — save a body edit to keep the first one</EmptyState>}
            <div className="flex flex-col gap-2">
              {revisions.map((rev, i) => (
                <Card key={rev.id} className="flex items-center gap-3">
                  <Pill className="bg-bone">{rev.source}</Pill>
                  {/* Null means the snapshot predates the sources column, so it claims no count. */}
                  {rev.sources !== null && (
                    <span className="text-[11px] tabular-nums text-soft">· {rev.sources.length} sources</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-soft">{rev.body.slice(0, 80)}</span>
                  <span className="text-[11px] tabular-nums text-soft">{fmtDateTime(rev.createdAt)}</span>
                  {i > 0 && (
                    <Button variant="subtle" disabled={action.isPending}
                      onClick={() => action.mutate({ action: 'restore', revId: rev.id })}>restore</Button>
                  )}
                </Card>
              ))}
            </div>
          </Panel>

          <Panel>
            <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">run log</div>
            {postRuns.isError && <ErrorNote label="the run log failed to load">{postRuns.error.message}</ErrorNote>}
            {!postRuns.isError && postRuns.data?.length === 0 && (
              <EmptyState>no runs for this post yet — drafting or refining starts one</EmptyState>
            )}
            <Reveal
              pending={postRuns.isPending}
              skeleton={(
                <SkeletonList
                  rows={3}
                  probe="skeleton-workspace-runs"
                  row={(
                    <div className="flex items-center gap-3 py-2">
                      <Skeleton className="h-3 w-8" />
                      <Skeleton className="h-5 w-16 rounded-pill" />
                      <Skeleton className="h-3 flex-1" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  )}
                />
              )}
            >
            <div className="flex flex-col gap-2">
              {postRuns.data?.map((r) => (
                <button key={r.id} onClick={() => setOpenRun(r.id)}
                  className="flex items-center gap-3 rounded-card border border-hairline bg-paper px-4 py-2 text-left transition-colors hover:bg-bone">
                  <Pill className="bg-bone">
                    <span className={`size-1.5 rounded-full ${RUN_DOT[r.status]}`} />
                    {r.status}
                  </Pill>
                  <span className="text-[13px] lowercase text-soft">{r.kind.replace('_', ' ')}</span>
                  <span className="min-w-0 flex-1" />
                  <span className="text-[11px] tabular-nums text-soft">{fmtDateTime(r.startedAt)}</span>
                  <span className="w-12 text-right text-[11px] tabular-nums text-soft">{durationS(r.startedAt, r.finishedAt)}</span>
                </button>
              ))}
            </div>
            </Reveal>
          </Panel>

          {openRun !== null && <RunDetailModal runId={openRun} onClose={() => setOpenRun(null)} />}
        </>
      )}
      </FadeIn>
    </div>
  );
}
