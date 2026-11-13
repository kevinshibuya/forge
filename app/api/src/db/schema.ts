import {
  boolean, check, date, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text,
  time, timestamp, unique, uniqueIndex, vector, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { INPUT_KINDS } from '@forge/shared';
import type {
  Decline, InputKind, RunTell, Source, StagedInput, StagedManifestEntry, ToolCall,
} from '@forge/shared';
export const ideaSource = pgEnum('idea_source', ['work', 'news', 'evergreen', 'braindump']);
export const ideaStatus = pgEnum('idea_status', ['new', 'triaged', 'promoted', 'discarded']);
export const postTier = pgEnum('post_tier', ['T1', 'T2', 'T3']);
export const postStatus = pgEnum('post_status', ['queued', 'drafting', 'draft_ready', 'approved', 'published', 'measured']);
export const assetLane = pgEnum('asset_lane', ['html', 'raster', 'hybrid']);
export const ruleCategory = pgEnum('rule_category', ['voice', 'structure', 'visual', 'timing', 'cadence', 'platform']);
export const ruleStatus = pgEnum('rule_status', ['active', 'retired']);
export const runKind = pgEnum('run_kind', ['draft', 'triage', 'image_html', 'image_gen', 'image_review', 'retro', 'image_hybrid', 'image_plan', 'image_variate', 'refine_selection', 'image_refine']);
export const assetOrigin = pgEnum('asset_origin', ['generated', 'bg_refined', 'canvas_edited']);
export const runStatus = pgEnum('run_status', ['running', 'succeeded', 'failed', 'timeout']);
export const failureKind = pgEnum('failure_kind', ['timeout', 'quota', 'spawn_error', 'nonzero_exit', 'invalid_output', 'declined', 'other']);
export const embeddingSource = pgEnum('embedding_source', ['post', 'idea', 'inspiration', 'retro_note']);
export const sourceFileKind = pgEnum('source_file_kind', ['aggregate', 'single_post']);
// drizzle wants a mutable non-empty tuple and INPUT_KINDS is `as const`, so the spread is the cast.
export const inputKind = pgEnum('input_kind', [...INPUT_KINDS] as [InputKind, ...InputKind[]]);

export const ideas = pgTable('ideas', {
  id: serial('id').primaryKey(),
  rawText: text('raw_text').notNull(),
  source: ideaSource('source').notNull(),
  status: ideaStatus('status').notNull().default('new'),
  suggestedTier: postTier('suggested_tier'),
  newsExpiry: timestamp('news_expiry', { withTimezone: true }),
  notes: text('notes'),
  promotedPostId: integer('promoted_post_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  tier: postTier('tier').notNull(),
  status: postStatus('status').notNull().default('queued'),
  hook: text('hook'),
  bodyLinkedin: text('body_linkedin'),
  bodyX: text('body_x'),
  hashtags: text('hashtags').array().notNull().default([]),
  imagePrompt: text('image_prompt'),
  referenceAssetId: integer('reference_asset_id')
    .references((): AnyPgColumn => assets.id, { onDelete: 'set null' }),
  topicTags: text('topic_tags').array().notNull().default([]),
  scheduledDate: date('scheduled_date'),
  scheduledTime: time('scheduled_time'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  linkedinUrl: text('linkedin_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // What this post cites. Owned by the post, not re-derived from a run: a draft replaces it, an
  // accepted refine appends to it, the operator edits it by hand. Never null, so no reader branches.
  sources: jsonb('sources').$type<Source[]>().notNull().default(sql`'[]'::jsonb`),
});

export const postRevisions = pgTable('post_revisions', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  source: text('source').notNull(), // 'run:<id>' | 'manual_edit', where the revision came from
  // The Source list at that moment, plural, beside the singular `source` above. Null means the
  // snapshot predates 0018, which restore reads as "nothing to restore to".
  sources: jsonb('sources').$type<Source[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A document the operator attached to a Post for its generation Runs to read. `ref` is the
 *  original file name, the url, or the absolute path after `~` expansion. `bytes` is the stored
 *  text's size for `file` and `url`, and the walk total at attach for `path`, stale by design
 *  because a `path` is re-walked at every run. */
export const postInputs = pgTable('post_inputs', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  kind: inputKind('kind').notNull(),
  ref: text('ref').notNull(),
  bytes: integer('bytes').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  postIdRefUnique: unique('post_inputs_post_id_ref_unique').on(t.postId, t.ref),
}));
export type PostInputRow = typeof postInputs.$inferSelect;

export const assets = pgTable('assets', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  lane: assetLane('lane').notNull(),
  htmlSource: text('html_source'),
  generationPrompt: text('generation_prompt'),
  pngPath: text('png_path'),
  width: integer('width'),
  height: integer('height'),
  candidateGroupId: text('candidate_group_id'),
  isSelected: boolean('is_selected').notNull().default(false),
  reviewScore: integer('review_score'),
  reviewNotes: text('review_notes'),
  /** lineage: which run produced this asset, and which asset it was derived from. */
  runId: integer('run_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
  sourceAssetId: integer('source_asset_id').references((): AnyPgColumn => assets.id, { onDelete: 'set null' }),
  origin: assetOrigin('origin').notNull().default('generated'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Canonical analytics model (phase 2). One row per uploaded export file, one
// dimension row per LinkedIn post, and four fact tables — each at exactly one
// grain. `analytics_snapshots` was folded into these by migration 0010.
// ---------------------------------------------------------------------------

/** One uploaded LinkedIn export. `sha256` is the whole-file idempotency key. */
export const sourceFiles = pgTable('source_files', {
  id: serial('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  kind: sourceFileKind('kind').notNull(),
  originalName: text('original_name').notNull(),
  /** Aggregate exports only — the period the whole workbook is scoped to. */
  windowStart: date('window_start'),
  windowEnd: date('window_end'),
  /** Semantic capture instant (backdatable); `createdAt` is the row-insert instant. */
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** `uploads/analytics/<sha256>.xlsx`; null for legacy rows whose file was never kept. */
  rawPath: text('raw_path'),
});

/**
 * A LinkedIn post as the exports know it. Keyed on the full typed URN; the three
 * typed columns fill in as each form is learned, because the numeric id DIFFERS
 * across urn types for the same post.
 */
export const dimPost = pgTable('dim_post', {
  postUrn: text('post_urn').primaryKey(),
  activityUrn: text('activity_urn'),
  shareUrn: text('share_urn'),
  ugcUrn: text('ugc_urn'),
  postId: integer('post_id').references(() => posts.id, { onDelete: 'set null' }),
  linkedinUrl: text('linkedin_url').notNull(),
  /** Never downgraded: an aggregate sheet's date-only value cannot overwrite a full timestamp. */
  publishedAt: timestamp('published_at', { withTimezone: true }),
  firstSeenSourceFileId: integer('first_seen_source_file_id').notNull().references(() => sourceFiles.id),
});

/** Account-level, one calendar day. Upsert on the PK = last write wins. */
export const factProfileMetric = pgTable('fact_profile_metric', {
  metric: text('metric').notNull(),
  date: date('date').notNull(),
  value: doublePrecision('value').notNull(),
  sourceFileId: integer('source_file_id').notNull().references(() => sourceFiles.id),
}, (t) => [primaryKey({ columns: [t.metric, t.date] })]);

/** Per post, lifetime-to-date as of a capture day. */
export const factPostLifetime = pgTable('fact_post_lifetime', {
  postUrn: text('post_urn').notNull().references(() => dimPost.postUrn),
  metric: text('metric').notNull(),
  asOfDate: date('as_of_date').notNull(),
  value: doublePrecision('value').notNull(),
  sourceFileId: integer('source_file_id').notNull().references(() => sourceFiles.id),
}, (t) => [primaryKey({ columns: [t.postUrn, t.metric, t.asOfDate] })]);

/** Account (post_urn null) or post, scoped to the export's window. */
export const factWindowMetric = pgTable('fact_window_metric', {
  id: serial('id').primaryKey(),
  postUrn: text('post_urn').references(() => dimPost.postUrn),
  metric: text('metric').notNull(),
  windowStart: date('window_start').notNull(),
  windowEnd: date('window_end').notNull(),
  value: doublePrecision('value').notNull(),
  sourceFileId: integer('source_file_id').notNull().references(() => sourceFiles.id),
}, (t) => [
  unique('fact_window_metric_grain_uq')
    .on(t.postUrn, t.metric, t.windowStart, t.windowEnd).nullsNotDistinct(),
]);

/** Account (post_urn null) or post demographics, snapshot grain. */
export const factAudienceSegment = pgTable('fact_audience_segment', {
  id: serial('id').primaryKey(),
  postUrn: text('post_urn').references(() => dimPost.postUrn),
  dimension: text('dimension').notNull(),
  segment: text('segment').notNull(),
  value: doublePrecision('value').notNull(),
  unit: text('unit').notNull(),
  asOfDate: date('as_of_date').notNull(),
  sourceFileId: integer('source_file_id').notNull().references(() => sourceFiles.id),
}, (t) => [
  unique('fact_audience_segment_grain_uq')
    .on(t.postUrn, t.dimension, t.segment, t.asOfDate).nullsNotDistinct(),
]);

export const playbookRules = pgTable('playbook_rules', {
  id: serial('id').primaryKey(),
  category: ruleCategory('category').notNull(),
  rule: text('rule').notNull(),
  rationale: text('rationale'),
  provenance: text('provenance').notNull(), // 'seed' | 'retro:<run_id>' | 'manual'
  status: ruleStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
});

export const inspirations = pgTable('inspirations', {
  id: serial('id').primaryKey(),
  author: text('author').notNull(),
  url: text('url'),
  body: text('body').notNull(),
  imagePath: text('image_path'),
  whyItWorks: text('why_it_works'),
  approxMetrics: jsonb('approx_metrics'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable('runs', {
  id: serial('id').primaryKey(),
  /** An engine name: `claude` or `codex` on cli, the provider on api (`anthropic`, `openai`, `google`). */
  engine: text('engine').notNull(),
  kind: runKind('kind').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  output: text('output'),
  parsedOk: boolean('parsed_ok'),
  status: runStatus('status').notNull().default('running'),
  failureKind: failureKind('failure_kind'),
  error: text('error'),
  postId: integer('post_id').references(() => posts.id, { onDelete: 'set null' }),
  /** Usage totals for the whole run. `tokensInput` is uncached input. */
  tokensInput: integer('tokens_input'),
  tokensCacheWrite: integer('tokens_cache_write'),
  tokensCacheRead: integer('tokens_cache_read'),
  tokensOutput: integer('tokens_output'),
  imagesGenerated: integer('images_generated'),
  /** Stored at the registry row's prices when the run ends (from slice 2); runs made before that were
   *  backfilled from the settings row's rates by 0021. A managed run's cost is the sum of its steps. */
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  /** Style tells found in the parsed output, tagged with the field they came from.
   *  NULL means the run was never linted (an older row, or a lint that threw); [] means clean. */
  tells: jsonb('tells').$type<RunTell[]>(),
  /** The decline envelope when the engine honoured the contract by declining (failure_kind
   *  `declined`). NULL on every other row. */
  declined: jsonb('declined').$type<Decline>(),
  /** Legacy, written by no code path since slice 2; dropped in slice 12. These five held a fenced
   *  run's record: the research toggle, its tool-call audit, the harness and Inputs manifests, and
   *  the staged directory. Runs made before slice 2 still render them read-only. */
  research: boolean('research').notNull().default(false),
  toolCalls: jsonb('tool_calls').$type<ToolCall[]>(),
  stagedManifest: jsonb('staged_manifest').$type<StagedManifestEntry[]>(),
  stagedInputs: jsonb('staged_inputs').$type<StagedInput[]>(),
  stagedDir: text('staged_dir'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** One engine sub-call inside a managed run (e.g. plan → gen → html within image_hybrid). */
export const runSteps = pgTable('run_steps', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),           // sub-call RunKind as text ('image_plan' | 'image_gen' | ...)
  engine: text('engine').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  output: text('output'),
  tokensInput: integer('tokens_input'),
  tokensCacheWrite: integer('tokens_cache_write'),
  tokensCacheRead: integer('tokens_cache_read'),
  tokensOutput: integer('tokens_output'), // codex reports one total; it lands here (display as total)
  imagesGenerated: integer('images_generated'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  failureKind: failureKind('failure_kind'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
}, (t) => [index('run_steps_run_idx').on(t.runId)]);

/** One row per task and backend (ADR 0019): which engine and model a task runs on, and its list
 *  prices per million tokens. numeric columns come back as strings; convert at the service edge. */
export const modelRegistry = pgTable('model_registry', {
  id: serial('id').primaryKey(),
  task: text('task').notNull(),
  backend: text('backend').notNull(),
  engine: text('engine').notNull(),
  model: text('model').notNull(),
  effort: text('effort'),
  maxOutputTokens: integer('max_output_tokens').notNull().default(8192),
  inputPerMtok: numeric('input_per_mtok', { precision: 12, scale: 6 }).notNull().default('0'),
  cacheWritePerMtok: numeric('cache_write_per_mtok', { precision: 12, scale: 6 }).notNull().default('0'),
  cacheReadPerMtok: numeric('cache_read_per_mtok', { precision: 12, scale: 6 }).notNull().default('0'),
  outputPerMtok: numeric('output_per_mtok', { precision: 12, scale: 6 }).notNull().default('0'),
  imagePerUnit: numeric('image_per_unit', { precision: 12, scale: 6 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('model_registry_task_backend_uq').on(t.task, t.backend),
  check('model_registry_backend_ck', sql`${t.backend} IN ('api', 'cli')`),
]);

/** One model call, one attempt (ADR 0026). The accounting record outlives the run it describes.
 *  `exit` is `succeeded` or the failure kind the engine returned; `category` is `text` or `image`. */
export const ledger = pgTable('ledger', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').references(() => runs.id, { onDelete: 'set null' }),
  stepSeq: integer('step_seq'),
  attempt: integer('attempt').notNull().default(1),
  backend: text('backend').notNull(),
  engine: text('engine').notNull(),
  model: text('model').notNull(),
  category: text('category').notNull(),
  exit: text('exit').notNull(),
  tokensInput: integer('tokens_input'),
  tokensCacheWrite: integer('tokens_cache_write'),
  tokensCacheRead: integer('tokens_cache_read'),
  tokensOutput: integer('tokens_output'),
  images: integer('images'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  providerRequestId: text('provider_request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ledger_run_idx').on(t.runId)]);

export const embeddings = pgTable('embeddings', {
  id: serial('id').primaryKey(),
  sourceType: embeddingSource('source_type').notNull(),
  sourceId: integer('source_id').notNull(),
  chunkIndex: integer('chunk_index').notNull().default(0),
  chunkText: text('chunk_text').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  model: text('model').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('embeddings_source_chunk_uq').on(t.sourceType, t.sourceId, t.chunkIndex),
  index('embeddings_cosine_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
]);

export const embeddingJobs = pgTable('embedding_jobs', {
  id: serial('id').primaryKey(),
  sourceType: embeddingSource('source_type').notNull(),
  sourceId: integer('source_id').notNull(),
  chunks: jsonb('chunks').notNull(), // string[]
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  id: integer('id').primaryKey(), // always 1
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
