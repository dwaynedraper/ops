import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { sql, sqlOne, isUuid } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import {
  DEFAULT_BANDS,
  type RankFactor,
  type RankFactorKind,
  type RankBands,
  type ProspectStage,
} from '@/lib/prospects';
import type { SourcingStatus } from '@/lib/sourcing';
import { QualifyDetailClient, type QualifyDetailWorkflow } from './QualifyDetailClient';

/**
 * Per-prospect Qualify page — the deep work on one agent (D-023 + Dean
 * sign-off on Option B from P4.5). The Sourcing row's click target.
 *
 * Server component: loads the prospect (owner-checked — D-019), its
 * workflow's rank factors + bands, and the prospect's current
 * sourcing-side state (sourcing_status, sourcing_note). Hands every-
 * thing to the interactive client which lets the rep refine the rank
 * inputs, toggle status, and provide an override reason when status
 * disagrees with the pre-score band.
 *
 * Saving recomputes the score server-side via `upsertSourcingRow` —
 * the same action Sourcing uses — so the two surfaces stay in sync.
 */
export const dynamic = 'force-dynamic';

interface ProspectRow {
  id: string;
  owner_id: string;
  workflow_key: string;
  workflow_name: string | null;
  contact_noun: string | null;
  org_noun: string | null;
  accent: string | null;
  contact_name: string;
  org_name: string | null;
  market_area: string | null;
  gross_volume: string | null;
  source_url: string | null;
  sourcing_status: SourcingStatus;
  sourcing_note: string | null;
  rank_inputs: Record<string, boolean | number> | null;
  rank_score: string;
  stage: ProspectStage;
}
interface FactorRow {
  key: string;
  label: string;
  help_text: string | null;
  kind: RankFactorKind;
  weight: string;
  max_input: string | null;
  is_gate: boolean;
  sort_order: number;
}
interface ConfigRow {
  key: string;
  value: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) return { title: 'Qualify' };

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { title: 'Qualify' };

  const row = await sqlOne<{ contact_name: string; owner_id: string }>`
    SELECT contact_name, owner_id FROM prospects WHERE id = ${id}`;
  if (!row) return { title: 'Qualify' };

  const isAdmin = session.user?.role === 'super_admin';
  if (row.owner_id !== userId && !isAdmin) return { title: 'Qualify' };
  return { title: `Qualify · ${row.contact_name}` };
}

export default async function QualifyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await auth();
  const user = session?.user;
  if (!user) redirect(`/signin?callbackUrl=/qualify/${id}`);

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const prospectRow = await sqlOne<ProspectRow>`
    SELECT p.id, p.owner_id, p.workflow_key, p.contact_name, p.org_name, p.market_area,
           p.gross_volume::text AS gross_volume, p.source_url,
           p.sourcing_status, p.sourcing_note,
           p.rank_inputs, p.rank_score::text AS rank_score, p.stage,
           w.name AS workflow_name, w.contact_noun, w.org_noun, w.accent
    FROM prospects p
    LEFT JOIN workflows w ON w.workflow_key = p.workflow_key
    WHERE p.id = ${id}`;

  if (!prospectRow || (prospectRow.owner_id !== user.id && !isAdmin)) {
    notFound();
  }

  const [factorRows, configRows] = await Promise.all([
    sql<FactorRow>`
      SELECT key, label, help_text, kind, weight, max_input, is_gate, sort_order
      FROM rank_factors
      WHERE workflow_key = ${prospectRow.workflow_key} AND active = true
      ORDER BY sort_order, label`,
    sql<ConfigRow>`
      SELECT key, value FROM rank_config
      WHERE workflow_key = ${prospectRow.workflow_key}`,
  ]);

  const factors: RankFactor[] = factorRows.map((r) => ({
    key: r.key,
    label: r.label,
    helpText: r.help_text,
    kind: r.kind,
    weight: Number(r.weight),
    maxInput: r.max_input === null ? null : Number(r.max_input),
    isGate: r.is_gate,
    sortOrder: r.sort_order,
  }));

  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const bands: RankBands = {
    qualifiedMin: cfg.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
    borderlineMin: cfg.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
    targetCount: cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
  };

  const workflow: QualifyDetailWorkflow = {
    key: prospectRow.workflow_key,
    name: prospectRow.workflow_name ?? prospectRow.workflow_key,
    accent: prospectRow.accent ?? 'var(--text-faint)',
    contactNoun: prospectRow.contact_noun ?? 'Contact',
    orgNoun: prospectRow.org_noun,
    factors,
    bands,
  };

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                fontSize: '0.74rem',
                color: 'var(--text-faint)',
                marginBottom: '0.5rem',
              }}
            >
              <Link
                href="/sourcing"
                style={{
                  color: 'var(--text-mid)',
                  textDecoration: 'none',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontSize: '0.68rem',
                }}
              >
                ← Sourcing
              </Link>
              <span aria-hidden style={{ color: 'var(--text-faint)' }}>·</span>
              <span
                style={{
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontSize: '0.68rem',
                  color: workflow.accent,
                }}
              >
                {workflow.name}
              </span>
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
              Qualify {prospectRow.contact_name}
            </h1>
            <p
              style={{
                color: 'var(--text-mid)',
                marginBottom: '1.75rem',
                maxWidth: '64ch',
              }}
            >
              The deep read. Refine the gates, score the supporting factors, and
              commit your call. Anything you filled in on Sourcing is already
              here. The rank panel updates live; saving sends it to the server
              for a server-side recompute.
            </p>

            <QualifyDetailClient
              prospectId={prospectRow.id}
              workflow={workflow}
              identity={{
                contactName: prospectRow.contact_name,
                orgName: prospectRow.org_name,
                marketArea: prospectRow.market_area,
                grossVolume: prospectRow.gross_volume === null
                  ? null
                  : Number(prospectRow.gross_volume),
                sourceUrl: prospectRow.source_url,
              }}
              initialInputs={prospectRow.rank_inputs ?? {}}
              initialScore={Number(prospectRow.rank_score)}
              initialStage={prospectRow.stage}
              initialSourcingStatus={prospectRow.sourcing_status}
              initialSourcingNote={prospectRow.sourcing_note}
            />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
