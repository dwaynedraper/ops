/**
 * Google service-account auth (Phase 6C). Mints a short-lived access token
 * for the Calendar API via the JWT-bearer grant, impersonating Dean's
 * Workspace user through domain-wide delegation (CALENDAR-AND-SYNC-PLAN §5.1).
 *
 * THE GATE: with no credentials configured, calendarSyncConfigured() is
 * false and callers must no-op. Everything Google-facing is dormant until
 * the admin setup (docs/google-calendar-setup.md) fills these env vars:
 *   GOOGLE_SA_CLIENT_EMAIL   service-account email
 *   GOOGLE_SA_PRIVATE_KEY    its PEM private key (\n-escaped is fine)
 *   GOOGLE_IMPERSONATE_EMAIL the Workspace user to act as (dean@…)
 *   GOOGLE_CALENDAR_ID       optional; else the "Sharp Sighted" cal is found/made
 *
 * No new dependencies — Node's built-in crypto signs the JWT, fetch does the
 * exchange. The JWT *assembly* is a pure exported function (tested); only
 * the network exchange and the RSA sign touch the outside world.
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

export interface GoogleCreds {
  clientEmail: string;
  privateKey: string;
  impersonate: string;
}

/** True only when every required credential is present. The whole sync layer
 * checks this first; false → silent no-op, calendar works as local-only. */
export function calendarSyncConfigured(): boolean {
  return (
    !!process.env.GOOGLE_SA_CLIENT_EMAIL &&
    !!process.env.GOOGLE_SA_PRIVATE_KEY &&
    !!process.env.GOOGLE_IMPERSONATE_EMAIL
  );
}

export function readCreds(): GoogleCreds | null {
  if (!calendarSyncConfigured()) return null;
  return {
    clientEmail: process.env.GOOGLE_SA_CLIENT_EMAIL as string,
    // Env vars commonly store the PEM with literal \n — restore real newlines.
    privateKey: (process.env.GOOGLE_SA_PRIVATE_KEY as string).replace(/\\n/g, '\n'),
    impersonate: process.env.GOOGLE_IMPERSONATE_EMAIL as string,
  };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build the signing input (header.claims, base64url) for a service-account
 * JWT. Pure + deterministic given `now` — exported so the claim set can be
 * unit-tested without a private key. The RSA signature is appended by
 * signJwt below.
 */
export function buildJwtSigningInput(creds: GoogleCreds, now: number): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const claims = {
    iss: creds.clientEmail,
    sub: creds.impersonate, // domain-wide delegation: act as this user
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600, // max 1 hour
  };
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
}

/** Sign the JWT with the SA private key (RS256). */
function signJwt(creds: GoogleCreds, now: number): string {
  const signingInput = buildJwtSigningInput(creds, now);
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(creds.privateKey));
  return `${signingInput}.${signature}`;
}

let cached: { token: string; expEpochMs: number } | null = null;

/**
 * A valid access token, minted on demand and cached until ~5 min before it
 * expires. Returns null when sync isn't configured. Throws on an auth
 * failure (caller logs + marks the block sync_state='error').
 */
export async function getAccessToken(now: Date = new Date()): Promise<string | null> {
  const creds = readCreds();
  if (!creds) return null;

  if (cached && cached.expEpochMs - 5 * 60_000 > now.getTime()) {
    return cached.token;
  }

  const assertion = signJwt(creds, now.getTime());
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    cached = null;
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expEpochMs: now.getTime() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

/** Test seam — clear the in-process token cache. */
export function __clearTokenCache(): void {
  cached = null;
}
