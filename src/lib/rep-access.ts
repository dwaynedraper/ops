/**
 * Rep access control — the invite-only onboarding gate.
 *
 * Onboarding is invite-only: an admin adds a row to rep_invites from the
 * /team roster, and only then may that email request a sign-in link.
 * Access has a four-state lifecycle on ops_profiles.status:
 *
 *   invited   — authenticated against an invite, awaiting activation.
 *   active    — cleared to work.
 *   suspended — access paused, reversible.
 *   disabled  — off-boarded; access ended, record kept forever.
 *
 * A rep is never deleted — prospects, contacts, and quotes must stay
 * attributable. Enforcement runs in two places: the auth signIn callback
 * (blocks a fresh sign-in) and proxy.ts (gates an already-live session
 * whose status changed underneath it).
 */

import { sqlOne } from '@/lib/db';
import { isBootstrapAdminEmail } from '@/lib/email-allowlist';

export type RepStatus = 'invited' | 'active' | 'suspended' | 'disabled';

/** A status that is allowed to authenticate (reach the app or its gate). */
function statusCanAuth(status: RepStatus): boolean {
  return status === 'active' || status === 'invited';
}

/**
 * May this email receive a sign-in link / complete sign-in?
 *
 * Allowed when the email is the bootstrap admin, holds an open or
 * accepted invite, or already has a profile that isn't off-boarded.
 * A suspended or disabled rep — or an email with no invite at all —
 * is denied here, so they never get a session.
 */
export async function canSignIn(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const norm = email.trim().toLowerCase();

  // Bootstrap: the first sign-in, before any invite can exist.
  if (isBootstrapAdminEmail(norm)) return true;

  // An invite — open or already accepted — clears them to authenticate.
  const invite = await sqlOne<{ email: string }>`
    SELECT email FROM rep_invites WHERE email = ${norm}`;
  if (invite) return true;

  // Or an existing profile that hasn't been off-boarded.
  const profile = await sqlOne<{ status: RepStatus }>`
    SELECT p.status
    FROM ops_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE lower(u.email) = ${norm}`;
  return !!profile && statusCanAuth(profile.status);
}
