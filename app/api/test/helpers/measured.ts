import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { ForgeDb } from '../../src/db/client';
import { dimPost, factPostLifetime, sourceFiles } from '../../src/db/schema';
import type { PostsService } from '../../src/posts/posts.service';
import { ZONE } from '../../src/analytics/xlsx-parser';

/**
 * Writes canonical rows for a post directly and marks it measured — the replacement
 * for the deleted `addManual` HTTP surface. Tests that need a measured post with
 * numbers use this instead of faking an export.
 *
 * The minted urn is synthetic (`urn:li:share:9<postId>`, zero-padded) so it can never
 * collide with a real LinkedIn id.
 */
export async function insertMeasured(db: ForgeDb, posts: PostsService, input: {
  postId: number;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number;
  followsGained?: number;
}): Promise<void> {
  const post = await posts.get(input.postId);
  const postUrn = `urn:li:share:9${String(input.postId).padStart(18, '0')}`;
  const asOfDate = DateTime.now().setZone(ZONE).toFormat('yyyy-MM-dd');

  const [file] = await db.insert(sourceFiles).values({
    sha256: `test:${randomUUID()}`,
    kind: 'single_post',
    originalName: `synthetic-post-${input.postId}.xlsx`,
    importedAt: new Date(),
    rawPath: null,
  }).returning();

  await db.insert(dimPost).values({
    postUrn,
    shareUrn: postUrn,
    postId: input.postId,
    linkedinUrl: post.linkedinUrl ?? `https://www.linkedin.com/posts/synthetic-${input.postId}`,
    publishedAt: post.publishedAt,
    firstSeenSourceFileId: file!.id,
  }).onConflictDoUpdate({
    target: dimPost.postUrn,
    set: { postId: input.postId, firstSeenSourceFileId: file!.id },
  });

  const metrics: [string, number][] = [
    ['impressions', input.impressions],
    ['reactions', input.reactions],
    ['comments', input.comments],
    ['reposts', input.reposts],
    ['saves', input.saves],
  ];
  if (input.followsGained !== undefined) metrics.push(['follows_gained', input.followsGained]);

  await db.insert(factPostLifetime).values(
    metrics.map(([metric, value]) => ({ postUrn, metric, asOfDate, value, sourceFileId: file!.id })),
  ).onConflictDoUpdate({
    target: [factPostLifetime.postUrn, factPostLifetime.metric, factPostLifetime.asOfDate],
    set: { value: sql.raw('excluded."value"'), sourceFileId: file!.id },
  });

  await posts.markMeasured(input.postId);
}
