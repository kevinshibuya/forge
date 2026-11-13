// DTOs are declared here (not imported from the server) because dates are strings on the wire.
import type {
  AssetOrigin, FailureKind, IdeaSource, IdeaStatus, InputKind, PostStatus, RetroProposal,
  EngineName, RuleCategory, RuleStatus, RunTell, Settings, Source, StagedInput,
  StagedManifestEntry, ToolCall,
} from '@forge/shared';

export type Tier = 'T1' | 'T2' | 'T3';

export interface PostDto {
  id: number; tier: Tier; status: PostStatus; hook: string | null; bodyLinkedin: string | null;
  bodyX: string | null; hashtags: string[]; topicTags: string[];
  /**
   * A calendar day + an optional wall-clock time, never an instant. These come off the RAW post
   * row, so `scheduledTime` is 'HH:MM:SS' here — the planner/dashboard DTOs below emit 'HH:mm'.
   */
  scheduledDate: string | null; scheduledTime: string | null;
  publishedAt: string | null; linkedinUrl: string | null; imagePrompt: string | null; createdAt: string; updatedAt: string;
  referenceAssetId: number | null;
  /** The list's title: the idea this post was promoted from. Null when it was created bare. */
  ideaText: string | null;
  /** The selected image, for the list's miniature. Null until one is selected. */
  selectedAsset: { id: number; width: number | null; height: number | null } | null;
  /** What the post cites. Owned by the post, never re-derived from a run. Empty, never null. */
  sources: Source[];
}
/** `source` is where the revision came from; `sources` is the Source list it snapshotted.
 *  Null `sources` means the snapshot predates the column. */
export interface RevisionDto {
  id: number; postId: number; body: string; source: string; sources: Source[] | null; createdAt: string;
}
export interface RunDto {
  id: number; engine: string; kind: string; model: string; prompt: string; output: string | null;
  parsedOk: boolean | null; status: 'running' | 'succeeded' | 'failed' | 'timeout';
  failureKind: string | null; error: string | null; postId: number | null;
  /** Set only when `failureKind` is `declined`: the engine honoured the contract by declining. */
  declined: { outcome: 'declined'; reason: string; question?: string } | null;
  /** Usage the engine reported. Codex reports one total, which lands in `tokensOutput`.
   *  `tokensInput` is uncached input; the two cache fields are null where the provider sent none. */
  tokensInput: number | null; tokensCacheWrite: number | null; tokensCacheRead: number | null;
  tokensOutput: number | null; imagesGenerated: number | null;
  /** Recorded at call time from the registry row; null when the call reported nothing to price. */
  costUsd: number | null;
  startedAt: string; finishedAt: string | null;
}
export interface PostDetailDto { post: PostDto; revisions: RevisionDto[]; latestDraft: RunDto | null }
export interface IdeaDto {
  id: number; rawText: string; source: IdeaSource; status: IdeaStatus; suggestedTier: Tier | null;
  newsExpiry: string | null; notes: string | null; promotedPostId: number | null; createdAt: string;
}
export interface RuleDto {
  id: number; category: RuleCategory; rule: string; rationale: string | null; provenance: string;
  status: RuleStatus; createdAt: string; retiredAt: string | null;
}
// --- planning ------------------------------------------------------------
// Mirrors of the server's planning DTOs. Every `date` below is a calendar day 'YYYY-MM-DD' and
// every `scheduledTime` is 'HH:mm' — only `publishedAt` is an instant.
export interface PlannerPostItemDto {
  id: number; title: string; tier: Tier; status: PostStatus;
  scheduledTime: string | null; publishedAt: string | null;
}
export interface PlannerDayLaneDto { date: string; posts: PlannerPostItemDto[] }
export interface MonthDaySummaryDto { date: string; scheduled: number; published: number }
export interface QueueItemDto { id: number; title: string; tier: Tier; status: PostStatus }
export interface GoalProgressDto { target: number; publishedInWeek: number }
export interface PlannerDto {
  weekStart: string; month: MonthDaySummaryDto[]; week: PlannerDayLaneDto[];
  queue: QueueItemDto[]; goal: GoalProgressDto | null; streakWeeks: number | null;
}
/**
 * The agenda-stream payload (`GET /planner?from&to[&month]`). `days` carries one entry per calendar
 * day from `from` to `to` INCLUSIVE, empty days included, in order. `goal`/`streakWeeks` are scoped
 * to TODAY's week — the stream has no selected week. `month` is the mini-month for the `month`
 * anchor (default: the month of `from`), so paging the calendar never moves the stream.
 */
