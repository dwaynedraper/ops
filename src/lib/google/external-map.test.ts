import { describe, it, expect } from 'vitest';
import { instantToZoned, mapGoogleEvent, type GoogleEventRaw } from './external-map';

const CAL = { color: '#7986cb', name: 'Personal', isOpsCalendar: false };

describe('instantToZoned', () => {
  it('converts an RFC3339 instant to civil date+clock in Chicago (CDT)', () => {
    expect(instantToZoned('2026-08-24T19:00:00Z', 'America/Chicago')).toEqual({
      date: '2026-08-24',
      clock: '14:00',
    });
  });
  it('handles the midnight boundary (24→00)', () => {
    expect(instantToZoned('2026-08-25T05:00:00Z', 'America/Chicago')).toEqual({
      date: '2026-08-25',
      clock: '00:00',
    });
  });
});

describe('mapGoogleEvent', () => {
  const zone = 'America/Chicago';

  it('maps a timed event with computed duration', () => {
    const ev: GoogleEventRaw = {
      id: 'e1',
      summary: 'Dentist',
      start: { dateTime: '2026-08-24T19:00:00Z' },
      end: { dateTime: '2026-08-24T20:30:00Z' },
    };
    const item = mapGoogleEvent(ev, zone, CAL);
    expect(item).toMatchObject({ title: 'Dentist', date: '2026-08-24', startClock: '14:00', durationMin: 90, busy: true });
  });

  it('maps an all-day event (no clock, zero duration)', () => {
    const ev: GoogleEventRaw = { id: 'e2', summary: 'Anniversary', start: { date: '2026-08-24' } };
    const item = mapGoogleEvent(ev, zone, CAL);
    expect(item).toMatchObject({ date: '2026-08-24', startClock: null, durationMin: 0 });
  });

  it('marks a transparent (free) event not-busy', () => {
    const ev: GoogleEventRaw = {
      id: 'e3', summary: 'Tentative', transparency: 'transparent',
      start: { dateTime: '2026-08-24T19:00:00Z' }, end: { dateTime: '2026-08-24T20:00:00Z' },
    };
    expect(mapGoogleEvent(ev, zone, CAL)?.busy).toBe(false);
  });

  it('falls back to (busy) when there is no title', () => {
    const ev: GoogleEventRaw = { id: 'e4', start: { date: '2026-08-24' } };
    expect(mapGoogleEvent(ev, zone, CAL)?.title).toBe('(busy)');
  });

  it('drops cancelled events', () => {
    const ev: GoogleEventRaw = { id: 'e5', status: 'cancelled', start: { date: '2026-08-24' } };
    expect(mapGoogleEvent(ev, zone, CAL)).toBeNull();
  });

  it('drops our own Ops events (avoid double-render)', () => {
    const tagged: GoogleEventRaw = {
      id: 'e6', summary: 'Record Reel', start: { dateTime: '2026-08-24T19:00:00Z' },
      extendedProperties: { private: { opsBlock: 'true' } },
    };
    expect(mapGoogleEvent(tagged, zone, CAL)).toBeNull();
    // …and the whole Sharp Sighted calendar is skipped wholesale.
    const onOpsCal: GoogleEventRaw = { id: 'e7', summary: 'x', start: { date: '2026-08-24' } };
    expect(mapGoogleEvent(onOpsCal, zone, { ...CAL, isOpsCalendar: true })).toBeNull();
  });

  it('drops an event with no start', () => {
    expect(mapGoogleEvent({ id: 'e8', summary: 'broken' }, zone, CAL)).toBeNull();
  });
});
