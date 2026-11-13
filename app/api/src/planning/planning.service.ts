import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { PostStatus, PostTier } from '@forge/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { IdeasService } from '../ideas/ideas.service';
import { RetroService } from '../playbook/retro.service';
import { postLabel, PostsService, type PostRow } from '../posts/posts.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Consecutive weeks meeting `goal`, anchored at `now`: the in-progress week counts only once it
 * already meets the goal (so a fresh week never breaks a streak), then walk back while each
 * complete week meets it. Raising the goal restates history — that is deliberate.
 */
export function computeStreak(published: DateTime[], goal: number, now: DateTime): number {
  const counts = new Map<string, number>();
  for (const d of published) {
    const key = d.startOf('week').toISODate()!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let streak = (counts.get(now.startOf('week').toISODate()!) ?? 0) >= goal ? 1 : 0;
  let week = now.startOf('week').minus({ weeks: 1 });
  while ((counts.get(week.toISODate()!) ?? 0) >= goal) {
    streak += 1;
    week = week.minus({ weeks: 1 });
  }
  return streak;
}

export interface PlannerPostItem {
  id: number; title: string; tier: PostTier; status: PostStatus;
  scheduledTime: string | null; publishedAt: string | null;
}
export interface PlannerDayLane { date: string; posts: PlannerPostItem[] }
export interface MonthDaySummary { date: string; scheduled: number; published: number }
export interface QueueItem { id: number; title: string; tier: PostTier; status: PostStatus }
export interface GoalProgress { target: number; publishedInWeek: number }
export interface PlannerData {
  weekStart: string; month: MonthDaySummary[]; week: PlannerDayLane[];
  queue: QueueItem[]; goal: GoalProgress | null; streakWeeks: number | null;
}
/**
 * The agenda-stream payload: an arbitrary inclusive `from..to` day range instead of a fixed week.
 * `goal`/`streakWeeks` are scoped to TODAY's week — the stream has no "selected week".
 */
export interface PlannerStream {
  days: PlannerDayLane[];
  /** Posts strictly before `from`: missed schedules AND published history. */
  earlierCount: number;
  month: MonthDaySummary[];
  queue: QueueItem[];
  goal: GoalProgress | null;
  streakWeeks: number | null;
}
export interface UpcomingItem {
  id: number; title: string; tier: PostTier; status: PostStatus;
  scheduledDate: string; scheduledTime: string | null;
}
export interface PendingAction { kind: string; label: string; href: string }
export interface StatusMixEntry { status: PostStatus; count: number }
export interface Dashboard {
  upcoming: UpcomingItem[]; goal: GoalProgress | null;
  streakWeeks: number | null; pendingActions: PendingAction[];
  /** Every status with at least one post; zero-count statuses are omitted. */
  statusMix: StatusMixEntry[];
  /** The `upcoming` predicate, uncapped — `upcoming` itself is sliced to 5. */
  scheduledCount: number;
}

type PublishedRow = PostRow & { publishedAt: Date };

/** One post occupies exactly one calendar day, everywhere it is shown. */
interface Placement { day: string; published: boolean; sortKey: string; item: PlannerPostItem }

/** Raw `time` columns are 'HH:MM:SS'; every DTO emits 'HH:mm'. */
function trimTime(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

/**
 * Codepoint order, NOT `localeCompare` — the nulls-last sentinel '~' collates BEFORE digits under
 * ICU, which silently inverts "untimed goes last".
 */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Generic over the row, so the list's wider item type (PostListItem) narrows the same way PostRow does.
const isPublished = <T extends PostRow>(p: T): p is T & { publishedAt: Date } => p.publishedAt !== null;
const isScheduled = <T extends PostRow>(p: T): p is T & { scheduledDate: string } => p.publishedAt === null && p.scheduledDate !== null;

@Injectable()
export class PlanningService {
  constructor(
    private readonly posts: PostsService,
    private readonly ideas: IdeasService,
    private readonly analytics: AnalyticsService,
    private readonly retro: RetroService,
    private readonly settings: SettingsService,
  ) {}

  async plannerData(dateIso?: string, nowOverride?: DateTime): Promise<PlannerData> {
    const { zone, now, weeklyGoal } = await this.context(nowOverride);

    let anchor = now;
    if (dateIso !== undefined) {
      const parsed = DateTime.fromISO(dateIso, { zone });
      if (!parsed.isValid) throw new BadRequestException('invalid date: expected an ISO date');
      anchor = parsed;
    }
    const weekStart = anchor.startOf('week');
    const monthStart = anchor.startOf('month');
    // the ISO week containing the 1st/last of a month spills outside it — cover the union
    const from = DateTime.min(weekStart, monthStart);
    const to = DateTime.max(weekStart.plus({ weeks: 1 }), monthStart.plus({ months: 1 }));

    const all = await this.posts.list();
    const published = all.filter(isPublished);
    const scheduled = await this.posts.scheduledInRange(from.toISODate()!, to.toISODate()!);
    const byDay = this.placeByDay(scheduled, published, zone);

    return {
      weekStart: weekStart.toISODate()!,
      month: this.monthSummary(byDay, monthStart),
      week: this.lanes(byDay, weekStart, 7),
      queue: this.queueOf(all),
      ...this.goalAndStreak(weeklyGoal, published, zone, weekStart, now),
    };
  }

  /**
   * The agenda stream: `from`/`to` are inclusive settings-zone day boundaries and every calendar
   * day between them gets a lane, empty ones included. `plannerData` (week-shaped) is untouched.
   */
  async plannerStream(q: { from: string; to: string; month?: string }, nowOverride?: DateTime): Promise<PlannerStream> {
    const { zone, now, weeklyGoal } = await this.context(nowOverride);

    const day = (iso: string, label: string): DateTime => {
      const parsed = DateTime.fromISO(iso, { zone });
      if (!parsed.isValid) throw new BadRequestException(`invalid ${label}: expected an ISO date`);
      return parsed.startOf('day');
    };
    const from = day(q.from, 'from');
    const to = day(q.to, 'to');
    if (to < from) throw new BadRequestException('invalid range: `from` must not be after `to`');
    const span = Math.round(to.diff(from, 'days').days) + 1;
    if (span > 366) throw new BadRequestException('invalid range: spans longer than 366 days are not served');
    const monthStart = (q.month === undefined ? from : day(q.month, 'month')).startOf('month');

    // the mini-month is decoupled from the stream range, so placement must cover their union
    const coverFrom = DateTime.min(from, monthStart);
    const coverToExclusive = DateTime.max(to.plus({ days: 1 }), monthStart.plus({ months: 1 }));

    const all = await this.posts.list();
    const published = all.filter(isPublished);
    const scheduled = await this.posts.scheduledInRange(coverFrom.toISODate()!, coverToExclusive.toISODate()!);
    const byDay = this.placeByDay(scheduled, published, zone);

    const fromIso = from.toISODate()!;
    const earlierCount =
      all.filter(isScheduled).filter((p) => p.scheduledDate < fromIso).length
      + published.filter((p) => DateTime.fromJSDate(p.publishedAt).setZone(zone).toISODate()! < fromIso).length;

    return {
      days: this.lanes(byDay, from, span),
      earlierCount,
      month: this.monthSummary(byDay, monthStart),
      queue: this.queueOf(all),
      ...this.goalAndStreak(weeklyGoal, published, zone, now.startOf('week'), now),
    };
  }

  /** `count` consecutive day lanes from `start`, each sorted by the placement sort key. */
  private lanes(byDay: Map<string, Placement[]>, start: DateTime, count: number): PlannerDayLane[] {
    return Array.from({ length: count }, (_, i) => {
      const date = start.plus({ days: i }).toISODate()!;
      const lane = [...(byDay.get(date) ?? [])].sort((a, b) => cmp(a.sortKey, b.sortKey));
      return { date, posts: lane.map((p) => p.item) };
    });
  }

  private monthSummary(byDay: Map<string, Placement[]>, monthStart: DateTime): MonthDaySummary[] {
    return Array.from({ length: monthStart.daysInMonth! }, (_, i) => {
      const date = monthStart.plus({ days: i }).toISODate()!;
      const onDay = byDay.get(date) ?? [];
      return {
        date,
        scheduled: onDay.filter((p) => !p.published).length,
        published: onDay.filter((p) => p.published).length,
      };
    });
  }

  private queueOf(all: PostRow[]): QueueItem[] {
    return all
      .filter((p) => p.publishedAt === null && p.scheduledDate === null)
      // deliberate flip from posts.list's newest-first: the queue is a backlog, oldest drains first
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
      .map((p) => ({ id: p.id, title: postLabel(p), tier: p.tier, status: p.status }));
  }

  async dashboard(nowOverride?: DateTime): Promise<Dashboard> {
    const { zone, now, weeklyGoal } = await this.context(nowOverride);
    const today = now.toISODate()!;

    const all = await this.posts.list();
    const published = all.filter(isPublished);
    const upcomingRows = all.filter(isScheduled)
      .filter((p) => p.scheduledDate >= today)
      .sort((a, b) => cmp(a.scheduledDate, b.scheduledDate)
        // a timeless post lands at the end of its day, after every timed one
        || cmp(a.scheduledTime ?? '~', b.scheduledTime ?? '~')
        || a.id - b.id);

    const upcoming: UpcomingItem[] = upcomingRows.slice(0, 5).map((p) => ({
      id: p.id,
      title: postLabel(p),
      tier: p.tier,
      status: p.status,
      scheduledDate: p.scheduledDate,
      scheduledTime: trimTime(p.scheduledTime),
    }));

    const counts = new Map<PostStatus, number>();
    for (const p of all) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    const statusMix: StatusMixEntry[] = [...counts].map(([status, count]) => ({ status, count }));

    const pendingActions: PendingAction[] = [];

    const latest = await this.analytics.latestByPost();
    for (const p of all.filter((row) => row.status === 'published')) {
      if (p.publishedAt && now.toMillis() - p.publishedAt.getTime() > 48 * 3600_000 && !latest.has(p.id)) {
        pendingActions.push({ kind: 'ingest', label: `ingest analytics for post #${p.id}`, href: '/analytics' });
      }
    }

    // a post booked for a day that has not passed yet, with nothing written for it
    for (const p of upcomingRows) {
      if (p.status !== 'queued' && p.status !== 'drafting') continue;
      pendingActions.push({
        kind: 'undrafted',
        label: `「${postLabel(p)}」 scheduled ${p.scheduledDate}, not drafted`,
        href: '/planner',
      });
    }

    const newIdeas = await this.ideas.list({ status: ['new'] });
    if (newIdeas.length > 0) {
      pendingActions.push({ kind: 'untriaged', label: `${newIdeas.length} idea${newIdeas.length > 1 ? 's' : ''} untriaged`, href: '/backlog' });
    }
    for (const idea of await this.ideas.list({ status: ['new', 'triaged'] })) {
      if (!idea.newsExpiry) continue;
      const hoursLeft = (idea.newsExpiry.getTime() - now.toMillis()) / 3600_000;
      if (hoursLeft > 0 && hoursLeft <= 72) {
        const days = Math.max(1, Math.ceil(hoursLeft / 24));
        pendingActions.push({ kind: 'expiring', label: `idea "${idea.rawText.slice(0, 40)}" expires in ${days}d`, href: '/backlog' });
      }
    }

    const retro = await this.retro.eligibility();
    if (retro.eligible) {
      pendingActions.push({ kind: 'retro', label: `run retro — ${retro.measuredSince} posts measured since last`, href: '/playbook' });
    }

    return {
      upcoming,
      ...this.goalAndStreak(weeklyGoal, published, zone, now.startOf('week'), now),
      pendingActions,
      statusMix,
      scheduledCount: upcomingRows.length,
    };
  }

  private async context(nowOverride?: DateTime): Promise<{ zone: string; now: DateTime; weeklyGoal: number | null }> {
    const settings = await this.settings.get();
    const zone = settings.scheduling.timezone;
    return { zone, now: nowOverride ?? DateTime.now().setZone(zone), weeklyGoal: settings.scheduling.weeklyGoal };
  }

  /**
   * The placement rule: a published post counts ONLY on its published day (converted to the
   * configured zone) — its old `scheduledDate` is history. Everything else counts on the day it
   * is scheduled for. `scheduled` is already publishedAt-free, so the two sets never overlap.
   */
  private placeByDay(scheduled: PostRow[], published: PublishedRow[], zone: string): Map<string, Placement[]> {
    const byDay = new Map<string, Placement[]>();
    const push = (p: Placement) => byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);

    for (const p of scheduled) {
      const time = trimTime(p.scheduledTime);
      push({
        day: p.scheduledDate!,
        published: false,
        // untimed posts sort after timed ones on the same day; id keeps it stable
        sortKey: `${time ?? '~'}#${String(p.id).padStart(9, '0')}`,
        item: this.item(p, zone, time),
      });
    }
    for (const p of published) {
      const at = DateTime.fromJSDate(p.publishedAt).setZone(zone);
      push({
        day: at.toISODate()!,
        published: true,
        sortKey: `${at.toFormat('HH:mm')}#${String(p.id).padStart(9, '0')}`,
        // a published post has no schedule by invariant (publish() clears both columns). Passing
        // null rather than the stored time keeps the chip honest even for a row written by a path
        // that bypassed publish() — the time belonged to a plan for a possibly different day.
        item: this.item(p, zone, null),
      });
    }
    return byDay;
  }

  private item(p: PostRow, zone: string, scheduledTime: string | null): PlannerPostItem {
    return {
      id: p.id,
      title: postLabel(p),
      tier: p.tier,
      status: p.status,
      scheduledTime,
      publishedAt: p.publishedAt === null ? null : DateTime.fromJSDate(p.publishedAt).setZone(zone).toISO(),
    };
  }

  /**
   * `goal` scopes to the SELECTED week; `streakWeeks` is always anchored at today, so paging the
   * planner back through history never rewrites the streak badge.
   */
  private goalAndStreak(
    weeklyGoal: number | null, published: PublishedRow[], zone: string, weekStart: DateTime, now: DateTime,
  ): { goal: GoalProgress | null; streakWeeks: number | null } {
    if (weeklyGoal === null) return { goal: null, streakWeeks: null };
    // `measured` posts are published too — the predicate is publishedAt, never the status
    const days = published.map((p) => DateTime.fromJSDate(p.publishedAt).setZone(zone));
    const weekKey = weekStart.startOf('week').toISODate();
    const publishedInWeek = days.filter((d) => d.startOf('week').toISODate() === weekKey).length;
    return {
      goal: { target: weeklyGoal, publishedInWeek },
      streakWeeks: computeStreak(days, weeklyGoal, now),
    };
  }
}