export interface PlannerStreamDto {
  days: PlannerDayLaneDto[];
  /** Posts strictly before `from`: missed schedules plus published history. */
  earlierCount: number;
  month: MonthDaySummaryDto[];
  queue: QueueItemDto[];
  goal: GoalProgressDto | null;
  streakWeeks: number | null;
}
export interface UpcomingItemDto {
  id: number; title: string; tier: Tier; status: PostStatus;
  scheduledDate: string; scheduledTime: string | null;
}
export interface PendingActionDto { kind: string; label: string; href: string }
export interface StatusMixEntryDto { status: PostStatus; count: number }
export interface DashboardDto {
  upcoming: UpcomingItemDto[]; goal: GoalProgressDto | null;
  streakWeeks: number | null; pendingActions: PendingActionDto[];
  /** Every status with at least one post; zero-count statuses are omitted. */
  statusMix: StatusMixEntryDto[];
  /** The `upcoming` predicate, uncapped — `upcoming` itself is sliced to 5. */
  scheduledCount: number;
}
export type OverviewWindow = 7 | 28 | 90;
export interface OverviewWindowTotals {
  /** ISO dates, inclusive on both ends. */
  start: string; end: string;
  impressions: number; engagements: number; followersNew: number;
  postsPublished: number; daysWithData: number;
}
export interface OverviewDto {
  window: OverviewWindow;
  current: OverviewWindowTotals;
  previous: OverviewWindowTotals;
  /** ISO weekday buckets, 1=mon … 7=sun — always all 7, zero-filled. */
  weekday: { weekday: number; impressions: number; engagements: number }[];
  followersTotal: { value: number; asOf: string } | null;
}
export type BoardRange = '7' | '28' | '90' | 'all';
/** Only days carrying imported rows appear — the chart draws the absent days as GAPS, not zeros. */
export interface BoardSeriesPoint { date: string; impressions: number; engagements: number; followersNew: number }
export interface BoardTotals { impressions: number; engagements: number; followersNew: number; postsPublished: number }
/**
 * `grain: 'window'` means the row is known only from the aggregate top-posts sheet: `impressions`
 * is its max windowed count and every derived stat is null — render those as `—`, never derived.
 * `postId`/`title` are null for imports not yet attached to an app post.
 */
export interface BoardPostRow {
  postUrn: string; postId: number | null; title: string | null; linkedinUrl: string;
  publishedAt: string | null; grain: 'lifetime' | 'window';
  impressions: number; engagements: number | null; er: number | null; followsGained: number | null;
}
export interface BoardAudienceSegment { segment: string; value: number; unit: string }
export interface BoardAudienceDimension { dimension: string; segments: BoardAudienceSegment[] }
export interface BoardAudience { asOf: string; dimensions: BoardAudienceDimension[] }
/** The cost recorded on each run at call time, summed over the window. */
export interface BoardSpend {
  total: number; runs: number; perPublishedPost: number | null;
  byKind: { kind: string; total: number }[];
  byPost: { postId: number; title: string; cost: number; impressions: number }[];
}
/** The one aggregate behind the whole Analytics page. */
export interface BoardDto {
  range: BoardRange;
  /** ISO dates, inclusive on both ends. */
  start: string; end: string;
  series: BoardSeriesPoint[];
  totals: BoardTotals;
  followersTotal: { value: number; asOf: string } | null;
  /** Deduped per app post, ordered by best-known impressions descending across grains. */
  posts: BoardPostRow[];
  audience: BoardAudience | null;
  spend: BoardSpend;
}
// --- post detail (`GET /analytics/posts/:postId`) --------------------------
/** A lifetime metric's latest value and the capture day it was read on. */
export interface PostMetricDto { metric: string; value: number; asOf: string }
/** One capture day carrying an impressions row. Capture days are SPARSE, never adjacent. */
export interface PostSeriesPointDto { asOf: string; impressions: number }
/** `costUsd` is null when nothing about the run is priceable — a display estimate, not billing. */
export interface PostRunDto {
  runId: number; kind: string; engine: string; model: string; costUsd: number | null;
}
/** The whole post-detail page off one request. */
export interface PostAnalyticsDto {
  post: {
    id: number; title: string; tier: Tier;
    publishedAt: string | null; linkedinUrl: string | null;
  };
  /** Latest per metric across every urn form of the post; `[]` when nothing was measured. */
  latest: PostMetricDto[];
  /** Ascending by capture day. Charted only at length >= 2 — one capture is no series. */
  series: PostSeriesPointDto[];
  /** THIS post's demographics at its newest capture, same shape as the board's. */
  audience: BoardAudience | null;
  /** `total` is null when NO run of this post is priceable. */
  runs: { total: number | null; items: PostRunDto[] };
}
/** Mirror of the api's `LinkResult` — what `POST /analytics/link` answers with. */
export interface LinkResultDto {
  postUrn: string;
  postId: number;
  /** Non-fatal notes, e.g. a post whose status blocked the move to 'measured'. */
  warnings: string[];
}
export interface EligibilityDto { measuredSince: number; threshold: number; eligible: boolean; lastRetroAt: string | null }
export interface ProposalDto extends RetroProposal { index: number; targetRule: RuleDto | null }
export interface LaunchDto { runId: number; degraded?: boolean }
/** A selection-refine run's proposed full body — read on demand, never applied server-side. */
export interface RefineSelectionProposalDto { proposedBody: string }
export type SettingsDto = Settings;
/** One model registry row (`GET /registry`): which engine and model a task runs on, per backend,
 *  and its list prices. USD per million tokens; `imagePerUnit` per generated image. */
