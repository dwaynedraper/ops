import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import {
  type RankFactor,
  type RankFactorKind,
  type RankBands,
  type ProspectStage,
  DEFAULT_BANDS,
} from '@/lib/prospects';
import {
  buildColumnConfig,
  type SourcingRow,
  type SourcingStatus,
  type SourcingColumn,
} from '@/lib/sourcing';
import { SourcingClient, type SourcingWorkflow } from './SourcingClient';

/**
 * Sourcing route — the rapid list-intake surface (D-023, D-024).
 *
 * Server component: loads every active workflow with its scoring config
 * and the rep's existing sourcing rows. The interactive client renders
 * the per-workflow spreadsheet. Owner-scoped (D-019): a rep sees only
 * the prospects they own. Each workflow's column set is built per
 * D-027 — identity + workflow-specific intake + hard qualifiers
 * (gates + scoring factors weighted ≥ 3) + triage.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sourcing' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  branch: 'portraits' | 'realestate' | 'corporate' | null;
  contact_noun: string;
  org_noun: string | null;
  accent: string;
}
interface FactorRow {
  workflow_key: string;
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
  workflow_key: string;
  key: string;
  value: string;
}
interface ProspectRow {
  id: string;
  workflow_key: string;
  contact_name: string;
  org_name: string | null;
  market_area: string | null;
  sides_count: number | null;
  gross_volume: string | null;
  source_url: string | null;
  sourcing_status: SourcingStatus;
  sourcing_note: string | null;
  rank_inputs: Record<string, boolean | number> | null;
  rank_score: string;
  stage: ProspectStage;
  created_at: string;
}

export default async function SourcingPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/sourcing');

  const role = user.role ?? 'partner';

  const [workflowRows, factorRows, configRows, prospectRows] =
    await Promise.all([
      sql<WorkflowRow>`
        SELECT workflow_key, name, branch, contact_noun, org_noun, accent
        FROM workflows
        WHERE active = true
        ORDER BY sort_order, name`,
      sql<FactorRow>`
        SELECT workflow_key, key, label, help_text, kind, weight, max_input,
               is_gate, sort_order
        FROM rank_factors
        WHERE active = true
        ORDER BY workflow_key, sort_order, label`,
      sql<ConfigRow>`SELECT workflow_key, key, value FROM rank_config`,
      sql<ProspectRow>`
        SELECT id, workflow_key, contact_name, org_name, market_area,
               sides_count, gross_volume::text AS gross_volume, source_url,
               sourcing_status, sourcing_note,
               rank_inputs, rank_score::text AS rank_score, stage,
               created_at::text AS created_at
        FROM prospects
        WHERE owner_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT 200`,
    ]);

  // Group factors + thresholds by workflow.
  const factorsByWf = new Map<string, RankFactor[]>();
  for (const r of factorRows) {
    const list = factorsByWf.get(r.workflow_key) ?? [];
    list.push({
      key: r.key,
      label: r.label,
      helpText: r.help_text,
      kind: r.kind,
      weight: Number(r.weight),
      maxInput: r.max_input === null ? null : Number(r.max_input),
      isGate: r.is_gate,
      sortOrder: r.sort_order,
    });
    factorsByWf.set(r.workflow_key, list);
  }

  const cfgByWf = new Map<string, Map<string, number>>();
  for (const r of configRows) {
    const m = cfgByWf.get(r.workflow_key) ?? new Map<string, number>();
    m.set(r.key, Number(r.value));
    cfgByWf.set(r.workflow_key, m);
  }

  const workflows: SourcingWorkflow[] = workflowRows.map((w) => {
    const cfg = cfgByWf.get(w.workflow_key);
    const bands: RankBands = {
      qualifiedMin: cfg?.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
      borderlineMin: cfg?.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
      targetCount: cfg?.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
    };
    const factors = factorsByWf.get(w.workflow_key) ?? [];
    const columns: SourcingColumn[] = buildColumnConfig(w.workflow_key, factors);
    return {
      key: w.workflow_key,
      name: w.name,
      branch: w.branch,
      contactNoun: w.contact_noun,
      orgNoun: w.org_noun,
      accent: w.accent,
      bands,
      columns,
      factors,
    };
  });

  // Build the hard-qualifier key set per workflow so we can compute the
  // `hasPartialScore` flag client-side without re-querying.
  const hardKeysByWf = new Map<string, string[]>();
  for (const [wfKey, factors] of factorsByWf.entries()) {
    hardKeysByWf.set(
      wfKey,
      factors.filter((f) => f.isGate || f.weight >= 3).map((f) => f.key),
    );
  }

  const rows: SourcingRow[] = prospectRows.map((p) => {
    const rankInputs = p.rank_inputs ?? {};
    const hardKeys = hardKeysByWf.get(p.workflow_key) ?? [];
    let hasPartial = false;
    for (const k of hardKeys) {
      const v = rankInputs[k];
      if (v === true || (typeof v === 'number' && v > 0)) {
        hasPartial = true;
        break;
      }
    }
    return {
      id: p.id,
      workflowKey: p.workflow_key,
      contactName: p.contact_name,
      orgName: p.org_name,
      marketArea: p.market_area,
      sidesCount: p.sides_count,
      grossVolume: p.gross_volume === null ? null : Number(p.gross_volume),
      sourceUrl: p.source_url,
      sourcingStatus: p.sourcing_status,
      sourcingNote: p.sourcing_note,
      rankInputs,
      rankScore: Number(p.rank_score),
      stage: p.stage,
      hasPartialScore: hasPartial,
      createdAt: p.created_at,
    };
  });

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1400, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Sourcing
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
              Drop a list. <em style={{ color: 'var(--accent)' }}>Triage fast.</em>
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '64ch' }}>
              The rapid intake. Drop names off a public ranking or your own list,
              fill the hard qualifiers as you go, and toggle each row Qualify or
              Pass. The pre-score badge is a hint — your call decides.
              The deep work — notes, observations, supporting factors — happens
              on Qualify.
            </p>

            <SourcingClient workflows={workflows} initialRows={rows} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
