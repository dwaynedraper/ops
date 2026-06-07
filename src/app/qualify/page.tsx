import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import {
  DEFAULT_BANDS,
  type RankFactor,
  type RankBands,
  type RankFactorKind,
  type ProspectStage,
  type ProspectListItem,
} from '@/lib/prospects';
import { QualifyClient, type QualifyWorkflow } from './QualifyClient';

/**
 * Qualify route — the per-prospect entry gate + 0–10 scoring page,
 * multi-workflow.
 *
 * Server component: loads every active workflow with its scoring config,
 * and the rep's prospect list. The interactive client carries the
 * workflow picker. Owner-scoped (D-019): a rep qualifies their own
 * prospects; the qualified counts are per workflow.
 *
 * Renamed from /research → /qualify in Phase E (D-023). The deeper
 * per-prospect work surface continues to live at /prospects/[id] (Option B).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Qualify' };

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
  rank_score: string;
  stage: ProspectStage;
  created_at: Date;
  sourcing_status: 'undecided' | 'pursue' | 'qualify' | 'reject';
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const QUALIFIED_STAGES = ['qualified', 'contacting', 'responded', 'signed', 'client'];

export default async function QualifyPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/qualify');

  const role = user.role ?? 'partner';

  const [workflowRows, factorRows, configRows, prospectRows, qualifiedRows] =
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
               rank_score, stage, created_at, sourcing_status
        FROM prospects
        WHERE owner_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT 100`,
      sql<{ workflow_key: string; n: number }>`
        SELECT workflow_key, COUNT(*)::int AS n
        FROM prospects
        WHERE owner_id = ${user.id} AND stage = ANY(${QUALIFIED_STAGES})
        GROUP BY workflow_key`,
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

  const qualifiedByWf = new Map(qualifiedRows.map((r) => [r.workflow_key, r.n]));

  const workflows: QualifyWorkflow[] = workflowRows.map((w) => {
    const cfg = cfgByWf.get(w.workflow_key);
    const bands: RankBands = {
      qualifiedMin: cfg?.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
      borderlineMin: cfg?.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
      targetCount: cfg?.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
    };
    return {
      key: w.workflow_key,
      name: w.name,
      branch: w.branch,
      contactNoun: w.contact_noun,
      orgNoun: w.org_noun,
      accent: w.accent,
      factors: factorsByWf.get(w.workflow_key) ?? [],
      bands,
      qualifiedCount: qualifiedByWf.get(w.workflow_key) ?? 0,
    };
  });

  const prospects: ProspectListItem[] = prospectRows.map((p) => ({
    id: p.id,
    workflowKey: p.workflow_key,
    contactName: p.contact_name,
    orgName: p.org_name,
    marketArea: p.market_area,
    rankScore: Number(p.rank_score),
    stage: p.stage,
    createdAt: DATE_FMT.format(new Date(p.created_at)),
    sourcingStatus: p.sourcing_status,
  }));

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Qualify
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
              Qualify the <em style={{ color: 'var(--accent)' }}>right</em> prospects.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Pick the workflow you&apos;re qualifying for. Each has its own entry
              gate and its own scoring — clear the gates, score the fit, and the
              strong ones move into the pipeline.
            </p>

            <QualifyClient workflows={workflows} prospects={prospects} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
