import { describe, it, expect } from 'vitest';
import { localStartEnd, blockToGoogleEvent, rruleFromGoogle } from './event-map';

describe('localStartEnd', () => {
  it('builds naive local start/end for a 1h block', () => {
    expect(localStartEnd('2026-08-24', '14:00', 60)).toEqual({
      start: '2026-08-24T14:00:00',
      end: '2026-08-24T15:00:00',
    });
  });
  it('rolls past midnight when duration crosses the day', () => {
    expect(localStartEnd('2026-08-24', '23:30', 60)).toEqual({
      start: '2026-08-24T23:30:00',
      end: '2026-08-25T00:30:00',
    });
  });
  it('handles a 90-minute block', () => {
    expect(localStartEnd('2026-08-24', '09:15', 90).end).toBe('2026-08-24T10:45:00');
  });
});

describe('blockToGoogleEvent', () => {
  const base = {
    title: 'Record Reel',
    notes: null as string | null,
    date: '2026-08-24',
    startClock: '14:00',
    durationMin: 60,
    timeZone: 'America/Chicago',
    rrule: null as string | null,
  };

  it('maps a one-off with summary, zoned start/end, and the ops tag', () => {
    const ev = blockToGoogleEvent(base);
    expect(ev.summary).toBe('Record Reel');
    expect(ev.start).toEqual({ dateTime: '2026-08-24T14:00:00', timeZone: 'America/Chicago' });
    expect(ev.end).toEqual({ dateTime: '2026-08-24T15:00:00', timeZone: 'America/Chicago' });
    expect(ev.extendedProperties.private.opsBlock).toBe('true');
    expect(ev.recurrence).toBeUndefined();
    expect(ev.description).toBeUndefined();
  });

  it('includes notes as description when present', () => {
    expect(blockToGoogleEvent({ ...base, notes: '  golden hour  ' }).description).toBe('golden hour');
  });

  it('prefixes the stored RRULE and wraps it in an array', () => {
    const ev = blockToGoogleEvent({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    expect(ev.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU']);
  });
});

describe('rruleFromGoogle', () => {
  it('strips the prefix and ignores EXDATE/RDATE lines', () => {
    expect(rruleFromGoogle(['RRULE:FREQ=DAILY;COUNT=3'])).toBe('FREQ=DAILY;COUNT=3');
    expect(rruleFromGoogle(['EXDATE;TZID=America/Chicago:20260825T140000', 'RRULE:FREQ=WEEKLY'])).toBe('FREQ=WEEKLY');
  });
  it('is null for none / empty', () => {
    expect(rruleFromGoogle(null)).toBeNull();
    expect(rruleFromGoogle([])).toBeNull();
    expect(rruleFromGoogle(['EXDATE:20260825'])).toBeNull();
  });
});
