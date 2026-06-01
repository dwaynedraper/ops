import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { sql } from '@/lib/db';
import { loadCalendar, type CalendarItem } from '@/lib/calendar-db';
import { addDays, weekStart } from '@/lib/calendar';
import { CalendarView } from './CalendarView';

/**
 * Calendar (Phase 6A) — the in-Ops time-block calendar. Day + week views,
 * toggleable, over calendar_blocks (+ read-only job shoots). Accessibility,
 * not a feature: fixed hours, the *when* loud and concrete.
 *
 * ?date=YYYY-MM-DD focuses a day (the dashboard glance deep-links here);
 * ?view=day|week picks the view. Owner-scoped (D-019).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calendar' };

const TZ = 'America/Chicago';

interface JobOption {
  id: string;
  label: string;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/calendar');
  const role = user.role ?? 'partner';

  const { date, view: viewParam } = await searchParams;
  const view = viewParam === 'week' ? 'week' : 'day';

  const todayCivil = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const focus = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayCivil;

  // Load the window the chosen view needs: one day, or the Sun–Sat week.
  const [from, to] =
    view === 'week' ? [weekStart(focus), addDays(weekStart(focus), 6)] : [focus, focus];

  const [items, jobRows] = await Promise.all([
    loadCalendar(user.id, from, to, TZ),
    // Active jobs to offer as a "link this block to a job" option.
    sql<{ id: string; title: string | null; client_name: string | null }>`
      SELECT j.id, j.title, c.display_name AS client_name
      FROM jobs j
      LEFT JOIN clients c ON c.id = j.client_id
      WHERE j.owner_id = ${user.id} AND j.stage NOT IN ('complete','cancelled')
      ORDER BY j.updated_at DESC
      LIMIT 50`,
  ]);

  const jobOptions: JobOption[] = jobRows.map((j) => ({
    id: j.id,
    label: [j.client_name, j.title].filter(Boolean).join(' · ') || 'Job',
  }));

  const calItems: CalendarItem[] = items;

  return (
    <div className="app-shell">
      <Sidebar role={role} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <CalendarView
              view={view}
              focus={focus}
              today={todayCivil}
              items={calItems}
              jobOptions={jobOptions}
              timeZone={TZ}
            />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
