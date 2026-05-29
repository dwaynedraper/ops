import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { computeDigest } from '@/lib/digest';
import { digestEmailHtml, digestEmailText } from '@/lib/digest-email';
import { sendEmail, emailConfigured } from '@/lib/mailer';

/**
 * Morning digest cron — emails the Dashboard brief to every active rep
 * who opted in (ops_profiles.digest_email). (V2 F12 / D-063 folded the
 * old `/today` route into the Dashboard; the cron path didn't change.)
 *
 * Triggered by a Vercel Cron entry (vercel.json) once each morning.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on a scheduled
 * invocation; if CRON_SECRET is set we require it, so the route can't
 * be triggered by anyone who finds the URL. A `?secret=` query param is
 * accepted too, for a manual test run.
 *
 * The route is in proxy.ts's public prefixes (it carries no session);
 * the secret check below is its only gate.
 */
export const dynamic = 'force-dynamic';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

interface RepRow {
  user_id: string;
  name: string;
  email: string;
}

export async function GET(req: NextRequest) {
  // Fail closed: this route is public (no session), so the secret is its
  // only gate. A missing CRON_SECRET disables the route entirely rather
  // than leaving it open to anyone who finds the URL.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set — the digest route is disabled.' },
      { status: 503 },
    );
  }
  const header = req.headers.get('authorization');
  const queryParam = req.nextUrl.searchParams.get('secret');
  if (header !== `Bearer ${secret}` && queryParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      { error: 'Email is not configured (AUTH_RESEND_KEY / EMAIL_FROM).' },
      { status: 503 },
    );
  }

  const reps = await sql<RepRow>`
    SELECT p.user_id,
           COALESCE(NULLIF(p.display_name, ''), u.name, u.email, '') AS name,
           COALESCE(u.email, '') AS email
    FROM ops_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.status = 'active' AND p.digest_email = true AND u.email IS NOT NULL`;

  const appUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '';
  const now = new Date();
  const dateLabel = DATE_FMT.format(now);

  let sent = 0;
  const failures: { email: string; error: string }[] = [];

  for (const rep of reps) {
    if (!rep.email) continue;
    try {
      const data = await computeDigest(rep.user_id, now);
      const firstName = rep.name.split(/[\s@]/)[0] ?? '';
      await sendEmail({
        to: rep.email,
        subject: data.allClear
          ? 'Your morning brief — all clear'
          : `Your morning brief — ${data.total} to work`,
        html: digestEmailHtml(data, { firstName, dateLabel, appUrl }),
        text: digestEmailText(data, { firstName, dateLabel, appUrl }),
      });
      sent += 1;
    } catch (err) {
      failures.push({
        email: rep.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Surface partial failures as a non-2xx so Vercel Cron flags the run —
  // a 200 would let a half-failed digest pass silently.
  const failed = failures.length > 0;
  return NextResponse.json(
    { ok: !failed, reps: reps.length, sent, failures },
    { status: failed ? 500 : 200 },
  );
}
