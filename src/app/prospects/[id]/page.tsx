import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { getCatalog } from '@/lib/catalog';
import {
  classifyBand,
  DEFAULT_BANDS,
  STAGE_NEXT,
  type RankBands,
  type ProspectStage,
} from '@/lib/prospects';
import {
  ClientPageView,
  type ProspectDetail,
  type NoteItem,
  type QuoteHistoryItem,
} from './ClientPageView';

/**
 * Client page — a prospect's home record.
 *
 * Server component: loads the prospect (owner-checked — D-019) with its
 * workflow, its notes, its quote history, and the pricing catalog. The
 * interactive mini-CRM lives in ClientPageView.
 */
export const dynamic = 'force-dynamic';

interface ProspectRow {
  id: string;
  owner_id: string;
  workflow_key: string;
  workflow_name: string | null;
  contact_noun: string | null;
  org_noun: string | null;
  branch: 'portraits' | 'realestate' | 'corporate' | null;
  accent: string | null;
  signed_by_name: string | null;
  contact_name: string;
  org_name: string | null;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  social_url: string | null;
  market_area: string | null;
  rank_score: string;
  stage: ProspectStage;
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
interface ConfigRow {
  key: string;
  value: string;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await sqlOne<{ contact_name: string }>`
    SELECT contact_name FROM prospects WHERE id = ${id}`;
  return { title: row?.contact_name ?? 'Prospect' };
}

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  const user = session?.user;
  if (!user) redirect(`/signin?callbackUrl=/prospects/${id}`);

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const prospectRow = await sqlOne<ProspectRow>`
    SELECT p.id, p.owner_id, p.workflow_key, p.contact_name, p.org_name, p.email,
           p.phone, p.website_url, p.social_url, p.market_area, p.rank_score,
           p.stage, p.created_at,
           su.name AS signed_by_name,
           w.name AS workflow_name, w.contact_noun, w.org_noun, w.branch, w.accent
    FROM prospects p
    LEFT JOIN users su ON su.id = p.signed_by_id
    LEFT JOIN workflows w ON w.workflow_key = p.workflow_key
    WHERE p.id = ${id}`;

  // Missing, or not this rep's prospect — both render the branded 404.
  if (!prospectRow || (prospectRow.owner_id !== user.id && !isAdmin)) {
    notFound();
  }

  const [noteRows, quoteRows, configRows, catalog] = await Promise.all([
    sql<NoteRow>`
      SELECT n.id, n.body, n.pinned, n.created_at, u.name AS author_name
      FROM prospect_notes n
      LEFT JOIN users u ON u.id = n.author_id
      WHERE n.prospect_id = ${id}
      ORDER BY n.pinned DESC, n.created_at DESC`,
    sql<QuoteRow>`
      SELECT id, quote_number, total_price, status, created_at,
             package_snapshot->>'name'   AS package_name,
             package_snapshot->>'branch' AS package_branch
      FROM quotes
      WHERE prospect_id = ${id}
      ORDER BY created_at DESC`,
    sql<ConfigRow>`
      SELECT key, value FROM rank_config WHERE workflow_key = ${prospectRow.workflow_key}`,
    getCatalog(),
  ]);

  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const bands: RankBands = {
    qualifiedMin: cfg.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
    borderlineMin: cfg.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
    targetCount: cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
  };

  const rankScore = Number(prospectRow.rank_score);

  const prospect: ProspectDetail = {
    id: prospectRow.id,
    workflowKey: prospectRow.workflow_key,
    workflowName: prospectRow.workflow_name ?? prospectRow.workflow_key,
    workflowAccent: prospectRow.accent ?? 'var(--text-faint)',
    contactNoun: prospectRow.contact_noun ?? 'Contact',
    orgNoun: prospectRow.org_noun,
    branch: prospectRow.branch,
    contactName: prospectRow.contact_name,
    orgName: prospectRow.org_name,
    email: prospectRow.email,
    phone: prospectRow.phone,
    websiteUrl: prospectRow.website_url,
    socialUrl: prospectRow.social_url,
    marketArea: prospectRow.market_area,
    rankScore,
    band: classifyBand(rankScore, bands),
    stage: prospectRow.stage,
    signedByName: prospectRow.signed_by_name,
    createdAtLabel: DATE_FMT.format(new Date(prospectRow.created_at)),
  };

  const notes: NoteItem[] = noteRows.map((n) => ({
    id: n.id,
    body: n.body,
    pinned: n.pinned,
    authorName: n.author_name,
    createdAtLabel: DATE_FMT.format(new Date(n.created_at)),
  }));

  const quotes: QuoteHistoryItem[] = quoteRows.map((q) => ({
    id: q.id,
    quoteNumber: q.quote_number,
    totalPrice: Number(q.total_price),
    status: q.status,
    packageLabel:
      q.package_name ??
      (q.package_branch === 'corporate' ? 'Corporate headshots' : 'Quote'),
    createdAtLabel: DATE_FMT.format(new Date(q.created_at)),
  }));

  const allowedStages = STAGE_NEXT[prospect.stage] ?? [];

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <ClientPageView
              prospect={prospect}
              allowedStages={allowedStages}
              notes={notes}
              quotes={quotes}
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
