import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { RatesClient, type GlobalRate } from './RatesClient';

/**
 * Rates editor — the pricing_globals rate table (super-admin only).
 *
 * Server component: gates on the session and the role, loads the rate
 * rows, hands them to the editor. Pricing config is super-admin-only
 * (D-014); a partner who reaches this URL is bounced to the dashboard.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Rates & Globals' };

interface GlobalRow {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  notes: string | null;
}

export default async function RatesPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/rates');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const rows = await sql<GlobalRow>`
    SELECT key, label, value, unit, notes
    FROM pricing_globals
    ORDER BY sort_order, label`;

  const rates: GlobalRate[] = rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: Number(r.value),
    unit: r.unit,
    notes: r.notes,
  }));

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Rates &amp; Globals
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
              The numbers <em style={{ color: 'var(--accent)' }}>under</em> every price.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Hourly rates and margins from the master spreadsheet. Edit freely —
              nothing reaches the calculator until you publish. A published change
              updates every package&apos;s cost basis; a package&apos;s website price
              only moves when you republish its worksheet.
            </p>

            <RatesClient rates={rates} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
