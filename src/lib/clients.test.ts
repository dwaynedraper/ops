import { describe, it, expect } from 'vitest';
import { clientInitials, clientMatches, clientSubtitle } from './clients';

describe('clientInitials', () => {
  it('takes first + last initial', () => {
    expect(clientInitials('Sarah Chen')).toBe('SC');
  });
  it('handles a single name (first two letters)', () => {
    expect(clientInitials('Acme')).toBe('AC');
  });
  it('ignores extra whitespace and middle names', () => {
    expect(clientInitials('  Mary  Jane  Watson ')).toBe('MW');
  });
  it('falls back to ? on empty', () => {
    expect(clientInitials('   ')).toBe('?');
  });
});

describe('clientMatches', () => {
  const c = { displayName: 'Sarah Chen', email: 'sarah@acme.com', marketArea: 'Frisco' };

  it('matches on name, case-insensitive', () => {
    expect(clientMatches('SARAH', c)).toBe(true);
  });
  it('matches on email and market area', () => {
    expect(clientMatches('acme.com', c)).toBe(true);
    expect(clientMatches('frisco', c)).toBe(true);
  });
  it('an empty query matches everything', () => {
    expect(clientMatches('   ', c)).toBe(true);
  });
  it('returns false when nothing matches', () => {
    expect(clientMatches('zzz', c)).toBe(false);
  });
  it('tolerates null email / market', () => {
    expect(clientMatches('jo', { displayName: 'Jo' })).toBe(true);
  });
});

describe('clientSubtitle', () => {
  it('joins present fields with a middot', () => {
    expect(
      clientSubtitle({ relationship: 'Past portrait client', marketArea: 'Frisco', email: null }),
    ).toBe('Past portrait client · Frisco');
  });
  it('falls back when everything is empty', () => {
    expect(clientSubtitle({})).toBe('No details yet');
  });
});
