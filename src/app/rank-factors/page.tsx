import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { RankFactorKind } from '@/lib/prospects';
import {
  RankFactorsClient,
  type FactorInit,
  type ThresholdsInit,
} from './RankFactorsClient';

/**
 * Rank-factor editor — the research scoring config (super-admin only).
 *
 * Loads every rank factor (active and inactive) and the three threshold
 * rows, then hands them to the editor.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Rank Factors' };

interface FactorRow {
  key: string;
  label: string;
  help_text: string | null;
  kind: RankFactorKind;
  weight: string;
  max_input: string | null;
  active: boolean;
}
interface ConfigRow {
  key: string;
  value: string;
}

export default async function RankFactorsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/rank-factors');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const [factorRows, configRows] = await Promise.all([
    sql<FactorRow>`
      SELECT key, label, help_text, kind, weight, max_input, active
      FROM rank_factors
      ORDER BY sort_order, label`,
    sql<ConfigRow>`SELECT key, value FROM rank_config`,
  ]);

  const factors: FactorInit[] = factorRows.map((r) => ({
    key: r.key,
    label: r.label,
    helpText: r.help_text ?? '',
    kind: r.kind,
    weight: Number(r.weight),
    maxInput: r.max_input === null ? null : Number(r.max_input),
    active: r.active,
  }));

  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const thresholds: ThresholdsInit = {
    qualifiedMin: cfg.get('qualified_min') ?? 8,
    borderlineMin: cfg.get('borderline_min') ?? 6,
    targetCount: cfg.get('qualified_target_count') ?? 10,
  };

  return (
    <div className="app-shell">
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
              How an agent <em style={{ color: 'var(--accent)' }}>scores</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '60ch' }}>
              The factors the research page scores against, their weights, and the
              thresholds that sort an agent into qualified, borderline, or
              don&apos;t-message. Edit freely — nothing changes the scoring until you
              publish.
            </p>

            <RankFactorsClient factors={factors} thresholds={thresholds} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
