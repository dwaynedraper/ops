import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findDueReminders, markReminderSent } from '@/lib/calendar-reminders';
import { clockLabelUpper, endClock } from '@/lib/calendar';
import { sendEmail, emailConfigured } from '@/lib/mailer';

/**
 * Reminder cron (Phase 6B · the "chase") — emails the owner ahead of each
 * calendar block, once per occurrence. Same CRON_SECRET gate as the digest
 * route; runs frequently (see vercel.json) but is cadence-tolerant: it only
 * fires blocks inside their lead-time window and dedupes via
 * calendar_reminders_sent, so a missed or doubled run never mis-sends.
 */
export const dynamic = 'force-dynamic';

function niceDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set — the reminder route is disabled.' },
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

  const now = new Date();
  const due = await findDueReminders(now);

  let sent = 0;
  const failures: { blockId: string; error: string }[] = [];

  for (const r of due) {
    // Mark first so a send that throws mid-flight can't double-fire on the
    // next run; a rare lost email beats a repeated one for a reminder.
    await markReminderSent(r.blockId, r.occurrenceDate);
    if (!r.ownerEmail) continue;
    const when = `${niceDay(r.occurrenceDate)}, ${clockLabelUpper(r.startClock)}–${clockLabelUpper(endClock(r.startClock, r.durationMin))}`;
    const first = r.ownerName.split(/[\s@]/)[0] || 'there';
    try {
      await sendEmail({
        to: r.ownerEmail,
        subject: `Coming up: ${r.title} — ${clockLabelUpper(r.startClock)}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1917;">
          <p>${first}, this is your heads-up.</p>
          <p style="font-size:18px;font-weight:bold;">${r.title}</p>
          <p style="font-size:16px;color:#c25f3e;"><strong>${when}</strong></p>
          <p style="color:#7a746c;font-size:13px;">On your Ops calendar. Stay Sharp. Stay Seen. Stay Human.</p>
        </div>`,
        text: `${first}, heads-up.\n\n${r.title}\n${when}\n\nOn your Ops calendar.`,
      });
      sent += 1;
    } catch (err) {
      failures.push({ blockId: r.blockId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const failed = failures.length > 0;
  return NextResponse.json({ ok: !failed, due: due.length, sent, failures }, { status: failed ? 500 : 200 });
}
