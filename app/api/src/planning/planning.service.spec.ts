import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { computeStreak } from './planning.service';
import { postLabel } from '../posts/posts.service';

const TZ = 'America/Sao_Paulo';

describe('computeStreak', () => {
  const now = DateTime.fromISO('2026-07-16T12:00:00', { zone: TZ }); // Thursday of the week of 07-13
  const week = (iso: string, n: number) =>
    Array.from({ length: n }, (_, i) => DateTime.fromISO(iso, { zone: TZ }).plus({ days: i }));

  it('counts consecutive complete weeks meeting the goal', () => {
    const published = [...week('2026-07-06', 3), ...week('2026-06-29', 3)]; // two prior full weeks
    expect(computeStreak(published, 3, now)).toBe(2);
  });

  it('does not let an in-progress week that has not met the goal break the streak', () => {
    // nothing published yet this week, but the two prior weeks met the goal
    const published = [...week('2026-07-06', 3), ...week('2026-06-29', 3)];
    expect(computeStreak(published, 3, now)).toBe(2);
    // one post this week is still short of 3 — the prior weeks still count, the current one does not
    expect(computeStreak([...published, ...week('2026-07-13', 1)], 3, now)).toBe(2);
  });

  it('includes the current week once it qualifies, and breaks on a short prior week', () => {
    expect(computeStreak(week('2026-07-06', 2), 3, now)).toBe(0); // prior week only had 2
    const withCurrent = [...week('2026-07-06', 3), ...week('2026-07-13', 3)];
    expect(computeStreak(withCurrent, 3, now)).toBe(2); // prior + current
  });

  it('is 0 with no history, and restates history when the goal is raised', () => {
    expect(computeStreak([], 3, now)).toBe(0);
    const published = [...week('2026-07-13', 2), ...week('2026-07-06', 2), ...week('2026-06-29', 2)];
    expect(computeStreak(published, 2, now)).toBe(3);
    expect(computeStreak(published, 3, now)).toBe(0); // raising the goal invalidates every week
  });

  it('counts a streak straight through a month and year boundary', () => {
    // the ISO week mon 2026-12-28 .. sun 2027-01-03 spans both boundaries at once;
    // 2027-01-04 is the Monday after it, so this Thursday sits in the following week
    const newYear = DateTime.fromISO('2027-01-07T12:00:00', { zone: TZ });
    const published = [...week('2027-01-04', 2), ...week('2026-12-28', 2), ...week('2026-12-21', 2)];
    expect(computeStreak(published, 2, newYear)).toBe(3);
    // dropping the straddling week breaks the chain there rather than counting past it
    const gapped = [...week('2027-01-04', 2), ...week('2026-12-21', 2)];
    expect(computeStreak(gapped, 2, newYear)).toBe(1);
  });

  it('buckets by the ISO (Monday-start) week of each publish moment', () => {
    // Sunday 2026-07-12 belongs to the week starting 2026-07-06, not to the current one
    const sunday = [DateTime.fromISO('2026-07-12T23:30:00', { zone: TZ })];
    expect(computeStreak(sunday, 1, now)).toBe(1);   // counted as the (complete) prior week
    const monday = [DateTime.fromISO('2026-07-13T00:30:00', { zone: TZ })];
    expect(computeStreak(monday, 1, now)).toBe(1);   // counted as the in-progress week, which now qualifies
    expect(computeStreak([...sunday, ...monday], 1, now)).toBe(2);
  });
});

describe('postLabel', () => {
  it('prefers the hook, then the body, then a bare post number', () => {
    expect(postLabel({ id: 7, hook: 'the hybrid arc', bodyLinkedin: 'a long body' })).toBe('the hybrid arc');
    expect(postLabel({ id: 7, hook: null, bodyLinkedin: 'a long body' })).toBe('a long body');
    expect(postLabel({ id: 7, hook: null, bodyLinkedin: null })).toBe('post #7');
  });

  it('truncates to 80 characters', () => {
    const body = 'x'.repeat(200);
    expect(postLabel({ id: 1, hook: null, bodyLinkedin: body })).toHaveLength(80);
    const exact = 'y'.repeat(80);
    expect(postLabel({ id: 1, hook: exact, bodyLinkedin: null })).toBe(exact); // 80 is not truncated
    expect(postLabel({ id: 1, hook: 'z'.repeat(81), bodyLinkedin: null })).toBe('z'.repeat(80));
  });
});
