import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { ClientsRosterView } from './ClientsRosterView';
import type { ClientKind, ClientListItem, ClientStatus } from '@/lib/clients';

/**
 * Clients — the durable roster. Everyone who's worked with you (or just
 * signed and is about to), the people the jobs hang off. Owner-scoped
 * (D-019): a partner sees their own book; a super_admin sees the team's.
 * The acquisition pipeline now lives at /pipeline.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Clients' };

interface ClientRow {
  id: string;
  kind: ClientKind;
  display_name: string;
  email: string | null;
  phone: string | null;
  market_area: string | null;
  relationship: string | null;
  status: ClientStatus;
  owner_name: string | null;
  updated_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default async function ClientsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/clients');

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const clientRows = isAdmin
    ? await sql<ClientRow>`
        SELECT c.id, c.kind, c.display_name, c.email, c.phone, c.market_area,
               c.relationship, c.status, c.updated_at, u.name AS owner_name
        FROM clients c
        LEFT JOIN users u ON u.id = c.owner_id
        ORDER BY c.updated_at DESC`
    : await sql<ClientRow>`
        SELECT c.id, c.kind, c.display_name, c.email, c.phone, c.market_area,
               c.relationship, c.status, c.updated_at, u.name AS owner_name
        FROM clients c
        LEFT JOIN users u ON u.id = c.owner_id
        WHERE c.owner_id = ${user.id}
        ORDER BY c.updated_at DESC`;

  const clients: ClientListItem[] = clientRows.map((c) => ({
    id: c.id,
    kind: c.kind,
    displayName: c.display_name,
    email: c.email,
    phone: c.phone,
    marketArea: c.market_area,
    relationship: c.relationship,
    status: c.status,
    ownerName: c.owner_name,
    updatedAtLabel: DATE_FMT.format(new Date(c.updated_at)),
  }));

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '1rem',
                flexWrap: 'wrap',
                marginBottom: '0.5rem',
              }}
            >
              <div className="eyebrow">Clients</div>
              <Link href="/clients/new" className="btn-primary">
                + Add / returning client
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
              Your <em style={{ color: 'var(--accent)' }}>clients</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Everyone who&apos;s worked with you — the people behind the jobs. Search
              to find someone the second the phone rings.
            </p>

            <ClientsRosterView clients={clients} isAdmin={isAdmin} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