export interface ModelRowDto {
  id: number; task: string; backend: 'api' | 'cli'; engine: EngineName; model: string;
  effort: string | null; maxOutputTokens: number;
  prices: { inputPerMtok: number; cacheWritePerMtok: number; cacheReadPerMtok: number; outputPerMtok: number; imagePerUnit: number };
  updatedAt: string;
}
export type TriageResultDto =
  | { ok: true; idea: IdeaDto; runId: number }
  /** `declined` rides along when the engine declined the triage, so the row can show the question. */
  | { ok: false; runId: number; failureKind: string; error: string; declined?: RunDto['declined'] };
export interface AssetDto {
  id: number; postId: number; lane: 'html' | 'raster' | 'hybrid';
  htmlSource: string | null; generationPrompt: string | null;
  width: number | null; height: number | null; candidateGroupId: string | null;
  isSelected: boolean; reviewScore: number | null; reviewNotes: string | null;
  /** lineage: the run that produced this asset, and the asset it was derived from. */
  runId: number | null; sourceAssetId: number | null; origin: AssetOrigin;
  createdAt: string;
}
/** The paginated GET envelope. `total` is counted under the same filter, so it drives the pager. */
/** `selected` is looked up outside the page window, so the hero survives paging and filtering. */
export interface AssetPageDto { items: AssetDto[]; total: number; selected: AssetDto | null }
/** One engine sub-call of the run that produced an asset. */
export interface RunStepDto {
  seq: number; kind: string; engine: EngineName; model: string;
  prompt: string; output: string | null;
  tokensInput: number | null; tokensCacheWrite: number | null; tokensCacheRead: number | null;
  tokensOutput: number | null; imagesGenerated: number | null;
  costUsd: number | null;
  failureKind: FailureKind | null;
  startedAt: string; finishedAt: string;
}
/**
 * One run with its engine sub-calls. `costUsd` is recorded at call time from the registry row (a
 * managed run's is the sum of its steps), null when nothing was priced; `steps` is empty for
 * single-call kinds and for runs that predate step recording.
 */
export interface RunDetailDto extends RunDto {
  steps: RunStepDto[];
  costUsd: number | null;
  /** null for a run that predates the lint or whose lint threw; [] for a clean one. */
  tells: RunTell[] | null;
  /** Legacy columns, rendered read-only for runs made before slice 2, when research runs and
   *  staged Inputs were removed; no run writes them now. `outsideRoot` on a call is the SERVER's
   *  verdict; the browser never recomputes containment. */
  research: boolean;
  toolCalls: ToolCall[] | null;
  stagedManifest: StagedManifestEntry[] | null;
  stagedInputs: StagedInput[] | null;
  stagedDir: string | null;
}
/** Provenance for one asset. Pre-lineage assets have no run — `steps` is empty, never guessed. */
export interface BreakdownDto {
  assetId: number; generationPrompt: string | null; runId: number | null; steps: RunStepDto[];
}
/**
 * A hybrid candidate's text layer with its background INLINED, for the canvas editor.
 * `bgDataUri` is the exact string that was substituted in — the editor must reverse it back to
 * `__HYBRID_BG__` before posting, and only the exact string reverses exactly.
 */
export interface EditableHtmlDto { html: string; bgDataUri: string }
export interface ImageLaunchDto { runId: number }
/**
 * The background a finished bg-patch run produced, as a data URI the canvas can paint immediately.
 * Multi-MB and read exactly once per run — it is handed straight to the iframe, never cached.
 */
export interface PatchedBgDto { bgDataUri: string }
export interface ImageBatchLaunchDto { runIds: number[] }
export interface ReferenceCandidateDto { assetId: number; postId: number; isSelected: boolean }

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* raw text */ }
    throw new ApiError(res.status, message);
  }
  // A handler that returns nothing answers 200 with an empty body, and `res.json()` throws on one.
  // That rejected the mutation of a DELETE whose write had already succeeded, so its onSuccess
  // never ran and the list it should have invalidated kept showing the removed row.
  const body = await res.text();
  return (body === '' ? undefined : JSON.parse(body)) as T;
}

/** One row of `post_inputs`, as the api returns it. `bytes` is the stored text's size for `file`
 *  and `url`, and the walk total at attach for `path`, stale by design. */
export interface PostInputDto {
  id: number;
  postId: number;
  kind: InputKind;
  ref: string;
  bytes: number;
  addedAt: string;
}
export type { InputPreview } from '@forge/shared';

const headers = { 'content-type': 'application/json' };

export const api = {
  get: <T>(path: string) => fetch(`/api${path}`).then((r) => parse<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    fetch(`/api${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then((r) => parse<T>(r)),
  patch: <T>(path: string, body: unknown) =>
    fetch(`/api${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) }).then((r) => parse<T>(r)),
  del: <T>(path: string) => fetch(`/api${path}`, { method: 'DELETE' }).then((r) => parse<T>(r)),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`/api${path}`, { method: 'POST', body: form }).then((r) => parse<T>(r));
  },
};
