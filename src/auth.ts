import NextAuth, { type DefaultSession } from 'next-auth';
import PostgresAdapter from '@auth/pg-adapter';
import Resend from 'next-auth/providers/resend';
import { getPool, sqlOne } from '@/lib/db';
import { isBootstrapAdminEmail } from '@/lib/email-allowlist';
import { canSignIn, type RepStatus } from '@/lib/rep-access';
import { magicLinkHtml, magicLinkText } from '@/lib/magic-link-email';

/**
 * Auth.js v5 configuration for Sharp Sighted Ops.
 *
 * Provider: email magic-link via Resend.
 * Adapter:  Postgres (the schema in src/lib/db/schema.sql).
 * Sessions: database-backed (required by the Email provider — the
 *           magic-link verification needs server-side state).
 *
 * Access control is invite-only (see src/lib/rep-access.ts):
 *   1. signIn callback     — rejects any email without an invite or an
 *                            active/invited profile.
 *   2. proxy.ts middleware — gates every non-public route, and bounces
 *                            a non-active session to /awaiting.
 *
 * Session enrichment runs in the `session` callback: we look up the
 * user's ops_profile and attach role, displayName, and status so server
 * components, the sidebar, and the proxy can branch without re-querying.
 */

// ─── Type augmentation ─────────────────────────────────────────────────
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'super_admin' | 'partner';
      displayName: string | null;
      status: RepStatus;
    } & DefaultSession['user'];
  }
}

// ─── Resend provider with our branded email ────────────────────────────
const ResendProvider = Resend({
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.EMAIL_FROM,
  async sendVerificationRequest(params) {
    const { identifier: email, url, provider } = params;
    const { host } = new URL(url);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: provider.from,
        to: email,
        subject: 'Your Sharp Sighted Ops sign-in link',
        html: magicLinkHtml({ url, host, email }),
        text: magicLinkText({ url, host, email }),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }
  },
});

// ─── NextAuth ──────────────────────────────────────────────────────────
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(getPool()),

  providers: [ResendProvider],

  session: { strategy: 'database' },

  pages: {
    signIn: '/signin',
    verifyRequest: '/signin/verify-request',
    error: '/signin/error',
  },

  // Allow callback URLs only on our own host. Auth.js v5 does this by
  // default; keep it explicit so a misconfigured AUTH_URL is obvious.
  trustHost: true,

  callbacks: {
    /**
     * Reject sign-in attempts from emails without an invite or a live
     * profile (see canSignIn). Returning a string redirects with that as
     * the error; suspended and disabled reps land here too.
     */
    async signIn({ user }) {
      if (!(await canSignIn(user.email))) {
        return '/signin/error?error=AccessDenied';
      }
      return true;
    },

    /**
     * Attach role, displayName, and status from ops_profiles to the
     * session — and bump `last_seen_at` to now() as a side effect, so
     * the admin Team page reflects actual activity (when the user was
     * last using the tool) instead of their last sign-in.
     *
     * Cheap: one UPDATE by primary key with RETURNING, single round
     * trip. Runs on every session lookup. A missing profile defaults
     * to status 'invited' — gated, never silently in.
     */
    async session({ session, user }) {
      const profile = await sqlOne<{
        role: 'super_admin' | 'partner';
        display_name: string | null;
        status: RepStatus;
      }>`
        UPDATE ops_profiles
        SET last_seen_at = now()
        WHERE user_id = ${user.id}
        RETURNING role, display_name, status
      `;
      session.user.id = user.id;
      session.user.role = profile?.role ?? 'partner';
      session.user.displayName = profile?.display_name ?? null;
      session.user.status = profile?.status ?? 'invited';
      return session;
    },
  },

  events: {
    /**
     * On first sign-in, create the ops_profile row.
     *
     * The bootstrap admin (first entry in ALLOWED_EMAILS) is created
     * super_admin / active. Every other rep arrives through an invite:
     * role comes from the invite, status starts at 'invited' (gated out
     * of the app until an admin activates them), and the invite is
     * stamped accepted.
     *
     * Auth.js fires this exactly once per user — on the row insert the
     * adapter does at first sign-in.
     */
    async createUser({ user }) {
      const pool = getPool();
      const email = (user.email ?? '').trim().toLowerCase();

      if (isBootstrapAdminEmail(email)) {
        await pool.query(
          `INSERT INTO ops_profiles (user_id, role, display_name, status)
           VALUES ($1, 'super_admin', $2, 'active')
           ON CONFLICT (user_id) DO NOTHING`,
          [user.id, user.name ?? null],
        );
        return;
      }

      const invite = await pool.query<{
        role: 'super_admin' | 'partner';
        name: string | null;
        invited_by: string | null;
      }>(`SELECT role, name, invited_by FROM rep_invites WHERE email = $1`, [email]);
      const inv = invite.rows[0];

      await pool.query(
        `INSERT INTO ops_profiles (user_id, role, display_name, status, invited_by)
         VALUES ($1, $2, $3, 'invited', $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, inv?.role ?? 'partner', user.name ?? inv?.name ?? null, inv?.invited_by ?? null],
      );

      if (inv) {
        await pool.query(
          `UPDATE rep_invites SET accepted_at = now()
           WHERE email = $1 AND accepted_at IS NULL`,
          [email],
        );
      }
    },

    /**
     * Touch last_seen_at on every sign-in so we can see who's actively
     * using the tool from the admin /team page.
     */
    async signIn({ user }) {
      if (!user.id) return;
      await getPool().query(
        `UPDATE ops_profiles SET last_seen_at = now() WHERE user_id = $1`,
        [user.id],
      );
    },
  },
});
