import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import {
  classifyBand,
  DEFAULT_BANDS,
  type RankFactor,
  type RankBands,
  type ProspectStage,
  type ProspectListItem,
} from '@/lib/prospects';
import { ResearchClient } from './ResearchClient';

/**
 * Research route — the pipeline's entry point.
 *
 * Server component: gates on the session, loads the editable scoring
 * config (rank_factors + rank_config) and the rep's prospect list, then
 * hands the config to the interactive client. proxy.ts already blocks
 * anonymous access; the redirect here is belt-and-braces.
 *
 * Visibility is owner-scoped (D-019): a partner sees their own prospects,
 * a super_admin sees everyone's. The qualified-count toward the contact
 * target is always the signed-in rep's own.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Research' };

interface FactorRow {
  key: string;
  label: string;
  help_text: string | null;
  kind: 'bool' | 'number';
  weight: string;
  max_input: string | null;
  sort_order: number;
}
interface ConfigRow {
  key: string;
  value: string;
}
interface ProspectRow {
  id: string;
  agent_name: string;
  agency: string | null;
  market_area: string | null;
  rank_score: string;
  stage: ProspectStage;
  created_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default async function ProspectsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/prospects');

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const [factorRows, configRows, prospectRows, qualifiedRow] = await Promise.all([
    sql<FactorRow>`
      SELECT key, label, help_text, kind, weight, max_input, sort_order
      FROM rank_factors
      WHERE active = true
      ORDER BY sort_order, label`,
    sql<ConfigRow>`SELECT key, value FROM rank_config`,
    isAdmin
      ? sql<ProspectRow>`
          SELECT id, agent_name, agency, market_area, rank_score, stage, created_at
          FROM prospects
          ORDER BY created_at DESC
          LIMIT 50`
      : sql<ProspectRow>`
          SELECT id, agent_name, agency, market_area, rank_score, stage, created_at
          FROM prospects
          WHERE owner_id = ${user.id}
          ORDER BY created_at DESC
          LIMIT 50`,
    sqlOne<{ n: number }>`
      SELECT COUNT(*)::int AS n
      FROM prospects
      WHERE owner_id = ${user.id}
        AND stage IN ('qualified', 'contacting', 'responded', 'signed', 'client')`,
  ]);

  const factors: RankFactor[] = factorRows.map((r) => ({
    key: r.key,
    label: r.label,
    helpText: r.help_text,
    kind: r.kind,
    weight: Number(r.weight),
    maxInput: r.max_input === null ? null : Number(r.max_input),
    sortOrder: r.sort_order,
  }));

  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const bands: RankBands = {
    qualifiedMin: cfg.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
    borderlineMin: cfg.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
    targetCount: cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
  };

  const prospects: ProspectListItem[] = prospectRows.map((r) => ({
    id: r.id,
    agentName: r.agent_name,
    agency: r.agency,
    marketArea: r.market_area,
    rankScore: Number(r.rank_score),
    stage: r.stage,
    createdAt: DATE_FMT.format(new Date(r.created_at)),
  }));

  const qualifiedCount = qualifiedRow?.n ?? 0;

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Research
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
              Find the <em style={{ color: 'var(--accent)' }}>right</em> agents.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '56ch' }}>
              Two gates decide if an agent is even a prospect: a listing worth shooting
              and a visible photo need. Clear both, then score them. Eight and up is
              qualified — work those first.
            </p>

            <ResearchClient
              factors={factors}
              bands={bands}
              qualifiedCount={qualifiedCount}
            />

            <ProspectListSection items={prospects} bands={bands} isAdmin={isAdmin} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

// ─── Prospect list (server-rendered; refreshes after each add) ──────────

type StageTone = 'good' | 'warn' | 'accent' | 'cyan' | 'muted';

const STAGE_META: Record<ProspectStage, { label: string; tone: StageTone }> = {
  researching: { label: 'Researching', tone: 'muted' },
  qualified: { label: 'Qualified', tone: 'good' },
  contacting: { label: 'Contacting', tone: 'accent' },
  responded: { label: 'Responded', tone: 'warn' },
  signed: { label: 'Signed', tone: 'good' },
  client: { label: 'Client', tone: 'cyan' },
  passed: { label: 'Passed', tone: 'muted' },
  dormant: { label: 'Dormant', tone: 'muted' },
};

const TONE_COLOR: Record<StageTone, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
  cyan: 'var(--brand-cyan)',
  muted: 'var(--text-faint)',
};

function ProspectListSection({
  items,
  bands,
  isAdmin,
}: {
  items: ProspectListItem[];
  bands: RankBands;
  isAdmin: boolean;
}) {
  return (
    <section style={{ marginTop: '2rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.85rem',
        }}
      >
        <div className="eyebrow">{isAdmin ? 'All prospects' : 'Your prospects'}</div>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
          {items.length > 0 ? `${items.length} most recent` : null}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="surface-card">
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            No prospects yet — research one above.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {items.map((p) => {
            const stage = STAGE_META[p.stage];
            const band = classifyBand(p.rankScore, bands);
            const scoreColor =
              band === 'qualified'
                ? 'var(--good)'
                : band === 'borderline'
                  ? 'var(--warn)'
                  : 'var(--text-faint)';
            return (
              <Link
                key={p.id}
                href={`/prospects/${p.id}`}
                className="surface-tool"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.7rem 0.9rem',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                {/* Score */}
                <div
                  className="money"
                  style={{
                    fontSize: '1.15rem',
                    color: scoreColor,
                    minWidth: '2.4rem',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {p.rankScore.toFixed(1)}
                </div>

                {/* Identity */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.agentName}
                  </div>
                  <div
                    style={{
                      fontSize: '0.74rem',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {[p.agency, p.marketArea].filter(Boolean).join(' · ') || 'No agency on file'}
                  </div>
                </div>

                {/* Stage */}
                <span
                  style={{
                    fontSize: '0.62rem',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: TONE_COLOR[stage.tone],
                    border: `1px solid ${TONE_COLOR[stage.tone]}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.2rem 0.5rem',
                    flexShrink: 0,
                  }}
                >
                  {stage.label}
                </span>

                <span
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-faint)',
                    minWidth: '3.2rem',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {p.createdAt}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
