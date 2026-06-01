import { describe, it, expect } from 'vitest';
import { rankRepPulse, type RepPulseRow } from './rep-pulse';

function rep(over: Partial<RepPulseRow>): RepPulseRow {
  return { repId: 'r', repName: 'Rep', signed: 0, booked: 0, revenue: 0, ...over };
}

describe('rankRepPulse', () => {
  it('ranks by revenue, then signed, then booked', () => {
    const ranked = rankRepPulse([
      rep({ repId: 'a', revenue: 1000, signed: 1 }),
      rep({ repId: 'b', revenue: 3000, signed: 0 }),
      rep({ repId: 'c', revenue: 1000, signed: 3 }),
    ]);
    expect(ranked.map((r) => r.repId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a revenue+signed tie on bookings', () => {
    const ranked = rankRepPulse([
      rep({ repId: 'x', revenue: 500, signed: 2, booked: 1 }),
      rep({ repId: 'y', revenue: 500, signed: 2, booked: 4 }),
    ]);
    expect(ranked.map((r) => r.repId)).toEqual(['y', 'x']);
  });

  it('drops reps with no activity at all', () => {
    const ranked = rankRepPulse([
      rep({ repId: 'active', booked: 1 }),
      rep({ repId: 'idle' }),
    ]);
    expect(ranked.map((r) => r.repId)).toEqual(['active']);
  });

  it('keeps a rep who only booked (no revenue yet)', () => {
    expect(rankRepPulse([rep({ repId: 'newbie', booked: 2 })])).toHaveLength(1);
  });
});
