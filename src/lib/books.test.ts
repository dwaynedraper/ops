import { describe, it, expect } from 'vitest';
import {
  resolveMonth,
  shiftMonth,
  incomeToWave,
  expensesToWave,
  mileageToWave,
} from './books';

const NOW = new Date('2026-05-15T12:00:00Z');

describe('resolveMonth', () => {
  it('defaults to the current month', () => {
    const m = resolveMonth(null, NOW);
    expect(m.month).toBe('2026-05');
    expect(m.start).toBe('2026-05-01');
    expect(m.endExclusive).toBe('2026-06-01');
    expect(m.label).toBe('May 2026');
  });
  it('parses a given month and wraps December → January', () => {
    const dec = resolveMonth('2026-12', NOW);
    expect(dec.start).toBe('2026-12-01');
    expect(dec.endExclusive).toBe('2027-01-01');
  });
  it('falls back to current on a malformed key', () => {
    expect(resolveMonth('garbage', NOW).month).toBe('2026-05');
  });
});

describe('shiftMonth', () => {
  it('steps back across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('steps forward across a year boundary', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('Wave-row builders', () => {
  it('income is positive with a client/job/method description', () => {
    const rows = incomeToWave([
      { date: '2026-05-24', client: 'Sarah Chen', jobTitle: 'Fall family', method: 'check', amount: 450 },
    ]);
    expect(rows[0]).toEqual({
      date: '2026-05-24',
      description: 'Sarah Chen - Fall family (check)',
      amount: 450,
    });
  });
  it('expenses are negative', () => {
    const rows = expensesToWave([
      { date: '2026-05-10', vendor: 'B&H', category: 'gear', amount: 120, billable: false },
    ]);
    expect(rows[0].amount).toBe(-120);
    expect(rows[0].description).toBe('B&H - gear');
  });
  it('mileage is negative with miles + rate in the description', () => {
    const rows = mileageToWave([
      { date: '2026-05-12', purpose: 'Frisco shoot', miles: 40, rate: 0.725, amount: 29 },
    ]);
    expect(rows[0].amount).toBe(-29);
    expect(rows[0].description).toContain('40mi @ 0.725');
  });
});
