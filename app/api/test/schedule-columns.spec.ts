import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb, type ForgeDb } from '../src/db/client';
import { posts } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('scheduled_date / scheduled_time columns', () => {
  let db: ForgeDb;

  beforeAll(async () => {
    await migrateDb(url);
    db = createDb(url);
  });

  it('round-trips date and time as strings, defaults null', async () => {
    const [bare] = await db.insert(posts).values({ tier: 'T3' }).returning();
    expect(bare!.scheduledDate).toBeNull();
    expect(bare!.scheduledTime).toBeNull();

    const [row] = await db.insert(posts)
      .values({ tier: 'T3', scheduledDate: '2027-04-02', scheduledTime: '10:30' })
      .returning();
    const [read] = await db.select().from(posts).where(eq(posts.id, row!.id));
    expect(read!.scheduledDate).toBe('2027-04-02');       // string, not Date
    expect(read!.scheduledTime).toBe('10:30:00');          // pg normalizes HH:mm
    await db.delete(posts).where(eq(posts.id, row!.id));
    await db.delete(posts).where(eq(posts.id, bare!.id));
  });
});
