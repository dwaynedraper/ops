import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { computeSnapshot } from '@/lib/reports/rollup';
import { upsertSnapshot } from '@/lib/reports/upsert';

/**
 * Phase R · Nightly snapshot cron.
 *
 * Computes yesterday's `daily_metric_snapshot` rows at 00:00 CT (D-071)
 * and upserts them. Reads from the live event tables — every Reports
 * card downstream reads from the snapshot, never from the live tables.
 *
 * Runs out of `vercel.json` at `0 5 * * *` (05:00 UTC = midnight CT in
 * standard time / 23:00 CT in DST — close enough; the window is
 * computed from CT calendar dates so DST shifts don't change the
 * rollup contents).
 *
 * Mirrors the digest cron route's pattern (`/api/cron/digest`):
 *   • `CRON_SECRET` gate, fail-closed
 *   • `Authorization: Bearer …` header OR `?secret=…` query param
 *   • A non-2xx response on partial failure so Vercel Cron flags it
 *
 * Proxy.ts treats `/api/cron/*` as public — the secret check below is
 * its only gate. A missing CRON_SECRET disables the route entirely
 * rather than leaving it open.
 */
export const dynamic = 'force-dynamic';

/**
 * Compute the UTC bounds of "yesterday in Central Time."
 *
 * D-071: snapshots are aligned to the business day, not to UTC. The
 * cron fires at 00:00 CT, which is whatever UTC offset CT is on that
 * date (UTC-5 in DST, UTC-6 in standard time). To find "yesterday
 * 00:00 CT in UTC," we go via the en-CA / Chicago formatter (which
 * gives us yesterday's CT calendar date) and then anchor at that
 * day's midnight in Chicago.
 */
function yesterdayCtWindow(now: Date): { dayStartUtc: Date; dayEndUtc: Date } {
  // "What is the CT calendar date of one second ago?" — pulls us back
  // to yesterday even if the cron fires a few ms after midnight CT.
  const oneMinAgo = new Date(now.getTime() - 60_000);
  const ctYesterday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(oneMinAgo);
  // The format above gave us 'YYYY-MM-DD' representing the CT calendar
  // date. We need that day's midnight in CT, expressed as a UTC Date.
  // Strategy: pretend the CT date is a wall clock and ask Date what UTC
  // that maps to via a fixed-offset reconstruction.
  const [y, m, d] = ctYesterday.split('-').map(Number);
  // We can't trust `new Date(y, m-1, d)` because that uses the server's
  // local TZ. Instead, build a UTC Date for noon and then offset by the
  // observed CT offset at that moment.
  const ctNoonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMinutes = ctOffsetMinutes(ctNoonUtc);
  const dayStartUtc = new Date(
    Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMinutes * 60_000,
  );
  const dayEndUtc = new Date(
    Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offsetMinutes * 60_000,
  );
  return { dayStartUtc, dayEndUtc };
}

/**
 * How many minutes is Chicago AHEAD of UTC at `t`? (Negative — CT is
 * always behind UTC, by 5 or 6 hours depending on DST.) Used to
 * convert a CT wall-clock anchor to UTC.
 */
function ctOffsetMinutes(t: Date): number {
  // Format the same instant as CT and as UTC, then diff the calendar
  // pieces. The diff is the offset.
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(t);
  const partsToTuple = (p: Intl.DateTimeFormatPart[]) => {
    const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return [
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
    ] as const;
  };
  const [yc, mc, dc, hc, mnc] = partsToTuple(fmt('America/Chicago'));
  const [yu, mu, du, hu, mnu] = partsToTuple(fmt('UTC'));
  const ctMs = Date.UTC(yc, mc, dc, hc, mnc);
  const utcMs = Date.UTC(yu, mu, du, hu, mnu);
  return (ctMs - utcMs) / 60_000;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set — the snapshot route is disabled.' },
      { status: 503 },
    );
  }
  const header = req.headers.get('authorization');
  const queryParam = req.nextUrl.searchParams.get('secret');
  if (header !== `Bearer ${secret}` && queryParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  try {
    const { dayStartUtc, dayEndUtc } = yesterdayCtWindow(new Date());
    const rows = await computeSnapshot(dayStartUtc, dayEndUtc);
    const snapshotDate = rows[0]?.snapshotDate ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(dayStartUtc);

    const result = await upsertSnapshot(snapshotDate, rows);
    return NextResponse.json(
      {
        ok: true,
        snapshotDate,
        dayStartUtc: dayStartUtc.toISOString(),
        dayEndUtc: dayEndUtc.toISOString(),
        rows: rows.length,
        deleted: result.deleted,
        inserted: result.inserted,
        rollupMs: result.tookMs,
        totalMs: Date.now() - t0,
      },
      { status: 200 },
    );
  } catch (err) {
    // Surface as 500 so Vercel Cron flags the run — a 200 with an
    // error body would let a half-failed snapshot pass silently.
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        totalMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
