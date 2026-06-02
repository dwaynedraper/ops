import { describe, it, expect } from 'vitest';
import {
  addDays,
  weekdayShort,
  weekdayIndex,
  weekStart,
  weekDays,
  glanceGrid,
  minutesOfDay,
  clockLabel,
  clockLabelUpper,
  timeRangeUpper,
  endClock,
  blockBox,
  isBlockType,
} from './calendar';

describe('civil date helpers', () => {
  it('addDays crosses month + year boundaries', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('weekday is correct (2026-08-19 is a Wednesday)', () => {
    expect(weekdayShort('2026-08-19')).toBe('Wed');
    expect(weekdayIndex('2026-08-19')).toBe(3);
  });
  it('weekStart returns the Sunday on or before', () => {
    expect(weekStart('2026-08-19')).toBe('2026-08-16'); // Sun
    expect(weekStart('2026-08-16')).toBe('2026-08-16'); // already Sun
  });
  it('weekDays is 7 days Sun..Sat', () => {
    const w = weekDays('2026-08-19');
    expect(w).toHaveLength(7);
    expect(w[0]).toBe('2026-08-16');
    expect(w[6]).toBe('2026-08-22');
  });
});

describe('glanceGrid — the dashboard 8-day strip', () => {
  it('is always 2 rows of 7 cells', () => {
    const g = glanceGrid('2026-08-19');
    expect(g).toHaveLength(2);
    expect(g[0]).toHaveLength(7);
    expect(g[1]).toHaveLength(7);
  });

  it('marks exactly 8 cells in-window (today + next 7)', () => {
    for (const today of [
      '2026-08-16', // Sun
      '2026-08-19', // Wed
      '2026-08-22', // Sat
      '2026-12-29', // crosses year
      '2026-02-25', // crosses month (non-leap Feb)
    ]) {
      const cells = glanceGrid(today).flat();
      expect(cells.filter((c) => c.inWindow)).toHaveLength(8);
    }
  });

  it('places items under the weekday column you expect (Wed example)', () => {
    const [row1, row2] = glanceGrid('2026-08-19'); // Wednesday
    // Row 1 is Sun..Sat of this week; today sits in the Wed column (index 3).
    expect(row1.map((c) => c.weekdayShort)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(row1[3].isToday).toBe(true);
    expect(row1[3].date).toBe('2026-08-19');
    // Days before today in row 1 are real but out of window (dimmed).
    expect(row1[0].inWindow).toBe(false); // Sun 16
    expect(row1[2].inWindow).toBe(false); // Tue 18
    expect(row1[3].inWindow).toBe(true); // Wed 19
    // Row 2 carries Sun..Wed in window (the +4..+7 days), then drops out.
    expect(row2[0].date).toBe('2026-08-23');
    expect(row2[0].inWindow).toBe(true); // Sun 23
    expect(row2[3].date).toBe('2026-08-26'); // the +7th day
    expect(row2[3].inWindow).toBe(true);
    expect(row2[4].inWindow).toBe(false); // Thu 27 — past the window
  });

  it('the in-window run is contiguous today..+7 for every weekday start', () => {
    // Prove the window never falls off the 14-cell grid, whatever day today is.
    for (let offset = 0; offset < 7; offset++) {
      const today = addDays('2026-08-16', offset); // Sun..Sat
      const cells = glanceGrid(today).flat();
      const windowDates = cells.filter((c) => c.inWindow).map((c) => c.date).sort();
      const expected = Array.from({ length: 8 }, (_, i) => addDays(today, i)).sort();
      expect(windowDates).toEqual(expected);
      // today is always present and flagged
      expect(cells.find((c) => c.isToday)?.date).toBe(today);
    }
  });

  it('when today is Saturday, the window wraps cleanly into row 2', () => {
    const [row1, row2] = glanceGrid('2026-08-22'); // Saturday
    expect(row1[6].isToday).toBe(true); // Sat in the last column of row 1
    expect(row1.slice(0, 6).every((c) => !c.inWindow)).toBe(true); // Sun..Fri dimmed
    expect(row2.every((c) => c.inWindow)).toBe(true); // all of next week in window (Sun..Sat = +1..+7)
  });
});

describe('time-column helpers', () => {
  it('minutesOfDay + clockLabel', () => {
    expect(minutesOfDay('14:00')).toBe(840);
    expect(clockLabel('14:00')).toBe('2:00pm');
    expect(clockLabel('09:30')).toBe('9:30am');
    expect(clockLabel('00:00')).toBe('12:00am');
  });
  it('clockLabelUpper is the glance style (9:00 AM)', () => {
    expect(clockLabelUpper('09:00')).toBe('9:00 AM');
    expect(clockLabelUpper('14:00')).toBe('2:00 PM');
    expect(clockLabelUpper('00:00')).toBe('12:00 AM');
    expect(clockLabelUpper('12:00')).toBe('12:00 PM');
  });
  it('timeRangeUpper drops the shared meridiem, keeps it across noon', () => {
    expect(timeRangeUpper('09:00', 60)).toBe('9:00 - 10:00 AM'); // both AM → collapse
    expect(timeRangeUpper('14:00', 90)).toBe('2:00 - 3:30 PM'); // both PM → collapse
    expect(timeRangeUpper('11:30', 60)).toBe('11:30 AM - 12:30 PM'); // crosses noon → keep both
    expect(timeRangeUpper('23:30', 60)).toBe('11:30 - 11:59 PM'); // clamps to day end, both PM
  });
  it('endClock adds duration and clamps to end of day', () => {
    expect(endClock('14:00', 60)).toBe('15:00');
    expect(endClock('23:30', 60)).toBe('23:59');
  });
  it('blockBox positions by the hour scale', () => {
    expect(blockBox(840, 60, 48)).toEqual({ top: 672, height: 48 }); // 14:00, 1h, 48px/hr
    expect(blockBox(840, 15, 48).height).toBe(18); // min legible height floor
  });
});

describe('isBlockType', () => {
  it('guards the enum', () => {
    expect(isBlockType('record')).toBe(true);
    expect(isBlockType('ten_percent')).toBe(true);
    expect(isBlockType('nope')).toBe(false);
  });
});
