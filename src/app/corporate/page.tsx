import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { CorporateClient, type CorporateParam } from './CorporateClient';

/**
 * Corporate formula editor — the corporate_pricing parameter table
 * (super-admin only).
 *
 * Corporate headshots price on a parametric formula, not the cost-line
 * worksheet (D-013). This screen edits the formula's inputs; the page
 * shows a live preview so the impact of a change is visible before it
 * publishes.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Corporate' };

interface ParamRow {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  notes: string | null;
}

export default async function CorporatePage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/corporate');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const rows = await sql<ParamRow>`
    SELECT key, label, value, unit, notes
    FROM corporate_pricing
    ORDER BY sort_order, label`;

  const params: CorporateParam[] = rows.map((r) => ({
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
              Corporate
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
              The corporate <em style={{ color: 'var(--accent)' }}>formula</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Single Executive prices, the Team Day base and per-person rates, and
              the volume tiers. The preview re-prices a few example teams as you
              edit — nothing reaches the calculator until you publish.
            </p>

            <CorporateClient params={params} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
