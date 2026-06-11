import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { TeamRosterView, type RepRow, type InviteRow, type Role } from './TeamRosterView';
import type { RepStatus } from '@/lib/rep-access';

/**
 * Team — the rep roster (super_admin only).
 *
 * Invite reps, activate them after their paperwork clears, suspend or
 * disable them. The activity report — what each rep moved — lives one
 * level down at /team/activity.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Team' };

interface RepDbRow {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  status: RepStatus;
  last_seen_at: Date;
  created_at: Date;
}
interface InviteDbRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  created_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export default async function TeamPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/team');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') notFound();

  const [repRows, inviteRows] = await Promise.all([
    sql<RepDbRow>`
      SELECT p.user_id,
             COALESCE(NULLIF(p.display_name, ''), u.name, u.email, 'Unnamed') AS name,
             COALESCE(u.email, '') AS email,
             p.role, p.status, p.last_seen_at, p.created_at
      FROM ops_profiles p
      JOIN users u ON u.id = p.user_id`,
    sql<InviteDbRow>`
      SELECT id, email, name, role, created_at
      FROM rep_invites
      WHERE accepted_at IS NULL
      ORDER BY created_at DESC`,
  ]);

  const reps: RepRow[] = repRows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: r.status,
    lastSeenLabel: DATE_FMT.format(new Date(r.last_seen_at)),
    joinedLabel: DATE_FMT.format(new Date(r.created_at)),
  }));

  const invites: InviteRow[] = inviteRows.map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    role: i.role,
    invitedLabel: DATE_FMT.format(new Date(i.created_at)),
  }));

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '1rem',
                marginBottom: '0.5rem',
              }}
            >
              <div className="eyebrow">Team</div>
              <Link href="/team/activity" className="btn-ghost" style={{ padding: '0.2rem 0' }}>
                Activity report →
              </Link>
            </div>
            <h1
              style={{
                fontSize: 'clamp(1.6rem, 3vw, 2.3rem)',
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                marginBottom: '0.5rem',
              }}
            >
              The <em style={{ color: 'var(--accent)' }}>roster</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Invite reps, clear them to work once their paperwork is in, and
              manage access. No one is ever removed — only their access changes.
            </p>

            <TeamRosterView reps={reps} invites={invites} currentUserId={user.id} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
