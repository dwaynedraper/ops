import { describe, it, expect } from 'vitest';
import { buildJwtSigningInput, calendarSyncConfigured } from './auth';

function decodeSeg(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

const CREDS = {
  clientEmail: 'ops-sync@sharp.iam.gserviceaccount.com',
  privateKey: 'unused-here',
  impersonate: 'dean@sharpsightedstudio.com',
};

describe('buildJwtSigningInput', () => {
  const NOW = 1_750_000_000_000; // fixed epoch ms
  const input = buildJwtSigningInput(CREDS, NOW);
  const [headerSeg, claimsSeg, extra] = input.split('.');

  it('is exactly header.claims (no signature yet)', () => {
    expect(extra).toBeUndefined();
    expect(headerSeg && claimsSeg).toBeTruthy();
  });
  it('header is RS256 JWT', () => {
    expect(decodeSeg(headerSeg)).toEqual({ alg: 'RS256', typ: 'JWT' });
  });
  it('claims carry iss, sub (impersonation), scope, aud, and a 1h window', () => {
    const c = decodeSeg(claimsSeg) as Record<string, number | string>;
    expect(c.iss).toBe(CREDS.clientEmail);
    expect(c.sub).toBe(CREDS.impersonate); // domain-wide delegation target
    expect(c.scope).toBe('https://www.googleapis.com/auth/calendar');
    expect(c.aud).toBe('https://oauth2.googleapis.com/token');
    expect(c.iat).toBe(Math.floor(NOW / 1000));
    expect((c.exp as number) - (c.iat as number)).toBe(3600);
  });
  it('is base64url (no +, /, or = padding)', () => {
    expect(input).not.toMatch(/[+/=]/);
  });
});

describe('calendarSyncConfigured', () => {
  it('is false with no creds in the test env (the dormant default)', () => {
    // The test runner has none of the GOOGLE_* vars set → sync is dormant,
    // which is exactly the gate that keeps the calendar local-only.
    expect(calendarSyncConfigured()).toBe(false);
  });
});
