import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne, isUuid } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { getCatalog } from '@/lib/catalog';
import type { Branch } from '@/lib/catalog';
import type { JobRole, JobStage, PaymentStatus } from '@/lib/jobs';
import { loadJobPayments } from '@/lib/job-payments-db';
import {
  JobPageView,
  type JobDetail,
  type JobRoleItem,
  type JobQuoteItem,
} from './JobPageView';

/**
 * Job page — one engagement's home record. Server component: loads the job
 * (owner-checked — D-019) with its client, workflow, roles, and quotes,
 * plus the pricing catalog for the embedded calculator. The interactive
 * lifecycle + roles editor live in JobPageView.
 */
export const dynamic = 'force-dynamic';

interface JobRow {
  id: string;
  client_id: string;
  owner_id: string;
  client_name: string;
  workflow_key: string | null;
  workflow_name: string | null;
  branch: Branch | null;
  accent: string | null;
  title: string | null;
  stage: JobStage;
  shoot_date: string | null;
  location: string | null;
  value_price: string | null;
  payment_status: PaymentStatus;
  delivery_due: string | null;
  owner_name: string | null;
  created_at: Date;
}
interface RoleRow {
  id: string;
  client_id: string;
  client_name: string;
  role: JobRole;
  role_label: string | null;
}
interface QuoteRow {
  id: string;
  quote_number: number;
  total_price: string;
  status: string;
  created_at: Date;
  package_name: string | null;
  package_branch: string | null;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const ISO = (d: string | null): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: 'Job' };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { title: 'Job' };
  const row = await sqlOne<{ title: string | null; owner_id: string; client_name: string }>`
    SELECT j.title, j.owner_id, c.display_name AS client_name
    FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
    WHERE j.id = ${id}`;
  if (!row) return { title: 'Job' };
  const isAdmin = session.user?.role === 'super_admin';
  if (row.owner_id !== userId && !isAdmin) return { title: 'Job' };
  return { title: row.title || row.client_name || 'Job' };
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await auth();
  const user = session?.user;
  if (!user) redirect(`/signin?callbackUrl=/jobs/${id}`);

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const jobRow = await sqlOne<JobRow>`
    SELECT j.id, j.client_id, j.owner_id, j.title, j.stage, j.shoot_date,
           j.location, j.value_price, j.payment_status, j.delivery_due,
           j.workflow_key, j.created_at,
           c.display_name AS client_name,
           w.name AS workflow_name, w.branch, w.accent,
           u.name AS owner_name
    FROM jobs j
    LEFT JOIN clients c ON c.id = j.client_id
    LEFT JOIN workflows w ON w.workflow_key = j.workflow_key
    LEFT JOIN users u ON u.id = j.owner_id
    WHERE j.id = ${id}`;

  if (!jobRow || (jobRow.owner_id !== user.id && !isAdmin)) notFound();

  const [roleRows, quoteRows, payments, costRow, catalog] = await Promise.all([
    sql<RoleRow>`
      SELECT r.id, r.client_id, r.role, r.role_label, c.display_name AS client_name
      FROM job_roles r
      LEFT JOIN clients c ON c.id = r.client_id
      WHERE r.job_id = ${id}
      ORDER BY r.created_at`,
    sql<QuoteRow>`
      SELECT id, quote_number, total_price, status, created_at,
             package_snapshot->>'name'   AS package_name,
             package_snapshot->>'branch' AS package_branch
      FROM quotes
      WHERE job_id = ${id}
      ORDER BY created_at DESC`,
    loadJobPayments(id),
    sqlOne<{ expenses: string; mileage: string }>`
      SELECT
        COALESCE((SELECT SUM(amount) FROM expenses WHERE job_id = ${id}), 0) AS expenses,
        COALESCE((SELECT SUM(amount) FROM mileage_logs WHERE job_id = ${id}), 0) AS mileage`,
    getCatalog(),
  ]);

  const job: JobDetail = {
    id: jobRow.id,
    clientId: jobRow.client_id,
    clientName: jobRow.client_name,
    title: jobRow.title,
    stage: jobRow.stage,
    workflowName: jobRow.workflow_name,
    workflowAccent: jobRow.accent,
    branch: jobRow.branch,
    shootDate: ISO(jobRow.shoot_date),
    location: jobRow.location,
    deliveryDue: ISO(jobRow.delivery_due),
    valuePrice: jobRow.value_price === null ? null : Number(jobRow.value_price),
    paymentStatus: jobRow.payment_status,
    ownerName: jobRow.owner_name,
    createdAtLabel: DATE_FMT.format(new Date(jobRow.created_at)),
  };

  const roles: JobRoleItem[] = roleRows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    role: r.role,
    roleLabel: r.role_label,
  }));

  const quotes: JobQuoteItem[] = quoteRows.map((q) => ({
    id: q.id,
    quoteNumber: q.quote_number,
    totalPrice: Number(q.total_price),
    status: q.status,
    packageLabel:
      q.package_name ?? (q.package_branch === 'corporate' ? 'Corporate headshots' : 'Quote'),
    createdAtLabel: DATE_FMT.format(new Date(q.created_at)),
  }));

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <JobPageView
              job={job}
              roles={roles}
              quotes={quotes}
              payments={payments}
              expensesTotal={Number(costRow?.expenses ?? 0)}
              mileageTotal={Number(costRow?.mileage ?? 0)}
              catalog={catalog}
              role={role}
            />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
