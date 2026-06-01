import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import {
  type ExpenseCategory,
  type ExpenseItem,
  type MileageItem,
} from '@/lib/ledger';
import { currentMileageRate } from './actions';
import { LedgerView } from './LedgerView';

/**
 * Ledger — expenses + mileage (Phase 5C). Owner-scoped (D-019): a partner
 * sees their own; a super_admin the whole business. Defaults to the current
 * month; the Books page (5D) is where a month gets exported to Wave.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ledger' };

interface ExpenseRow {
  id: string;
  spent_on: string;
  vendor: string | null;
  amount: string;
  category: ExpenseCategory;
  billable: boolean;
  note: string | null;
  job_id: string | null;
  client_name: string | null;
  title: string | null;
}
interface MileageRow {
  id: string;
  drove_on: string;
  purpose: string | null;
  miles: string;
  rate_per_mile: string;
  amount: string;
  note: string | null;
  job_id: string | null;
  client_name: string | null;
  title: string | null;
}

function monthStartIso(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
const jobLabel = (c: string | null, t: string | null): string | null =>
  [c, t].filter(Boolean).join(' · ') || null;

export default async function LedgerPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/ledger');
  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const monthStart = monthStartIso(new Date());

  const [expenseRows, mileageRows, rate] = await Promise.all([
    isAdmin
      ? sql<ExpenseRow>`
          SELECT e.id, e.spent_on::text, e.vendor, e.amount, e.category, e.billable, e.note,
                 e.job_id, c.display_name AS client_name, j.title
          FROM expenses e
          LEFT JOIN jobs j ON j.id = e.job_id
          LEFT JOIN clients c ON c.id = j.client_id
          WHERE e.spent_on >= ${monthStart}::date
          ORDER BY e.spent_on DESC, e.created_at DESC`
      : sql<ExpenseRow>`
          SELECT e.id, e.spent_on::text, e.vendor, e.amount, e.category, e.billable, e.note,
                 e.job_id, c.display_name AS client_name, j.title
          FROM expenses e
          LEFT JOIN jobs j ON j.id = e.job_id
          LEFT JOIN clients c ON c.id = j.client_id
          WHERE e.owner_id = ${user.id} AND e.spent_on >= ${monthStart}::date
          ORDER BY e.spent_on DESC, e.created_at DESC`,
    isAdmin
      ? sql<MileageRow>`
          SELECT m.id, m.drove_on::text, m.purpose, m.miles, m.rate_per_mile, m.amount, m.note,
                 m.job_id, c.display_name AS client_name, j.title
          FROM mileage_logs m
          LEFT JOIN jobs j ON j.id = m.job_id
          LEFT JOIN clients c ON c.id = j.client_id
          WHERE m.drove_on >= ${monthStart}::date
          ORDER BY m.drove_on DESC, m.created_at DESC`
      : sql<MileageRow>`
          SELECT m.id, m.drove_on::text, m.purpose, m.miles, m.rate_per_mile, m.amount, m.note,
                 m.job_id, c.display_name AS client_name, j.title
          FROM mileage_logs m
          LEFT JOIN jobs j ON j.id = m.job_id
          LEFT JOIN clients c ON c.id = j.client_id
          WHERE m.owner_id = ${user.id} AND m.drove_on >= ${monthStart}::date
          ORDER BY m.drove_on DESC, m.created_at DESC`,
    currentMileageRate(),
  ]);

  const expenses: ExpenseItem[] = expenseRows.map((e) => ({
    id: e.id,
    spentOn: e.spent_on,
    vendor: e.vendor,
    amount: Number(e.amount),
    category: e.category,
    billable: e.billable,
    note: e.note,
    jobId: e.job_id,
    jobLabel: jobLabel(e.client_name, e.title),
  }));
  const mileage: MileageItem[] = mileageRows.map((m) => ({
    id: m.id,
    droveOn: m.drove_on,
    purpose: m.purpose,
    miles: Number(m.miles),
    ratePerMile: Number(m.rate_per_mile),
    amount: Number(m.amount),
    note: m.note,
    jobId: m.job_id,
    jobLabel: jobLabel(m.client_name, m.title),
  }));

  return (
    <div className="app-shell">
      <Sidebar role={role} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Ledger
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
              What went <em style={{ color: 'var(--accent)' }}>out</em> this month.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Log expenses and mileage the moment they happen — dated and categorized, ready
              to export to Wave from the Books page.
            </p>

            <LedgerView
              expenses={expenses}
              mileage={mileage}
              mileageRate={rate}
              isAdmin={isAdmin}
            />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
