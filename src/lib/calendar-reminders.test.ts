import { describe, it, expect } from 'vitest';
import { zonedToInstant } from './calendar-reminders';

describe('zonedToInstant — civil date+clock in a zone → UTC instant', () => {
  it('America/Chicago in CDT (summer, UTC−5): 2:00pm → 19:00Z', () => {
    const d = zonedToInstant('2026-06-15', '14:00', 'America/Chicago');
    expect(d?.toISOString()).toBe('2026-06-15T19:00:00.000Z');
  });

  it('America/Chicago in CST (winter, UTC−6): 2:00pm → 20:00Z', () => {
    const d = zonedToInstant('2026-01-15', '14:00', 'America/Chicago');
    expect(d?.toISOString()).toBe('2026-01-15T20:00:00.000Z');
  });

  it('UTC is identity', () => {
    const d = zonedToInstant('2026-06-15', '09:30', 'UTC');
    expect(d?.toISOString()).toBe('2026-06-15T09:30:00.000Z');
  });

  it('midnight resolves correctly (no 24h wrap)', () => {
    const d = zonedToInstant('2026-06-15', '00:00', 'America/Chicago');
    expect(d?.toISOString()).toBe('2026-06-15T05:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(zonedToInstant('nope', '14:00', 'America/Chicago')).toBeNull();
    expect(zonedToInstant('2026-06-15', '2pm', 'America/Chicago')).toBeNull();
  });
});
