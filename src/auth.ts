import NextAuth, { type DefaultSession } from 'next-auth';
import PostgresAdapter from '@auth/pg-adapter';
import Resend from 'next-auth/providers/resend';
import { getPool, sqlOne } from '@/lib/db';
import { isAllowedEmail, isBootstrapAdminEmail } from '@/lib/email-allowlist';
import { magicLinkHtml, magicLinkText } from '@/lib/magic-link-email';

/**
 * Auth.js v5 configuration for Sharp Sighted Ops.
 *
 * Provider: email magic-link via Resend.
 * Adapter:  Postgres (the schema in src/lib/db/schema.sql).
 * Sessions: database-backed (required by the Email provider — the
 *           magic-link verification needs server-side state).
 *
 * Access control is enforced in two places:
 *   1. signIn callback     — rejects emails not on ALLOWED_EMAILS.
 *   2. proxy.ts middleware — gates every non-public route.
 *
 * Session enrichment runs in the `session` callback: we look up the
 * user's ops_profile and attach role + displayName so server components
 * and the sidebar can branch on role without re-querying.
 */

// ─── Type augmentation ─────────────────────────────────────────────────
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'admin' | 'partner';
      displayName: string | null;
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
     * Reject sign-in attempts from emails not on the allowlist. Returning
     * a string redirects with that as the error message; false redirects
     * to /signin/error with a generic message.
     */
    async signIn({ user }) {
      if (!isAllowedEmail(user.email)) {
        return '/signin/error?error=AccessDenied';
      }
      return true;
    },

    /**
     * Attach role + displayName from ops_profiles to the session. Run
     * on every session lookup; cheap because ops_profiles is small and
     * indexed on user_id (its primary key).
     */
    async session({ session, user }) {
      const profile = await sqlOne<{ role: 'admin' | 'partner'; display_name: string | null }>`
        SELECT role, display_name FROM ops_profiles WHERE user_id = ${user.id}
      `;
      session.user.id = user.id;
      session.user.role = profile?.role ?? 'partner';
      session.user.displayName = profile?.display_name ?? null;
      return session;
    },
  },

  events: {
    /**
     * On first sign-in, create the ops_profile row. The bootstrap admin
     * email (first entry in ALLOWED_EMAILS) gets role='admin'; everyone
     * else starts as 'partner'.
     *
     * Auth.js fires this exactly once per user — on the row insert that
     * the adapter does at first sign-in. Subsequent sign-ins fire signIn
     * but not createUser.
     */
    async createUser({ user }) {
      const role = isBootstrapAdminEmail(user.email) ? 'admin' : 'partner';
      const displayName = user.name ?? null;
      await getPool().query(
        `INSERT INTO ops_profiles (user_id, role, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, role, displayName],
      );
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
