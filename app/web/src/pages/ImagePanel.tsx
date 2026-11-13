import { useEffect, useState, type ReactNode } from 'react';
import {
  IMAGE_PAGE_SIZE, useBreakdown, useDeleteAsset, useGenerateHybrid, useImagesPage,
  usePatchPost, useReferenceCandidates, useReviewImages, useSelectAsset,
  useSetReference, useSettings,
  type AssetSort, type OriginFilter,
} from '../api/hooks';
import type { AssetDto, PostDto } from '../api/client';
import { elideDataUris, fmtDateTime, fmtNum } from '../lib/format';
import { CanvasEditor } from '../ui/canvas-editor';
import { Lightbox, Overlay } from '../ui/lightbox';
import { useRunWatcher } from '../ui/run-watcher';
import { StepRow } from '../ui/run-detail';
import { Button, Card, EmptyState, ErrorNote, Field, Panel, Pill, Spinner, inputCls } from '../ui/primitives';
import { Skeleton } from '../ui/skeleton';

const REFERENCE_TOOLTIP = 'Reference for hybrid runs — background composition/palette anchor';

const SORTS: { value: AssetSort; label: string }[] = [
  { value: 'newest', label: 'newest' },
  { value: 'oldest', label: 'oldest' },
];
const ORIGIN_FILTERS: { value: OriginFilter; label: string }[] = [
  { value: 'all', label: 'all' },
  { value: 'generated', label: 'generated' },
  { value: 'bg_refined', label: 'refined' },
  { value: 'canvas_edited', label: 'edited' },
];
/** Non-`generated` assets carry their derivation on the card; `generated` needs no badge. */
const ORIGIN_VERB: Record<string, string> = { bg_refined: 'refined', canvas_edited: 'edited' };

type BreakdownView = 'prompt' | 'conversation';

