import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  addDays, addMonths, dayIndexMonday, daysLeft, durationS, elideDataUris, fmtNum, fmtUsd, todayIso,
} from './format';

describe('fmtNum', () => {
  it('rounds and groups thousands', () => {
    expect(fmtNum(1234.6)).toBe('1,235');
    expect(fmtNum(1234567)).toBe('1,234,567');
  });

  it('renders zero as zero', () => {
    expect(fmtNum(0)).toBe('0');
  });
});

describe('fmtUsd', () => {
  it('shows four decimals', () => {
    expect(fmtUsd(1.23456)).toBe('$1.2346');
    expect(fmtUsd(0.5)).toBe('$0.5000');
  });

  it('says <$0.0001 rather than letting a real cost round to free', () => {
    expect(fmtUsd(0.00005)).toBe('<$0.0001');
  });

  it('leaves exactly 0.0001 above the guard, and true zero below it', () => {
    expect(fmtUsd(0.0001)).toBe('$0.0001');
    expect(fmtUsd(0)).toBe('$0.0000');
  });
});

describe('durationS', () => {
  it('renders whole seconds between two instants', () => {
    expect(durationS('2026-08-12T10:00:00.000Z', '2026-08-12T10:01:30.000Z')).toBe('90s');
  });

  it('rounds to the nearest second', () => {
    expect(durationS('2026-08-12T10:00:00.000Z', '2026-08-12T10:00:01.500Z')).toBe('2s');
  });

  it('shows an ellipsis while the end is still unknown', () => {
    expect(durationS('2026-08-12T10:00:00.000Z', null)).toBe('…');
  });
});

describe('elideDataUris', () => {
  it('replaces an embedded base64 image with a marker', () => {
    expect(elideDataUris('before data:image/png;base64,iVBORw0KGgo= after'))
      .toBe('before data:image/…;base64,…[elided] after');
  });

  it('elides every occurrence', () => {
    const text = 'data:image/png;base64,AAAA and data:image/jpeg;base64,BBBB';
    expect(elideDataUris(text)).toBe('data:image/…;base64,…[elided] and data:image/…;base64,…[elided]');
  });

  it('leaves text without a data URI untouched', () => {
    expect(elideDataUris('a plain prompt about images')).toBe('a plain prompt about images');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year boundary backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is a no-op for zero', () => {
    expect(addDays('2026-08-12', 0)).toBe('2026-08-12');
  });
});

describe('addMonths', () => {
  // setDate(1) runs BEFORE setMonth, so this snaps to the first of the target
  // month. It does not clamp to the target month's last day: 01-31 + 1 month is
  // 02-01, not 02-28. Callers use it to walk the planner's month strip.
  it('snaps to the first of the target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-08-12', 1)).toBe('2026-09-01');
  });

  it('walks backwards the same way', () => {
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
  });
});

describe('dayIndexMonday', () => {
  it('puts monday at 0 and sunday at 6', () => {
    expect(dayIndexMonday('2026-08-31')).toBe(0); // a monday
    expect(dayIndexMonday('2026-09-06')).toBe(6); // the sunday that closes that week
  });

  it('indexes a midweek day', () => {
    expect(dayIndexMonday('2026-09-01')).toBe(1); // tuesday
  });
});

describe('the clock-dependent pair', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('todayIso reports the São Paulo calendar day, not the UTC one', () => {
    vi.useFakeTimers();
    // 02:00 UTC is still the previous evening in São Paulo (UTC-3).
    vi.setSystemTime(new Date('2026-08-12T02:00:00.000Z'));
    expect(todayIso()).toBe('2026-08-11');
  });

  it('todayIso agrees with UTC when the two zones are on the same day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T15:00:00.000Z'));
    expect(todayIso()).toBe('2026-08-12');
  });

  it('daysLeft rounds up toward the target', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    expect(daysLeft('2026-08-15T00:00:00.000Z')).toBe(3);
    expect(daysLeft('2026-08-15T01:00:00.000Z')).toBe(4);
  });

  it('daysLeft floors at zero once the target is past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    expect(daysLeft('2026-08-01T00:00:00.000Z')).toBe(0);
  });
});
