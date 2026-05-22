'use server';

/**
 * Team roster server actions — invite, activate, suspend, disable.
 *
 * Every action is super_admin-only (requireAdmin). Onboarding is
 * invite-only: inviteRep adds a rep_invites row and emails the rep;
 * the createUser event (auth.ts) turns an accepted invite into an
 * ops_profile. A rep is NEVER deleted — only their status changes —
 * so prospects, contacts, and quotes stay attributable for pay and
 * dispute records. Only an un-accepted invite can be removed.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { sendEmail } from '@/lib/mailer';
import { inviteEmailHtml, inviteEmailText } from '@/lib/invite-email';
import type { RepStatus } from '@/lib/rep-access';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Non-fatal note — e.g. the invite saved but the email didn't send. */
  warning?: string;
}

type Role = 'super_admin' | 'partner';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES: RepStatus[] = ['invited', 'active', 'suspended', 'disabled'];

/** Resolve the caller; only a super_admin may manage the roster. */
async function requireAdmin(): Promise<
  { userId: string } | { error: string }
> {
  const session = await auth();
  const user = session?.user;
  if (!user) return { error: 'Your session has expired — sign in again.' };
  if (user.role !== 'super_admin') {
    return { error: 'Only an administrator can manage the team.' };
  }
  return { userId: user.id };
}

/** Send the invite email. Returns an error string on failure, else null. */
async function sendInviteEmail(
  email: string,
  name: string | null,
): Promise<string | null> {
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '';
  if (!authUrl) return 'AUTH_URL is not set, so no invite email was sent.';
  const signinUrl = `${authUrl.replace(/\/$/, '')}/signin`;
  let host = signinUrl;
  try {
    host = new URL(authUrl).host;
  } catch {
    /* keep the fallback */
  }
  try {
    await sendEmail({
      to: email,
      subject: "You're invited to Sharp Sighted Ops",
      html: inviteEmailHtml({ signinUrl, host, repName: name }),
      text: inviteEmailText({ signinUrl, host, repName: name }),
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'The invite email failed to send.';
  }
}

/** Invite a new rep — adds them to rep_invites and emails them. */
export async function inviteRep(input: {
  name: string;
  email: string;
  role: Role;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if ('error' in admin) return { ok: false, error: admin.error };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim() || null;
  const role: Role = input.role === 'super_admin' ? 'super_admin' : 'partner';

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'That doesn’t look like a valid email address.' };
  }

  // Already a rep who has signed in?
  const existingProfile = await sqlOne<{ status: RepStatus }>`
    SELECT p.status FROM ops_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE lower(u.email) = ${email}`;
  if (existingProfile) {
    return { ok: false, error: 'Someone with that email is already on the team.' };
  }

  // Already invited and that invite was accepted?
  const existingInvite = await sqlOne<{ accepted_at: Date | null }>`
    SELECT accepted_at FROM rep_invites WHERE email = ${email}`;
  if (existingInvite?.accepted_at) {
    return { ok: false, error: 'That email has already accepted an invite.' };
  }

  try {
    await sql`
      INSERT INTO rep_invites (email, name, role, invited_by)
      VALUES (${email}, ${name}, ${role}, ${admin.userId})
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name, role = EXCLUDED.role, invited_by = EXCLUDED.invited_by`;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save the invite.',
    };
  }

  const emailError = await sendInviteEmail(email, name);
  revalidatePath('/team');
  return emailError
    ? { ok: true, warning: `Invite saved, but the email didn’t send: ${emailError}` }
    : { ok: true };
}

/** Re-send the invite email for a still-pending invite. */
export async function resendInvite(input: { inviteId: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  if ('error' in admin) return { ok: false, error: admin.error };

  const invite = await sqlOne<{ email: string; name: string | null; accepted_at: Date | null }>`
    SELECT email, name, accepted_at FROM rep_invites WHERE id = ${input.inviteId}`;
  if (!invite) return { ok: false, error: 'That invite no longer exists.' };
  if (invite.accepted_at) {
    return { ok: false, error: 'That invite has already been accepted.' };
  }

  const emailError = await sendInviteEmail(invite.email, invite.name);
  return emailError
    ? { ok: false, error: `The invite email didn’t send: ${emailError}` }
    : { ok: true };
}

/** Remove a still-pending invite. Accepted invites are kept as records. */
export async function cancelInvite(input: { inviteId: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  if ('error' in admin) return { ok: false, error: admin.error };

  try {
    await sql`
      DELETE FROM rep_invites
      WHERE id = ${input.inviteId} AND accepted_at IS NULL`;
    revalidatePath('/team');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not cancel the invite.',
    };
  }
}

/** Change a rep's access status — activate, suspend, disable, reinstate. */
export async function setRepStatus(input: {
  userId: string;
  status: RepStatus;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if ('error' in admin) return { ok: false, error: admin.error };

  if (!STATUSES.includes(input.status)) {
    return { ok: false, error: 'Unknown status.' };
  }
  if (input.userId === admin.userId) {
    return { ok: false, error: 'You can’t change your own access status.' };
  }

  try {
    const updated = await sqlOne<{ user_id: string }>`
      UPDATE ops_profiles SET status = ${input.status}
      WHERE user_id = ${input.userId}
      RETURNING user_id`;
    if (!updated) return { ok: false, error: 'That rep no longer exists.' };
    revalidatePath('/team');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not update the rep.',
    };
  }
}

/** Change a rep's role. */
export async function setRepRole(input: {
  userId: string;
  role: Role;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if ('error' in admin) return { ok: false, error: admin.error };

  const role: Role = input.role === 'super_admin' ? 'super_admin' : 'partner';
  if (input.userId === admin.userId) {
    return { ok: false, error: 'You can’t change your own role.' };
  }

  try {
    const updated = await sqlOne<{ user_id: string }>`
      UPDATE ops_profiles SET role = ${role}
      WHERE user_id = ${input.userId}
      RETURNING user_id`;
    if (!updated) return { ok: false, error: 'That rep no longer exists.' };
    revalidatePath('/team');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not update the role.',
    };
  }
}
