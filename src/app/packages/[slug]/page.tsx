import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { RateRole, PricingGlobals } from '@/lib/pricing';
import {
  WorksheetClient,
  type WorksheetPackage,
  type WorksheetLineInit,
} from './WorksheetClient';

/**
 * Package worksheet editor — one package's cost lines (super-admin only).
 *
 * Server component: loads the package, its cost lines, and the rate
 * globals, then hands them to the editor. A partner who reaches this URL
 * is bounced to the dashboard.
 */
export const dynamic = 'force-dynamic';

interface PackageRow {
  id: string;
  slug: string;
  name: string;
  branch: string;
  default_margin: string;
  base_price: string;
}
interface LineRow {
  kind: 'time' | 'hard';
  category: string;
  hours: string | null;
  rate_role: RateRole | null;
  amount: string | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const row = await sqlOne<{ name: string }>`SELECT name FROM packages WHERE slug = ${slug}`;
  return { title: row ? `${row.name} — Worksheet` : 'Worksheet' };
}

export default async function WorksheetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await auth();
  const user = session?.user;
  if (!user) redirect(`/signin?callbackUrl=/packages/${slug}`);

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const pkgRow = await sqlOne<PackageRow>`
    SELECT id, slug, name, branch, default_margin, base_price
    FROM packages
    WHERE slug = ${slug}`;
  if (!pkgRow) notFound();

  const [lineRows, globalRows] = await Promise.all([
    sql<LineRow>`
      SELECT kind, category, hours, rate_role, amount
      FROM package_cost_lines
      WHERE package_id = ${pkgRow.id}
      ORDER BY sort_order`,
    sql<{ key: string; value: string }>`SELECT key, value FROM pricing_globals`,
  ]);

  const pkg: WorksheetPackage = {
    slug: pkgRow.slug,
    name: pkgRow.name,
    branch: pkgRow.branch,
    defaultMargin: Number(pkgRow.default_margin),
    basePrice: Number(pkgRow.base_price),
  };

  const lines: WorksheetLineInit[] = lineRows.map((r) => ({
    kind: r.kind,
    category: r.category,
    hours: r.hours === null ? 0 : Number(r.hours),
    rateRole: r.rate_role,
    amount: r.amount === null ? 0 : Number(r.amount),
  }));

  const globals: PricingGlobals = {};
  for (const g of globalRows) globals[g.key] = Number(g.value);

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <WorksheetClient pkg={pkg} initialLines={lines} globals={globals} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
