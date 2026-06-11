import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { fmtMoney } from '@/lib/pricing';

/**
 * Packages index — the worksheet packages, super-admin only.
 *
 * Lists the cost-line packages (Verse, Story, Saga, Essentials, Visibility
 * Retainer); each links to its worksheet editor. Corporate headshots are
 * not here — they price on the parametric formula at /corporate (D-013).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Packages' };

const BRANCH_LABEL: Record<string, string> = {
  portraits: 'Portraits',
  realestate: 'Real Estate',
  corporate: 'Corporate',
};

interface PackageRow {
  slug: string;
  name: string;
  branch: string;
  base_price: string;
  default_margin: string;
}

export default async function PackagesPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/packages');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const rows = await sql<PackageRow>`
    SELECT slug, name, branch, base_price, default_margin
    FROM packages
    WHERE is_active = true
    ORDER BY branch, sort_order, name`;

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Packages
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
              The <em style={{ color: 'var(--accent)' }}>worksheets</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Each package&apos;s published price is built from its cost worksheet.
              Open one to edit the time and hard-cost lines and watch the price
              recompute. Corporate headshots price on their own formula.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {rows.map((p) => (
                <Link
                  key={p.slug}
                  href={`/packages/${p.slug}`}
                  className="surface-tool"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {p.name}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                      {BRANCH_LABEL[p.branch] ?? p.branch} ·{' '}
                      {Math.round(Number(p.default_margin) * 100)}% margin
                    </span>
                  </span>
                  <span
                    className="money"
                    style={{ fontSize: '1.05rem', color: 'var(--accent)', flexShrink: 0 }}
                  >
                    {fmtMoney(Number(p.base_price))}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', flexShrink: 0 }}>
                    Edit →
                  </span>
                </Link>
              ))}
              {rows.length === 0 && (
                <div className="surface-card">
                  <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    No packages in the catalog — seed it first.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
