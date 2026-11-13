import { useEffect, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { AssetOrigin, ModelRowPatch, Source } from '@forge/shared';
import {
  api, type AssetDto, type AssetPageDto, type BoardDto, type BoardRange, type BreakdownDto,
  type DashboardDto, type EditableHtmlDto,
  type EligibilityDto, type IdeaDto,
  type ImageBatchLaunchDto, type ImageLaunchDto, type InputPreview, type LaunchDto, type LinkResultDto, type ModelRowDto,
  type PostInputDto,
  type OverviewDto, type OverviewWindow,
  type PatchedBgDto,
  type PlannerDto, type PlannerStreamDto, type PostAnalyticsDto, type PostDetailDto, type PostDto, type ProposalDto,
  type ReferenceCandidateDto,
  type RefineSelectionProposalDto, type RuleDto,
  type RunDetailDto, type RunDto, type SettingsDto,
  type TriageResultDto, type Tier,
} from './client';

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly unknown[][]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
}

// --- query options -------------------------------------------------------
/**
 * One factory per prefetchable query, so the key and the fetch are written ONCE. The shell's
 * nav prefetch (`ui/shell.tsx`) and the hook below it must produce byte-identical keys or the
 * warm-up populates a cache entry the page never reads.
 */
export const dashboardQuery = () =>
  queryOptions({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard') });
export const ideasQuery = (status?: string) =>
  queryOptions({
    queryKey: ['ideas', status ?? 'all'],
    queryFn: () => api.get<IdeaDto[]>(`/ideas${status ? `?status=${status}` : ''}`),
  });
export const plannerStreamQuery = (p: { from: string; to: string; month?: string }) =>
  queryOptions({
    queryKey: ['planner', 'stream', p.from, p.to, p.month ?? 'default'],
    queryFn: () => {
      const qs = new URLSearchParams({ from: p.from, to: p.to });
      if (p.month) qs.set('month', p.month);
      return api.get<PlannerStreamDto>(`/planner?${qs.toString()}`);
    },
  });
export const postsQuery = (status?: string) =>
  queryOptions({
    queryKey: ['posts', status ?? 'all'],
    queryFn: () => api.get<PostDto[]>(`/posts${status ? `?status=${status}` : ''}`),
  });
export const overviewAnalyticsQuery = (window: OverviewWindow) =>
  queryOptions({
    queryKey: ['overview-analytics', window],
    queryFn: () => api.get<OverviewDto>(`/analytics/overview?window=${window}`),
  });
export const boardQuery = (range: BoardRange) =>
  queryOptions({
    queryKey: ['analytics-board', range],
    queryFn: () => api.get<BoardDto>(`/analytics/board?range=${range}`),
  });
export const rulesQuery = () =>
  queryOptions({ queryKey: ['rules'], queryFn: () => api.get<RuleDto[]>('/playbook/rules') });
export const retroEligibilityQuery = () =>
  queryOptions({ queryKey: ['retro-eligibility'], queryFn: () => api.get<EligibilityDto>('/retro/eligibility') });
export const runsQuery = (kind?: string) =>
  queryOptions({
    queryKey: ['runs', kind ?? 'all'],
    queryFn: () => api.get<RunDto[]>(`/runs${kind ? `?kind=${kind}` : ''}`),
  });
export const settingsQuery = () =>
  queryOptions({ queryKey: ['settings'], queryFn: () => api.get<SettingsDto>('/settings') });

// --- queries -------------------------------------------------------------
export const useDashboard = () => useQuery(dashboardQuery());
/** `placeholderData`: a status filter change is a transition, never a skeleton (ADR 0014). */
export const useIdeas = (status?: string) =>
  useQuery({ ...ideasQuery(status), placeholderData: (prev) => prev });
/**
 * `date` is any day in the wanted week/month — the payload derives both from it.
 * The param is OMITTED when nothing is selected: the server branches on its presence, so a bare
 * `?date=` is an empty ISO date and 400s.
 */
export const usePlanner = (date?: string) =>
  useQuery({
    queryKey: ['planner', date ?? 'current'],
    queryFn: () => api.get<PlannerDto>(`/planner${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  });
/**
 * The agenda stream. `from`/`to` are inclusive ISO days in the settings zone; `month` optionally
 * anchors the mini-month so the calendar pages without refetching a different stream range.
 * Sending one of `from`/`to` alone is a 400 — the signature makes both mandatory.
 */
export const usePlannerStream = (p: { from: string; to: string; month?: string }) =>
  useQuery({ ...plannerStreamQuery(p), placeholderData: (prev) => prev });
/** `placeholderData`: a status filter change is a transition, never a skeleton (ADR 0014). */
export const usePosts = (status?: string) =>
  useQuery({ ...postsQuery(status), placeholderData: (prev) => prev });
export const usePost = (id: number) =>
  useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<PostDetailDto>(`/posts/${id}`),
    // SSE close means the run row is terminal, but the post's body/status writes
    // land just after — poll while drafting so the workspace converges without a reload.
    refetchInterval: (query) => (query.state.data?.post.status === 'drafting' ? 1_000 : false),
  });
/** The post-detail page's one aggregate: lifetime metrics, capture series, demographics, runs. */
export const usePostAnalytics = (postId: number) =>
  useQuery({
    queryKey: ['post-analytics', postId],
    queryFn: () => api.get<PostAnalyticsDto>(`/analytics/posts/${postId}`),
  });
/**
 * `placeholderData` keeps the PREVIOUS window's payload on screen while the next one loads, so
 * switching a window pill never tears the hero down into a spinner. That is also what makes the
 * hero's bars animate: the components stay mounted and reconcile, so their geometry transitions
 * from the old values to the new ones instead of remounting already at them.
 *
 * Caption and bars both read the same DTO, so a still-visible previous window can never be
 * mislabelled — the two swap together on the same render.
 */
export const useOverviewAnalytics = (window: OverviewWindow) =>
  useQuery({ ...overviewAnalyticsQuery(window), placeholderData: (prev) => prev });
/**
 * The whole Analytics page off one request. `placeholderData` keeps the PREVIOUS range's payload
 * on screen while the next one loads (the `useOverviewAnalytics` rule), so switching a range pill
 * reconciles the chart and lists in place instead of tearing them down into a spinner.
 */
export const useBoard = (range: BoardRange) =>
  useQuery({ ...boardQuery(range), placeholderData: (prev) => prev });
export const useRules = () => useQuery(rulesQuery());
export const useRetroEligibility = () => useQuery(retroEligibilityQuery());
export const useProposals = (runId: number | null) =>
  useQuery({
    queryKey: ['retro-proposals', runId], enabled: runId !== null,
    queryFn: () => api.get<{ runId: number; proposals: ProposalDto[] }>(`/retro/proposals/${runId}`),
    retry: false,
  });
/** `placeholderData`: a kind filter change is a transition, never a skeleton (ADR 0014). */
export const useRuns = (kind?: string) =>
  useQuery({ ...runsQuery(kind), placeholderData: (prev) => prev });
export const useRun = (id: number | null, opts?: { pollWhileRunning?: boolean }) =>
  useQuery({
    queryKey: ['run', id],
    enabled: id !== null,
    queryFn: () => api.get<RunDto>(`/runs/${id}`),
    // When a run is live, poll the run row until it reaches a terminal status — the run row
    // (not the reconnectable SSE stream) is the source of truth for completion. Mirrors usePost.
    refetchInterval: opts?.pollWhileRunning
      ? (query) => (query.state.data?.status === 'running' ? 1_000 : false)
      : undefined,
  });
/**
 * The same run row plus its steps and read-time cost, fetched only while a detail view is open.
 * Kept off `useRun`'s key on purpose: `useRun` is the lean poll the live-run surfaces sit on, and
 * widening it would make every one of them carry a run's full step transcript.
 */
export const useRunDetail = (id: number | null) =>
  useQuery({
    queryKey: ['run-detail', id],
    enabled: id !== null,
    queryFn: () => api.get<RunDetailDto>(`/runs/${id}`),
    // A run id that 404s is a dead id, not a flake — retrying holds the modal on a spinner.
    retry: false,
    // Opened on a live run, the detail would otherwise sit frozen at zero steps until reopened.
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2_000 : false),
  });
/** Reads a finished selection-refine run's proposal. The server 409s while the run is live, so gate with `enabled`. */
export const useRefineSelectionProposal = (postId: number, runId: number | null, opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ['refine-selection', postId, runId],
    enabled: runId !== null && (opts?.enabled ?? true),
    queryFn: () => api.get<RefineSelectionProposalDto>(`/posts/${postId}/refine-selection/${runId}`),
    retry: false,
  });
/**
 * NO `placeholderData` here, nor on `usePost`/`usePostAnalytics`: an id-keyed query's previous
 * value is a DIFFERENT post. Workspace seeds its editable body from `usePost`, so keeping the
 * previous record would let a save write post A's text under post B's id (ADR 0014).
 */
export const usePostRuns = (postId: number) =>
  useQuery({ queryKey: ['runs', 'post', postId], queryFn: () => api.get<RunDto[]>(`/runs?postId=${postId}`) });
export const useSettings = () => useQuery(settingsQuery());
export const useRegistry = () =>
  useQuery({ queryKey: ['registry'], queryFn: () => api.get<ModelRowDto[]>('/registry') });

// --- mutations -----------------------------------------------------------
export function useCreateIdea() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { rawText: string; source: string }) => api.post<IdeaDto>('/ideas', input),
    onSuccess: () => inv(['ideas'], ['dashboard']),
  });
}
export function useTriageIdea() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.post<TriageResultDto>(`/ideas/${id}/triage`),
    onSuccess: () => inv(['ideas'], ['dashboard'], ['runs']),
  });
}
/** The idea promoted into this post, or null. The workspace panel reads it; so does its editor. */
export function useIdeaForPost(postId: number) {
  return useQuery({
    queryKey: ['idea-for-post', postId],
    queryFn: () => api.get<IdeaDto[]>(`/ideas?promotedPostId=${postId}`).then((r) => r[0] ?? null),
  });
}
/**
 * `idea-for-post` and `posts` follow a rawText edit: the workspace panel shows the text, and the
 * posts list is titled by it. Prefix matching leaves `['post', id]` alone, which is right — the
 * post row itself does not change.
 */
export function usePatchIdea() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Record<string, unknown>) => api.patch<IdeaDto>(`/ideas/${id}`, patch),
    onSuccess: () => inv(['ideas'], ['dashboard'], ['idea-for-post'], ['posts']),
  });
}
export function usePromoteIdea() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, tier }: { id: number; tier: Tier }) =>
      api.post<{ postId: number }>(`/ideas/${id}/promote`, { tier }),
    onSuccess: () => inv(['ideas'], ['posts'], ['planner'], ['dashboard']),
  });
}
export function usePatchPost(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<PostDto>(`/posts/${id}`, patch),
    onSuccess: () => inv(['post', id], ['posts'], ['planner'], ['dashboard']),
  });
}
/**
 * Full-state schedule write: `{ date, time? }` books a day (an omitted time clears any stored one),
 * `{ date: null }` unschedules. The response is the RAW post row, so its `scheduledTime` is
 * 'HH:MM:SS' — read times off the planner/dashboard payloads, never off this response.
 */
export function useSchedulePost() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, date, time }: { id: number; date: string | null; time?: string | null }) =>
      api.patch<PostDto>(`/posts/${id}/schedule`, date === null ? { date: null } : { date, ...(time ? { time } : {}) }),
    onSuccess: (_post, vars) => inv(['post', vars.id], ['posts'], ['planner'], ['dashboard']),
  });
}
/**
 * One body write: at least one of `body` or `sources`. `sourceRunId` attributes the new revision
 * to the run that proposed the text AND appends that run's Sources server-side; omit it for a
 * hand edit.
 */
export function useUpdateBody(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { body?: string; sources?: Source[]; sourceRunId?: number }) =>
      api.post<PostDetailDto>(`/posts/${id}/body`, input),
    onSuccess: () => inv(['post', id]),
  });
}
export function useDraft(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api.post<LaunchDto>(`/posts/${id}/draft`, {}),
    onSuccess: () => inv(['post', id], ['posts'], ['runs']),
  });
}
export function useRefine(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ feedback }: { feedback: string }) =>
      api.post<LaunchDto>(`/posts/${id}/refine`, { feedback }),
    onSuccess: () => inv(['post', id], ['runs']),
  });
}
/** Launches a selection-scoped refine. The post is untouched — the run only proposes a body. */
export function useRefineSelection(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { selectionStart: number; selectionEnd: number; instruction: string }) =>
      api.post<LaunchDto>(`/posts/${id}/refine-selection`, input),
    onSuccess: () => inv(['runs']),
  });
}
export function usePostAction(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { action: 'approve' } | { action: 'publish'; linkedinUrl: string; publishedAt?: string } |
      { action: 'restore'; revId: number }): Promise<PostDto | PostDetailDto> => {
      if (input.action === 'approve') return api.post<PostDto>(`/posts/${id}/approve`);
      if (input.action === 'publish') {
        return api.post<PostDto>(`/posts/${id}/publish`, { linkedinUrl: input.linkedinUrl, publishedAt: input.publishedAt });
      }
      return api.post<PostDetailDto>(`/posts/${id}/revisions/${input.revId}/restore`);
    },
    onSuccess: () => inv(['post', id], ['posts'], ['planner'], ['dashboard']),
  });
}
/**
 * navigate schedules a transition, and the Workspace stays mounted with every observer until React
 * commits it, so the order of the calls below buys nothing on its own. What keeps the leaving page
 * quiet is that the two queries belonging to the deleted post, the detail and its run list, are
 * REMOVED rather than invalidated. Invalidating the detail would refetch a 404; leaving it cached
 * would let a Back navigation paint the deleted post as an editable Workspace from a thirty-minute
 * cache; invalidating the run list would refetch it under the still-mounted Workspace, and that
 * re-render would rebuild the removed detail query and fetch the 404 anyway. removeQueries destroys
 * the query, which cancels any fetch in flight, and a destroyed query is not found by the `['runs']`
 * invalidation below. One path stays open: usePost polls a `drafting` post every second, a crashed
 * drafting post is deletable, and a poll that fires inside the gap before the commit puts one 404 in
 * the api log and nothing on screen. The cached lists drop the row at once so the index never paints
 * it; then the lists that counted the post, the idea that came back, the run log whose rows lost
 * their pointer and the analytics that may have shown it linked are invalidated.
 */
export function useDeletePost(id: number) {
  const inv = useInvalidate();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.del<void>(`/posts/${id}`),
    onSuccess: () => {
      navigate('/posts');
      qc.removeQueries({ queryKey: ['post', id] });
      qc.removeQueries({ queryKey: ['runs', 'post', id] });
      qc.setQueriesData<PostDto[]>({ queryKey: ['posts'] }, (list) => list?.filter((p) => p.id !== id));
      void inv(['posts'], ['ideas'], ['planner'], ['dashboard'], ['runs'], ['analytics-board'], ['overview-analytics']);
    },
  });
}
/** Mirror of the api's `ImportResult` — what `POST /analytics/import` answers with. */
export interface ImportResultDto {
  sourceFileId: number;
  kind: 'aggregate' | 'single_post';
  /** null when the export could not be attached to an app post (always so for aggregates). */
  linkedPostId: number | null;
  factCounts: { profile: number; lifetime: number; window: number; audience: number };
  warnings: string[];
  alreadyImported?: boolean;
}

export function useImportXlsx() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (file: File) => api.upload<ImportResultDto>('/analytics/import', file),
    // `['analytics-board']` and `['post-analytics']` are PREFIX keys, so every cached range and
    // every cached post detail refetches — an import can add rows to any window and to any post.
    onSuccess: () => inv(
      ['analytics-board'], ['post-analytics'], ['overview-analytics'], ['posts'],
      ['dashboard'], ['retro-eligibility'],
    ),
  });
}
/**
 * Hand-attaches an imported urn to an app post. `['analytics-board']` is invalidated as a
 * PREFIX, so every cached range refetches — the link changes a row's identity in all of them.
 * `['post-analytics']` likewise: the newly-attached urn's facts belong to the post detail page.
 */
export function useLinkPost() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ postUrn, postId }: { postUrn: string; postId: number }) =>
      api.post<LinkResultDto>('/analytics/link', { postUrn, postId }),
    onSuccess: (_res, vars) => inv(
      ['analytics-board'], ['post-analytics'], ['post', vars.postId], ['posts'],
      ['dashboard'], ['retro-eligibility'],
    ),
  });
}
export function useAddRule() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { category: string; rule: string; rationale?: string }) => api.post<RuleDto>('/playbook/rules', input),
    onSuccess: () => inv(['rules']),
  });
}
export function useRetireRule() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.post<RuleDto>(`/playbook/rules/${id}/retire`),
    onSuccess: () => inv(['rules']),
  });
}
export function useRunRetro() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api.post<LaunchDto>('/retro/run'),
    onSuccess: () => inv(['runs'], ['retro-eligibility']),
  });
}
export function useDecide(runId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (decisions: { index: number; approved: boolean }[]) =>
      api.post<{ applied: number; rejected: number }>(`/retro/proposals/${runId}/decide`, { decisions }),
    onSuccess: () => inv(['rules'], ['retro-proposals', runId], ['retro-eligibility'], ['dashboard']),
  });
}
export function usePatchSettings() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (patch: Partial<SettingsDto>) => api.patch<SettingsDto>('/settings', patch),
    // Run cost is computed at READ time from these rates, so any settings write restates the cost
    // of every run already on screen — the open detail has to refetch or it shows the old price.
    // The planner/dashboard read `scheduling.weeklyGoal` the same way (goal + streak are derived
    // server-side per request), so a settings write restates those payloads too.
    onSuccess: () => inv(['settings'], ['run-detail'], ['planner'], ['dashboard']),
  });
}

/** A row edit prices the next call, never an old one: the ledger keeps what each call cost. The
 *  runs lists refetch so a row's new model shows on the next run without a reload. */
export function usePatchRegistryRow() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ModelRowPatch }) => api.patch<ModelRowDto>(`/registry/${id}`, patch),
    onSuccess: () => inv(['registry'], ['runs']),
  });
}

// --- images ----------------------------------------------------------------
export const IMAGE_PAGE_SIZE = 12;
export type AssetSort = 'newest' | 'oldest';
/** Toolbar filter state: the three asset origins plus the unfiltered default. */
export type OriginFilter = 'all' | AssetOrigin;

/**
 * One page of a post's candidates. The key MUST stay prefixed `['images', postId]`: RunWatcher
 * invalidates by that prefix, which is how every page/sort/filter variant refreshes when a run
 * goes terminal. `placeholderData` keeps the previous page mounted while the next one loads —
 * without it the grid (and the pager's own `total`) would blink through an empty state.
 */
export const useImagesPage = (postId: number, opts: { page: number; sort: AssetSort; origin: OriginFilter }) =>
  useQuery({
    queryKey: ['images', postId, opts.page, opts.sort, opts.origin],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(IMAGE_PAGE_SIZE),
        offset: String((opts.page - 1) * IMAGE_PAGE_SIZE),
        sort: opts.sort,
      });
      if (opts.origin !== 'all') params.set('origin', opts.origin);
      return api.get<AssetPageDto>(`/images/posts/${postId}?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });

/** Provenance for one asset, fetched only while a breakdown modal is open. */
export const useBreakdown = (assetId: number | null) =>
  useQuery({
    queryKey: ['asset-breakdown', assetId],
    enabled: assetId !== null,
    queryFn: () => api.get<BreakdownDto>(`/images/assets/${assetId}/breakdown`),
  });

/**
 * The candidate's html with its background inlined, for the canvas editor. Multi-MB payload, so it
 * is fetched only while the editor is open (`enabled`), never refetched under it (a new `html`
 * would remount the iframe and discard in-progress edits), and dropped from the cache the moment
 * the editor closes (`gcTime: 0`).
 */
export const useEditableHtml = (assetId: number | null) =>
  useQuery({
    queryKey: ['editable-html', assetId],
    enabled: assetId !== null,
    queryFn: () => api.get<EditableHtmlDto>(`/images/assets/${assetId}/editable-html`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

/**
 * Land a canvas edit. Synchronous server-side — there is no run, so nothing for the run watcher to
 * observe: the new candidate comes back on the response and its own `postId` says which list to
 * invalidate.
 *
 * `bgRunId` is the bg-patch run behind the background the RUNTIME reports as applied at serialize
 * time. `null` means the source background — and the api reads absence, not null, as "source", so
 * the field is omitted rather than sent empty.
 */
export function useCanvasEdit(assetId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ html, bgRunId }: { html: string; bgRunId: number | null }) =>
      api.post<AssetDto>(`/images/assets/${assetId}/edit`, { html, ...(bgRunId !== null ? { bgRunId } : {}) }),
    onSuccess: (asset) => inv(['images', asset.postId]),
  });
}
export function useGenerateHybrid(postId: number) {
  return useMutation({ mutationFn: (input: { brief: string; batch?: number }) => api.post<ImageBatchLaunchDto>(`/images/posts/${postId}/hybrid`, input) });
}
/**
 * Background-patch one candidate: a run whose only input is the instruction (the source background
 * is attached server-side). It produces a background, not an asset — nothing to invalidate, and
 * nothing lands until the canvas editor saves the patch along with the edit.
 */
export function useBgPatch(assetId: number) {
  return useMutation({
    mutationFn: (instruction: string) =>
      api.post<ImageLaunchDto>(`/images/assets/${assetId}/bg-patch`, { instruction }),
  });
}
/**
 * The patched background of a succeeded bg-patch run. Imperative rather than a query on purpose:
 * it is read EXACTLY once per run, straight into the iframe, and a cached copy of a multi-MB data
 * URI would be retained for a value nothing ever re-reads. 404 means the file is not there — the
 * caller treats that as a failed refine.
 */
export const fetchPatchedBg = (runId: number) => api.get<PatchedBgDto>(`/images/runs/${runId}/patched-bg`);
export function useReviewImages(postId: number) {
  return useMutation({ mutationFn: () => api.post<ImageLaunchDto>(`/images/posts/${postId}/review`) });
}
export function useSelectAsset(postId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (assetId: number) => api.post<AssetDto[]>(`/images/posts/${postId}/select/${assetId}`),
    onSuccess: () => inv(['images', postId]),
  });
}
export function useDeleteAsset(postId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (assetId: number) => api.del<AssetDto[]>(`/images/posts/${postId}/${assetId}`),
    // Deleting the currently-referenced asset fires the FK's ON DELETE SET NULL server-side —
    // invalidate the post too, or the cached referenceAssetId (and the chip) would go stale.
    onSuccess: () => inv(['images', postId], ['post', postId]),
  });
}
export const useReferenceCandidates = (postId: number) =>
  useQuery({ queryKey: ['reference-candidates', postId], queryFn: () => api.get<ReferenceCandidateDto[]>(`/posts/${postId}/reference-candidates`) });
