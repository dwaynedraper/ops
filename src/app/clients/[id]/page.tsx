import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne, isUuid } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { ClientBranch, ClientKind, ClientStatus } from '@/lib/clients';
import type { JobStage, PaymentStatus } from '@/lib/jobs';
import {
  ClientProfileView,
  type ClientDetail,
  type ClientNoteItem,
  type ClientQuoteItem,
  type ClientJobItem,
} from './ClientProfileView';

/**
 * Client page — the cold-call card. Server component: loads the client
 * (owner-checked — D-019), its notes, and its history. History in Phase 1
 * is the quotes carried through the origin prospect; the `jobs` spine
 * arrives in Phase 2.
 */
export const dynamic = 'force-dynamic';

interface ClientRow {
  id: string;
  kind: ClientKind;
  display_name: string;
  email: string | null;
  phone: string | null;
  market_area: string | null;
  relationship: string | null;
  referral_source: string | null;
  branch_affinity: ClientBranch | null;
  status: ClientStatus;
  owner_id: string;
  origin_prospect_id: string | null;
  owner_name: string | null;
  created_at: Date;
}
interface NoteRow {
  id: string;
  body: string;
  pinned: boolean;
  created_at: Date;
  author_name: string | null;
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
interface JobRow {
  id: string;
  title: string | null;
  stage: JobStage;
  shoot_date: string | null;
  value_price: string | null;
  payment_status: PaymentStatus;
  accent: string | null;
  workflow_name: string | null;
  updated_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const SHOOT_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: 'Client' };

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { title: 'Client' };

  const row = await sqlOne<{ display_name: string; owner_id: string }>`
    SELECT display_name, owner_id FROM clients WHERE id = ${id}`;
  if (!row) return { title: 'Client' };

  const isAdmin = session.user?.role === 'super_admin';
  if (row.owner_id !== userId && !isAdmin) return { title: 'Client' };
  return { title: row.display_name };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await auth();
  const user = session?.user;
  if (!user) redirect(`/signin?callbackUrl=/clients/${id}`);

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const clientRow = await sqlOne<ClientRow>`
    SELECT c.id, c.kind, c.display_name, c.email, c.phone, c.market_area,
           c.relationship, c.referral_source, c.branch_affinity, c.status,
           c.owner_id, c.origin_prospect_id, c.created_at, u.name AS owner_name
    FROM clients c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE c.id = ${id}`;

  if (!clientRow || (clientRow.owner_id !== user.id && !isAdmin)) {
    notFound();
  }

  const [noteRows, quoteRows, jobRows] = await Promise.all([
    sql<NoteRow>`
      SELECT n.id, n.body, n.pinned, n.created_at, u.name AS author_name
      FROM client_notes n
      LEFT JOIN users u ON u.id = n.author_id
      WHERE n.client_id = ${id}
      ORDER BY n.pinned DESC, n.created_at DESC`,
    clientRow.origin_prospect_id
      ? sql<QuoteRow>`
          SELECT id, quote_number, total_price, status, created_at,
                 package_snapshot->>'name'   AS package_name,
                 package_snapshot->>'branch' AS package_branch
          FROM quotes
          WHERE prospect_id = ${clientRow.origin_prospect_id}
          ORDER BY created_at DESC`
      : Promise.resolve([] as QuoteRow[]),
    sql<JobRow>`
      SELECT j.id, j.title, j.stage, j.shoot_date, j.value_price, j.payment_status,
             j.updated_at, w.name AS workflow_name, w.accent
      FROM jobs j
      LEFT JOIN workflows w ON w.workflow_key = j.workflow_key
      WHERE j.client_id = ${id}
      ORDER BY j.created_at DESC`,
  ]);

  const client: ClientDetail = {
    id: clientRow.id,
    kind: clientRow.kind,
    displayName: clientRow.display_name,
    email: clientRow.email,
    phone: clientRow.phone,
    marketArea: clientRow.market_area,
    relationship: clientRow.relationship,
    referralSource: clientRow.referral_source,
    branchAffinity: clientRow.branch_affinity,
    status: clientRow.status,
    ownerName: clientRow.owner_name,
    originProspectId: clientRow.origin_prospect_id,
    createdAtLabel: DATE_FMT.format(new Date(clientRow.created_at)),
  };

  const notes: ClientNoteItem[] = noteRows.map((n) => ({
    id: n.id,
    body: n.body,
    pinned: n.pinned,
    authorName: n.author_name,
    createdAtLabel: DATE_FMT.format(new Date(n.created_at)),
  }));

  const quotes: ClientQuoteItem[] = quoteRows.map((q) => ({
    id: q.id,
    quoteNumber: q.quote_number,
    totalPrice: Number(q.total_price),
    status: q.status,
    packageLabel:
      q.package_name ?? (q.package_branch === 'corporate' ? 'Corporate headshots' : 'Quote'),
    createdAtLabel: DATE_FMT.format(new Date(q.created_at)),
  }));

  const jobs: ClientJobItem[] = jobRows.map((j) => ({
    id: j.id,
    title: j.title,
    stage: j.stage,
    workflowName: j.workflow_name,
    workflowAccent: j.accent,
    shootDateLabel: j.shoot_date ? SHOOT_FMT.format(new Date(j.shoot_date)) : null,
    valuePrice: j.value_price === null ? null : Number(j.value_price),
    paymentStatus: j.payment_status,
    updatedAtLabel: DATE_FMT.format(new Date(j.updated_at)),
  }));

  // Lifetime value: money actually collected — jobs marked paid. Falls
  // back to the legacy accepted-quote sum only when there are no jobs yet
  // (a freshly converted client whose first job isn't set up).
  const jobLifetime = jobs
    .filter((j) => j.paymentStatus === 'paid' && j.valuePrice !== null)
    .reduce((s, j) => s + (j.valuePrice ?? 0), 0);
  const quoteLifetime = quotes
    .filter((q) => q.status === 'accepted')
    .reduce((s, q) => s + q.totalPrice, 0);
  const lifetimeValue = jobs.length > 0 ? jobLifetime : quoteLifetime;

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <ClientProfileView
              client={client}
              notes={notes}
              quotes={quotes}
              jobs={jobs}
              lifetimeValue={lifetimeValue}
            />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