/** Rounded filter chip — the app's toolbar idiom (see RunsLog's kind filter). */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-3.5 py-1 text-[11px] font-medium lowercase transition-colors ${
        active ? 'border-ink bg-ink text-bone' : 'border-hairline bg-bone text-soft hover:bg-paper'}`}>
      {children}
    </button>
  );
}

/**
 * Provenance for one candidate. Two views over the same fetch: the augmented brief the candidate
 * was generated from, and the engine conversation that produced it. Assets that predate the
 * lineage columns have neither — they say so rather than showing a guess.
 */
function BreakdownModal({ assetId, view, onClose }: { assetId: number; view: BreakdownView; onClose: () => void }) {
  const breakdown = useBreakdown(assetId);
  return (
    <Overlay onClose={onClose}
      className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-y-auto rounded-card border border-hairline bg-paper p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">{view} · candidate #{assetId}</div>
        {breakdown.data?.runId != null && (
          <span className="text-[11px] tabular-nums lowercase text-soft">run #{breakdown.data.runId}</span>
        )}
      </div>
      {breakdown.isLoading && <Spinner />}
      {breakdown.isError && <ErrorNote label="could not load the breakdown">{breakdown.error.message}</ErrorNote>}
      {breakdown.data && view === 'prompt' && (
        breakdown.data.generationPrompt
          ? (
            <pre className="whitespace-pre-wrap rounded-card border border-hairline bg-bone p-3 font-mono text-[11px] leading-relaxed text-soft">
              {elideDataUris(breakdown.data.generationPrompt)}
            </pre>
          )
          : <EmptyState>no prompt recorded — this candidate predates lineage capture</EmptyState>
      )}
      {breakdown.data && view === 'conversation' && (
        breakdown.data.steps.length > 0
          ? <ul className="flex flex-col gap-2">{breakdown.data.steps.map((s) => <StepRow key={s.seq} step={s} />)}</ul>
          : <EmptyState>no conversation recorded — this candidate predates lineage capture</EmptyState>
      )}
    </Overlay>
  );
}

function ImageCard({ c, busy, isReference, menuOpen, onToggleMenu, onBreakdown, onSelect, onDelete, onOpen, onUseAsReference, onEdit }: {
  c: AssetDto; busy: boolean; isReference: boolean; menuOpen: boolean;
  onToggleMenu: () => void; onBreakdown: (view: BreakdownView) => void;
  onSelect: () => void; onDelete: () => void; onOpen: () => void;
  onUseAsReference?: () => void; onEdit?: () => void;
}) {
  const verb = ORIGIN_VERB[c.origin];
  return (
    <Card className={`p-2 ${c.isSelected ? 'border-salmon ring-1 ring-salmon' : ''} ${isReference ? 'ring-2 ring-mint' : ''}`}>
      <button className="block w-full transition-opacity hover:opacity-80" onClick={onOpen} title="open full size">
        <img src={`/api/images/${c.id}/file`} alt={`${c.lane} candidate`} className="aspect-square w-full rounded-card object-cover" />
      </button>
      <div className="mt-2 flex items-center justify-between gap-1">
        <Pill className="bg-bone">{c.lane}</Pill>
        {c.reviewScore !== null && (
          <span className="text-[12px] font-semibold tabular-nums text-soft" title={c.reviewNotes ?? ''}>{c.reviewScore}</span>
        )}
      </div>
      {/* Provenance, not a status: salmon is reserved for failure / internal spend (§4 check 3),
          and reading it here made a perfectly healthy derived candidate look like an error. */}
      {verb && (
        <div className="mt-1 text-[10px] lowercase text-soft">
          {c.sourceAssetId !== null ? `${verb} from #${c.sourceAssetId}` : verb}
        </div>
      )}
      {c.reviewNotes && <p className="mt-1 line-clamp-2 text-[11px] text-soft">{c.reviewNotes}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        <Button variant={c.isSelected ? 'solid' : 'subtle'} disabled={busy} onClick={onSelect}>{c.isSelected ? 'selected ✓' : 'select'}</Button>
        <Button variant="subtle" disabled={busy} onClick={onDelete}>delete</Button>
        {onEdit && (
          <Button variant="subtle" disabled={busy} onClick={onEdit}
            title="move, restyle and retype this image's text layer — and patch its background">
            edit
          </Button>
        )}
        {onUseAsReference && (
          <Button variant="subtle" disabled={busy || isReference} onClick={onUseAsReference} title={REFERENCE_TOOLTIP}>
            {isReference ? 'reference ✓' : 'use as reference'}
          </Button>
        )}
        <div className="relative">
          <Button variant="subtle" onClick={onToggleMenu}>breakdown</Button>
          {menuOpen && (
            <>
              {/* transparent catcher: the next click anywhere dismisses the menu */}
              <div className="fixed inset-0 z-40" onClick={onToggleMenu} />
              <div className="absolute bottom-full right-0 z-50 mb-1 w-36 overflow-hidden rounded-card border border-hairline bg-paper">
                {(['prompt', 'conversation'] as const).map((view) => (
                  <button key={view} onClick={() => onBreakdown(view)}
                    className="block w-full px-3 py-2 text-left text-[12px] lowercase text-soft hover:bg-bone">
                    {view}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 text-[10px] lowercase tabular-nums text-soft">{fmtDateTime(c.createdAt)}</div>
    </Card>
  );
}

/** Small overlay grid of borrowable reference candidates (this post's hybrid outputs + other posts' selected hybrid winners). */
function BorrowPicker({ postId, onPick, onClose }: { postId: number; onPick: (assetId: number) => void; onClose: () => void }) {
  const candidates = useReferenceCandidates(postId);
  return (
    <Overlay onClose={onClose} className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-card border border-hairline bg-paper p-4">
      <div className="mb-3 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">borrow a reference</div>
      {candidates.isError && (
        <ErrorNote label="could not load borrowable references">{candidates.error.message}</ErrorNote>
      )}
      {!candidates.isPending && !candidates.isError && (candidates.data ?? []).length === 0 && (
        <EmptyState>no hybrid candidates yet — generate a hybrid batch to borrow from</EmptyState>
      )}
      {candidates.isPending && (
        <div data-probe="skeleton-reference-picker" className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-square w-full rounded-card" />)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {(candidates.data ?? []).map((c) => (
          <button key={c.assetId} onClick={() => onPick(c.assetId)} title={c.isSelected ? 'selected winner' : 'candidate'}>
            <img src={`/api/images/${c.assetId}/file`} alt="reference candidate"
              className="aspect-square w-full rounded-card border border-hairline object-cover hover:border-ink" />
          </button>
        ))}
      </div>
    </Overlay>
  );
}

export default function ImagePanel({ postId, post, imageConcept }: { postId: number; post: PostDto; imageConcept: string }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<AssetSort>('newest');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const images = useImagesPage(postId, { page, sort, origin });
  const { isPostBusy, notifyLaunched } = useRunWatcher();

  // Prose brief, persisted on posts.image_prompt. While the user hasn't typed, mirror the server
  // value — or prefill client-side from the draft's image_concept when the server has none.
  const serverPrompt = post.imagePrompt ?? '';
  const [brief, setBrief] = useState(serverPrompt !== '' ? serverPrompt : imageConcept);
  const [briefTouched, setBriefTouched] = useState(false);
  useEffect(() => {
    if (!briefTouched) setBrief(serverPrompt !== '' ? serverPrompt : imageConcept);
  }, [briefTouched, serverPrompt, imageConcept]);
  const patchPost = usePatchPost(postId);
  const briefDirty = brief !== serverPrompt;

  const settings = useSettings();
  const [batch, setBatch] = useState(4);
  const [batchTouched, setBatchTouched] = useState(false);
  useEffect(() => {
    if (!batchTouched && settings.data) setBatch(settings.data.imageCandidateBatch);
  }, [batchTouched, settings.data]);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [breakdownFor, setBreakdownFor] = useState<{ assetId: number; view: BreakdownView } | null>(null);
  /**
   * The canvas editor's target — the single entry point for changing a candidate. Background
   * refine lives inside it (its own toolbar toggle), so a patch is seen on the canvas it belongs
   * to and saves as one candidate with whatever else was edited.
   */
  const [editFor, setEditFor] = useState<AssetDto | null>(null);

  const hybrid = useGenerateHybrid(postId);
  const review = useReviewImages(postId);
  const select = useSelectAsset(postId);
  const del = useDeleteAsset(postId);
  const setReference = useSetReference(postId);

  // Busy from the launch mutation OR the global watcher seeing a live run for this post —
  // preserves the double-click guard; completion/invalidation live in the run console.
  const launching = hybrid.isPending || review.isPending;
  const busy = launching || isPostBusy(postId);
  const onLaunched = (res: { runId: number }) => notifyLaunched(res.runId, postId);
  const onHybridLaunched = (res: { runIds: number[] }) => res.runIds.forEach((id) => notifyLaunched(id, postId));

  const candidates = images.data?.items ?? [];
  const total = images.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / IMAGE_PAGE_SIZE));
  // Deleting the last candidate on the final page would otherwise strand the pager past the end.
  // Guarded on fresh (non-placeholder) data so a mid-flight page change isn't clamped back.
  useEffect(() => {
    if (images.isSuccess && !images.isPlaceholderData && page > pageCount) setPage(pageCount);
  }, [images.isSuccess, images.isPlaceholderData, page, pageCount]);
  // A filtered or paged view is a window, not the whole set — the winner is often off-page, so the
  // hero comes from the envelope's own lookup rather than from the current page's rows.
  const selected = images.data?.selected ?? null;
  // The hero opens the lightbox too, and its asset may be off-page — fall back to it by id.
  const lightboxAsset = candidates.find((c) => c.id === lightboxId)
    ?? (selected?.id === lightboxId ? selected : null);
  const err = [patchPost, hybrid, review, select, del, setReference].find((m) => m.isError)?.error?.message ?? null;
  const canGenerate = brief.trim() !== '' && !busy;
  const pickReference = (assetId: number) => { setReference.mutate(assetId); setBorrowOpen(false); };
  // Filter/sort changes re-window the set — any page but the first would be meaningless.
  const changeSort = (next: AssetSort) => { setSort(next); setPage(1); };
  const changeOrigin = (next: OriginFilter) => { setOrigin(next); setPage(1); };
  const hasCandidateView = total > 0 || origin !== 'all';

  return (
    <Panel className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">image lanes</div>
        <div className="flex items-center gap-2">
          {post.referenceAssetId != null && (
            <span className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-bone pl-1 pr-2 text-[11px] font-medium lowercase text-soft"
              title={REFERENCE_TOOLTIP}>
              <img src={`/api/images/${post.referenceAssetId}/file`} alt="reference" className="size-5 rounded-full object-cover" />
              ref
              {/* In flight the affordance goes, not the glyph: opacity-40 on a soft glyph left
                  nothing readable in either theme (§4 check 4). */}
              <button aria-label="clear reference" disabled={setReference.isPending}
                onClick={() => setReference.mutate(null)}
                className="text-soft transition-colors hover:text-ink disabled:cursor-not-allowed disabled:hover:text-soft">×</button>
            </span>
          )}
          <Button variant="subtle" disabled={busy} onClick={() => setBorrowOpen(true)}>borrow…</Button>
        </div>
      </div>

      <Field label="image brief (prose)">
        <textarea className={`${inputCls} min-h-28`} value={brief}
          onChange={(e) => { setBriefTouched(true); setBrief(e.target.value); }}
          placeholder="describe the image in plain prose — concept, mood, composition" />
      </Field>
      <div className="mt-2">
        <Button variant="subtle" disabled={!briefDirty || patchPost.isPending}
          onClick={() => patchPost.mutate({ imagePrompt: brief }, { onSuccess: () => setBriefTouched(false) })}>
          {patchPost.isPending ? 'saving…' : briefDirty ? 'save brief' : 'saved'}
        </Button>
      </div>
      {imageConcept !== '' && (
        <p className="mt-1 text-[11px] lowercase text-soft">latest draft's image concept: {imageConcept}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button disabled={!canGenerate} onClick={() => hybrid.mutate({ brief, batch }, { onSuccess: onHybridLaunched })}>generate hybrid</Button>
          <input type="number" min={1} max={10} value={batch} title="batch size (1-10)" disabled={busy}
            onChange={(e) => { setBatchTouched(true); setBatch(Math.min(10, Math.max(1, Number(e.target.value)))); }}
            className="w-14 rounded-card border border-hairline bg-paper px-2 py-1 text-[13px] tabular-nums text-ink" />
        </div>
        {hasCandidateView && (
          <Button variant="subtle" disabled={busy} onClick={() => review.mutate(undefined, { onSuccess: onLaunched })}>score these</Button>
        )}
      </div>

      {err && <div className="mt-3"><ErrorNote label="image action failed">{err}</ErrorNote></div>}

      {selected && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">selected image</div>
          <button className="block w-full transition-opacity hover:opacity-80" onClick={() => setLightboxId(selected.id)} title="open full size">
            <img src={`/api/images/${selected.id}/file`} alt="selected image"
              className="w-full rounded-card border border-salmon object-contain" />
          </button>
        </div>
      )}

      {hasCandidateView && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
            {SORTS.map((s) => <Chip key={s.value} active={sort === s.value} onClick={() => changeSort(s.value)}>{s.label}</Chip>)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ORIGIN_FILTERS.map((o) => <Chip key={o.value} active={origin === o.value} onClick={() => changeOrigin(o.value)}>{o.label}</Chip>)}
          </div>
          <span className="ml-auto text-[11px] lowercase tabular-nums text-soft">{fmtNum(total)} candidate{total === 1 ? '' : 's'}</span>
        </div>
      )}

      {images.isError && (
        <div className="mt-3"><ErrorNote label="candidates failed to load">{images.error.message}</ErrorNote></div>
      )}

      {candidates.length > 0 ? (
        <div className={`mt-3 grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 ${images.isPlaceholderData ? 'opacity-50' : ''}`}>
          {candidates.map((c) => (
            <ImageCard key={c.id} c={c} busy={busy} isReference={c.id === post.referenceAssetId}
              menuOpen={menuFor === c.id}
              onToggleMenu={() => setMenuFor((cur) => (cur === c.id ? null : c.id))}
              onBreakdown={(view) => { setMenuFor(null); setBreakdownFor({ assetId: c.id, view }); }}
              onSelect={() => select.mutate(c.id)}
              onDelete={() => del.mutate(c.id)}
              onOpen={() => setLightboxId(c.id)}
              onUseAsReference={c.lane === 'hybrid' ? () => setReference.mutate(c.id) : undefined}
              onEdit={c.lane === 'hybrid' ? () => setEditFor(c) : undefined} />
          ))}
        </div>
      ) : images.isPending ? (
        <div data-probe="skeleton-image-grid" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-card border border-hairline bg-paper p-2">
              <Skeleton className="aspect-square w-full rounded-card" />
              <div className="mt-2 flex gap-2">
                <Skeleton className="h-5 w-14 rounded-pill" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="mt-2 h-3 w-full" />
              <div className="mt-2 flex gap-1">
                {[0, 1, 2].map((j) => <Skeleton key={j} className="h-6 w-14 rounded-pill" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !busy && !images.isError && (
          <div className="mt-3">
            <EmptyState>
              {origin === 'all'
                ? 'no candidates yet — write a brief and generate a hybrid batch above'
                : 'no candidates match this filter — pick another origin above'}
            </EmptyState>
          </div>
        )
      )}

      {total > IMAGE_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button variant="subtle" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← prev</Button>
          <span className="text-[12px] lowercase tabular-nums text-soft">page {page} of {pageCount}</span>
          <Button variant="subtle" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>next →</Button>
        </div>
      )}

      {lightboxAsset && (
        <Lightbox src={`/api/images/${lightboxAsset.id}/file`} alt={`${lightboxAsset.lane} candidate`}
          onClose={() => setLightboxId(null)}>
          <Button variant={lightboxAsset.isSelected ? 'solid' : 'subtle'} disabled={busy}
            onClick={() => select.mutate(lightboxAsset.id)}>
            {lightboxAsset.isSelected ? 'selected ✓' : 'select'}
          </Button>
          <Button variant="subtle" disabled={busy}
            onClick={() => { del.mutate(lightboxAsset.id); setLightboxId(null); }}>
            delete
          </Button>
          {/* the hero opens here and is often off-page, so this is its only edit entry point */}
          {lightboxAsset.lane === 'hybrid' && (
            <Button variant="subtle" disabled={busy}
              onClick={() => { setEditFor(lightboxAsset); setLightboxId(null); }}>
              edit
            </Button>
          )}
        </Lightbox>
      )}

      {/* The save is synchronous — no run to notify; the mutation invalidates ['images', postId]
          itself. A refine launched from inside notifies the watcher on its own. */}
      {editFor && <CanvasEditor asset={editFor} onClose={() => setEditFor(null)} />}

      {breakdownFor && (
        <BreakdownModal assetId={breakdownFor.assetId} view={breakdownFor.view} onClose={() => setBreakdownFor(null)} />
      )}

      {borrowOpen && (
        <BorrowPicker postId={postId} onPick={pickReference} onClose={() => setBorrowOpen(false)} />
      )}
    </Panel>
  );
}
