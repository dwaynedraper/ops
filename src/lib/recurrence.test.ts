import { describe, it, expect } from 'vitest';
import {
  toRRule,
  fromRRule,
  expandOccurrences,
  recurrenceSummary,
  NO_RECURRENCE,
  type Recurrence,
} from './recurrence';

function rec(over: Partial<Recurrence>): Recurrence {
  return { ...NO_RECURRENCE, ...over };
}

describe('toRRule / fromRRule round-trip', () => {
  it('none → null', () => {
    expect(toRRule(NO_RECURRENCE)).toBeNull();
    expect(fromRRule(null)).toEqual(NO_RECURRENCE);
  });
  it('every Tuesday weekly', () => {
    const r = rec({ freq: 'weekly', byDay: [2] });
    expect(toRRule(r)).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(fromRRule('FREQ=WEEKLY;BYDAY=TU')).toMatchObject({ freq: 'weekly', byDay: [2], interval: 1 });
  });
  it('every other week on Mon+Wed, 10 times', () => {
    const r = rec({ freq: 'weekly', interval: 2, byDay: [1, 3], count: 10 });
    expect(toRRule(r)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10');
    const back = fromRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10');
    expect(back).toMatchObject({ freq: 'weekly', interval: 2, byDay: [1, 3], count: 10, until: null });
  });
  it('daily until a date', () => {
    const r = rec({ freq: 'daily', until: '2026-09-01' });
    expect(toRRule(r)).toBe('FREQ=DAILY;UNTIL=20260901');
    expect(fromRRule('FREQ=DAILY;UNTIL=20260901')).toMatchObject({ freq: 'daily', until: '2026-09-01' });
  });
  it('unknown rule degrades to none', () => {
    expect(fromRRule('FREQ=MONTHLY;BYMONTHDAY=15')).toEqual(NO_RECURRENCE);
  });
});

describe('expandOccurrences — one-off', () => {
  it('emits the master date only when in window', () => {
    expect(expandOccurrences('2026-06-10', null, '2026-06-01', '2026-06-30')).toEqual(['2026-06-10']);
    expect(expandOccurrences('2026-07-10', null, '2026-06-01', '2026-06-30')).toEqual([]);
  });
  it('respects a skip', () => {
    expect(
      expandOccurrences('2026-06-10', null, '2026-06-01', '2026-06-30', new Set(['2026-06-10'])),
    ).toEqual([]);
  });
});

describe('expandOccurrences — weekly', () => {
  it('every Tuesday across a month (2026-06-02 is the first Tue)', () => {
    // master starts Tue Jun 2; window the whole month.
    const occ = expandOccurrences('2026-06-02', 'FREQ=WEEKLY;BYDAY=TU', '2026-06-01', '2026-06-30');
    expect(occ).toEqual(['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']);
  });
  it('never emits before the master start even if window opens earlier', () => {
    const occ = expandOccurrences('2026-06-16', 'FREQ=WEEKLY;BYDAY=TU', '2026-06-01', '2026-06-30');
    expect(occ).toEqual(['2026-06-16', '2026-06-23', '2026-06-30']);
  });
  it('every other week halves the cadence', () => {
    const occ = expandOccurrences('2026-06-02', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-06-01', '2026-06-30');
    expect(occ).toEqual(['2026-06-02', '2026-06-16', '2026-06-30']);
  });
  it('COUNT caps total occurrences regardless of window', () => {
    const occ = expandOccurrences('2026-06-02', 'FREQ=WEEKLY;BYDAY=TU;COUNT=2', '2026-06-01', '2026-12-31');
    expect(occ).toEqual(['2026-06-02', '2026-06-09']);
  });
  it('multi-day weekly (Mon+Thu) lands both days each week', () => {
    // Jun 1 2026 is a Monday.
    const occ = expandOccurrences('2026-06-01', 'FREQ=WEEKLY;BYDAY=MO,TH', '2026-06-01', '2026-06-14');
    expect(occ).toEqual(['2026-06-01', '2026-06-04', '2026-06-08', '2026-06-11']);
  });
});

describe('expandOccurrences — daily + UNTIL', () => {
  it('daily stops on UNTIL', () => {
    const occ = expandOccurrences('2026-06-01', 'FREQ=DAILY;UNTIL=20260604', '2026-06-01', '2026-06-30');
    expect(occ).toEqual(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
  });
  it('every 3rd day', () => {
    const occ = expandOccurrences('2026-06-01', 'FREQ=DAILY;INTERVAL=3', '2026-06-01', '2026-06-10');
    expect(occ).toEqual(['2026-06-01', '2026-06-04', '2026-06-07', '2026-06-10']);
  });
  it('window clips the visible set without losing the schedule', () => {
    const occ = expandOccurrences('2026-06-01', 'FREQ=DAILY', '2026-06-05', '2026-06-07');
    expect(occ).toEqual(['2026-06-05', '2026-06-06', '2026-06-07']);
  });
});

describe('recurrenceSummary', () => {
  it('reads naturally', () => {
    expect(recurrenceSummary(NO_RECURRENCE)).toBe('Does not repeat');
    expect(recurrenceSummary(rec({ freq: 'weekly', byDay: [2] }))).toBe('Every week on Tue');
    expect(recurrenceSummary(rec({ freq: 'weekly', interval: 2, byDay: [1, 3] }))).toBe('Every 2 weeks on Mon, Wed');
    expect(recurrenceSummary(rec({ freq: 'daily' }))).toBe('Every day');
    expect(recurrenceSummary(rec({ freq: 'weekly', byDay: [5], count: 6 }))).toBe('Every week on Fri, 6×');
  });
});
