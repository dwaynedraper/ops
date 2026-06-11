import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { JobStage, PaymentStatus, JobListItem } from '@/lib/jobs';
import { JobBoardView } from './JobBoardView';

/**
 * Jobs — the board. Every live engagement by lifecycle stage, at a glance.
 * Owner-scoped (D-019): a partner sees their own; a super_admin the team's.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Jobs' };

interface JobRow {
  id: string;
  client_id: string;
  client_name: string | null;
  title: string | null;
  stage: JobStage;
  workflow_key: string | null;
  workflow_name: string | null;
  accent: string | null;
  shoot_date: string | null;
  value_price: string | null;
  payment_status: PaymentStatus;
  owner_name: string | null;
  collected: string | null;
  updated_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const UPD_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default async function JobsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/jobs');

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  // The collected-so-far sum per job (received minus refunds) rides along
  // so each board card can show a paid ring without an N+1.
  const jobRows = isAdmin
    ? await sql<JobRow>`
        SELECT j.id, j.client_id, j.title, j.stage, j.workflow_key, j.shoot_date,
               j.value_price, j.payment_status, j.updated_at,
               c.display_name AS client_name, w.name AS workflow_name, w.accent,
               u.name AS owner_name,
               COALESCE((SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END)
                         FROM job_payments p
                         WHERE p.job_id = j.id AND p.status = 'received'), 0) AS collected
        FROM jobs j
        LEFT JOIN clients c ON c.id = j.client_id
        LEFT JOIN workflows w ON w.workflow_key = j.workflow_key
        LEFT JOIN users u ON u.id = j.owner_id
        ORDER BY j.updated_at DESC`
    : await sql<JobRow>`
        SELECT j.id, j.client_id, j.title, j.stage, j.workflow_key, j.shoot_date,
               j.value_price, j.payment_status, j.updated_at,
               c.display_name AS client_name, w.name AS workflow_name, w.accent,
               u.name AS owner_name,
               COALESCE((SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END)
                         FROM job_payments p
                         WHERE p.job_id = j.id AND p.status = 'received'), 0) AS collected
        FROM jobs j
        LEFT JOIN clients c ON c.id = j.client_id
        LEFT JOIN workflows w ON w.workflow_key = j.workflow_key
        LEFT JOIN users u ON u.id = j.owner_id
        WHERE j.owner_id = ${user.id}
        ORDER BY j.updated_at DESC`;

  const jobs: JobListItem[] = jobRows.map((j) => {
    const value = j.value_price === null ? null : Number(j.value_price);
    const collected = Number(j.collected ?? 0);
    // Ring fills collected ÷ value; with no value, full once anything is in.
    const frac =
      value && value > 0 ? Math.max(0, Math.min(1, collected / value)) : collected > 0 ? 1 : 0;
    return {
      id: j.id,
      clientId: j.client_id,
      clientName: j.client_name,
      title: j.title,
      stage: j.stage,
      workflowKey: j.workflow_key,
      workflowName: j.workflow_name,
      workflowAccent: j.accent,
      shootDateLabel: j.shoot_date ? DATE_FMT.format(new Date(j.shoot_date)) : null,
      valuePrice: value,
      paymentStatus: j.payment_status,
      paidFraction: frac,
      updatedAtLabel: UPD_FMT.format(new Date(j.updated_at)),
    };
  });

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Jobs
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
              Every job, by <em style={{ color: 'var(--accent)' }}>stage</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Booked through delivered. See what&apos;s shooting soon, what&apos;s waiting on you,
              and what&apos;s owed — then click into any job to move it forward.
            </p>

            <JobBoardView jobs={jobs} isAdmin={isAdmin} />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