export function useSetReference(postId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (assetId: number | null) => api.patch<PostDto>(`/posts/${postId}/reference`, { assetId }),
    onSuccess: () => inv(['post', postId]),
  });
}

// --- inputs --------------------------------------------------------------
/** A file the operator dropped or picked, or a text they typed: a link, a path, or a paste. */
export type InputSubmission = { file: File } | { text: string };

const submit = <T>(path: string, s: InputSubmission) =>
  ('file' in s ? api.upload<T>(path, s.file) : api.post<T>(path, { text: s.text }));

export const usePostInputs = (postId: number) =>
  useQuery({
    queryKey: ['post-inputs', postId],
    queryFn: () => api.get<PostInputDto[]>(`/posts/${postId}/inputs`),
  });

/** Always 200, refusal included: the union says which, so a refused preview is not an error. */
export function usePreviewInput(postId: number) {
  return useMutation({
    mutationFn: (s: InputSubmission) => submit<InputPreview>(`/posts/${postId}/inputs/preview`, s),
  });
}

export function useAttachInput(postId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (s: InputSubmission) => submit<PostInputDto>(`/posts/${postId}/inputs`, s),
    onSuccess: () => inv(['post-inputs', postId]),
  });
}

export function useRemoveInput(postId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (inputId: number) => api.del<void>(`/posts/${postId}/inputs/${inputId}`),
    onSuccess: () => inv(['post-inputs', postId]),
  });
}

// --- SSE -----------------------------------------------------------------
/** Streams a run's engine events; `done` flips when the server completes the stream. */
export function useRunStream(runId: number | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (runId === null) return;
    setLines([]);
    setDone(false);
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data as string) as { type: string; data: string };
      setLines((prev) => [...prev, ev.data]);
    };
    es.onerror = () => { es.close(); setDone(true); }; // stream completion surfaces as error
    return () => es.close();
  }, [runId]);
  return { lines, done };
}
