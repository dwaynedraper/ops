import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { fmtMoney } from '@/lib/pricing';
import { EXPENSE_CATEGORY_LABEL, isExpenseCategory } from '@/lib/ledger';
import { resolveMonth, shiftMonth, loadBooks } from '@/lib/books';

/**
 * Books — the monthly close (Phase 5D, super-admin only). One screen that
 * is the Wave handoff: income, expenses, and mileage for a month, with
 * totals and one-click Wave-CSV exports per section. Wave owns the books of
 * record; this hands it clean, dated, categorized rows.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Books' };

const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DAY_FMT.format(d);
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/books');
  // Whole-business money — super-admin only.
  if (user.role !== 'super_admin') notFound();

  const { month: monthParam } = await searchParams;
  const month = resolveMonth(monthParam ?? null);
  const books = await loadBooks(month);

  const prev = shiftMonth(month.month, -1);
  const next = shiftMonth(month.month, 1);
  const exportHref = (type: string) => `/books/export?month=${month.month}&type=${type}`;

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={user.role ?? 'partner'} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            {/* Header + month nav */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <div className="eyebrow">Books</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Link href={`/books?month=${prev}`} className="btn-ghost" style={{ padding: '0.2rem 0.5rem' }}>← Prev</Link>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', minWidth: '7rem', textAlign: 'center' }}>
                  {month.label}
                </span>
                <Link href={`/books?month=${next}`} className="btn-ghost" style={{ padding: '0.2rem 0.5rem' }}>Next →</Link>
              </div>
            </div>
            <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.3rem)', fontFamily: 'var(--font-playfair), serif', fontWeight: 400, letterSpacing: '-0.01em', marginBottom: '0.5rem' }}>
              Close the <em style={{ color: 'var(--accent)' }}>month</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '60ch' }}>
              Everything dated this month, ready for Wave. Export a section, then upload the CSV
              in Wave — it maps Date / Description / Amount on the way in.
            </p>

            {/* Totals strip — felt before read */}
            <section className="surface-card" style={{ marginBottom: '1.75rem', padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Total label="Income" value={fmtMoney(books.totals.income)} color="var(--good)" />
                <Total label="Expenses" value={`↓ ${fmtMoney(books.totals.expenses)}`} color="var(--text-mid)" />
                <Total label="Mileage" value={`↓ ${fmtMoney(books.totals.mileage)}`} color="var(--text-mid)" />
                <Total
                  label="Net"
                  value={fmtMoney(books.totals.net)}
                  color={books.totals.net >= 0 ? 'var(--good)' : 'var(--bad)'}
                  strong
                />
              </div>
            </section>

            {/* Income */}
            <Section title="Income" count={books.income.length} exportHref={exportHref('income')}>
              {books.income.length === 0 ? (
                <Empty>No payments received this month.</Empty>
              ) : (
                books.income.map((r, i) => (
                  <LineRow
                    key={`inc-${i}`}
                    date={fmtDay(r.date)}
                    title={[r.client, r.jobTitle].filter(Boolean).join(' · ') || 'Payment'}
                    sub={r.method ?? ''}
                    amount={fmtMoney(r.amount)}
                    amountColor="var(--good)"
                  />
                ))
              )}
            </Section>

            {/* Expenses */}
            <Section title="Expenses" count={books.expenses.length} exportHref={exportHref('expenses')}>
              {books.expenses.length === 0 ? (
                <Empty>No expenses this month.</Empty>
              ) : (
                books.expenses.map((r, i) => (
                  <LineRow
                    key={`exp-${i}`}
                    date={fmtDay(r.date)}
                    title={r.vendor ?? (isExpenseCategory(r.category) ? EXPENSE_CATEGORY_LABEL[r.category] : r.category)}
                    sub={`${isExpenseCategory(r.category) ? EXPENSE_CATEGORY_LABEL[r.category] : r.category}${r.billable ? ' · billable' : ''}`}
                    amount={`↓ ${fmtMoney(r.amount)}`}
                    amountColor="var(--text-mid)"
                  />
                ))
              )}
            </Section>

            {/* Mileage */}
            <Section title="Mileage" count={books.mileage.length} exportHref={exportHref('mileage')}>
              {books.mileage.length === 0 ? (
                <Empty>No mileage this month.</Empty>
              ) : (
                books.mileage.map((r, i) => (
                  <LineRow
                    key={`mil-${i}`}
                    date={fmtDay(r.date)}
                    title={r.purpose ?? 'Drive'}
                    sub={`${r.miles} mi @ ${r.rate}`}
                    amount={`↓ ${fmtMoney(r.amount)}`}
                    amountColor="var(--text-mid)"
                  />
                ))
              )}
            </Section>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}

function Total({ label, value, color, strong }: { label: string; value: string; color: string; strong?: boolean }) {
  return (
    <div>
      <div className="money" style={{ fontSize: strong ? '1.6rem' : '1.3rem', lineHeight: 1, color }}>{value}</div>
      <div style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 700, marginTop: '0.25rem' }}>
        {label}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  exportHref,
  children,
}: {
  title: string;
  count: number;
  exportHref: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.6rem' }}>
        <div className="eyebrow">{title} <span style={{ color: 'var(--text-faint)' }}>· {count}</span></div>
        {count > 0 && (
          <a href={exportHref} className="btn-outline" style={{ padding: '0.3rem 0.7rem', fontSize: '0.74rem' }} download>
            Export CSV for Wave
          </a>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>{children}</div>
    </section>
  );
}

function LineRow({
  date,
  title,
  sub,
  amount,
  amountColor,
}: {
  date: string;
  title: string;
  sub: string;
  amount: string;
  amountColor: string;
}) {
  return (
    <div className="surface-tool" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.6rem 0.8rem' }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', minWidth: '3rem', flexShrink: 0 }}>{date}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {sub && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</span>}
      </span>
      <span className="money" style={{ fontSize: '0.9rem', color: amountColor, flexShrink: 0 }}>{amount}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{children}</p>;
}
