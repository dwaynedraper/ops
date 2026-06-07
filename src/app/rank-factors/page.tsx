import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { RankFactorKind } from '@/lib/prospects';
import { RankFactorsClient, type WorkflowConfig } from './RankFactorsClient';

/**
 * Rank-factor editor — the Qualify-page scoring config, per workflow
 * (super-admin only). Loads every workflow with its factors (active and
 * inactive) and its three thresholds.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Rank Factors' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
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
  active: boolean;
}
interface ConfigRow {
  workflow_key: string;
  key: string;
  value: string;
}

export default async function RankFactorsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/rank-factors');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const [workflowRows, factorRows, configRows] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
    sql<FactorRow>`
      SELECT workflow_key, key, label, help_text, kind, weight, max_input, is_gate, active
      FROM rank_factors
      ORDER BY workflow_key, sort_order, label`,
    sql<ConfigRow>`SELECT workflow_key, key, value FROM rank_config`,
  ]);

  const factorsByWf = new Map<string, FactorRow[]>();
  for (const r of factorRows) {
    const list = factorsByWf.get(r.workflow_key) ?? [];
    list.push(r);
    factorsByWf.set(r.workflow_key, list);
  }

  const cfgByWf = new Map<string, Map<string, number>>();
  for (const r of configRows) {
    const m = cfgByWf.get(r.workflow_key) ?? new Map<string, number>();
    m.set(r.key, Number(r.value));
    cfgByWf.set(r.workflow_key, m);
  }

  const workflows: WorkflowConfig[] = workflowRows.map((w) => {
    const cfg = cfgByWf.get(w.workflow_key);
    return {
      key: w.workflow_key,
      name: w.name,
      accent: w.accent,
      factors: (factorsByWf.get(w.workflow_key) ?? []).map((r) => ({
        key: r.key,
        label: r.label,
        helpText: r.help_text ?? '',
        kind: r.kind,
        weight: Number(r.weight),
        maxInput: r.max_input === null ? null : Number(r.max_input),
        isGate: r.is_gate,
        active: r.active,
      })),
      thresholds: {
        qualifiedMin: cfg?.get('qualified_min') ?? 8,
        borderlineMin: cfg?.get('borderline_min') ?? 6,
        targetCount: cfg?.get('qualified_target_count') ?? 10,
      },
    };
  });

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Rank Factors
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
              How a prospect <em style={{ color: 'var(--accent)' }}>scores</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '60ch' }}>
              Pick a workflow, then tune its entry gates, scoring factors, and
              thresholds. A factor marked as a gate must answer yes for a prospect
              to enter the pipeline. Nothing changes the scoring until you publish.
            </p>

            <RankFactorsClient workflows={workflows} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
