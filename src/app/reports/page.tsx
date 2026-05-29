import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import {
  loadReportsData,
  resolveRange,
  type DateRangeKey,
} from '@/lib/reports/query';
import { PipelineVelocityCard } from './cards/PipelineVelocityCard';
import { FunnelCard } from './cards/FunnelCard';
import { WorkflowRoiCard } from './cards/WorkflowRoiCard';
import { RepLeaderboardCard } from './cards/RepLeaderboardCard';
import { ScoreValidationCard } from './cards/ScoreValidationCard';
import { StalePipelineCard } from './cards/StalePipelineCard';

/**
 * Phase R · /reports — admin-only analytics dashboard.
 *
 * Six cards driven by `daily_metric_snapshot` (cards 1–5) plus the live
 * stale-pipeline list (card 6). Layout: Pipeline Velocity hero, then a
 * 2-column grid of the remaining five cards.
 *
 * Date range comes from `?range=7|30|90|ytd`, defaulting to 30. The
 * picker in the header is rendered as Next links — no client state.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

const RANGE_KEYS: DateRangeKey[] = ['7', '30', '90', 'ytd'];
const RANGE_LABELS: Record<DateRangeKey, string> = {
  '7': '7d',
  '30': '30d',
  '90': '90d',
  ytd: 'YTD',
};

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/reports');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') notFound();

  const params = await searchParams;
  const rangeKey: DateRangeKey =
    (RANGE_KEYS as string[]).includes(params.range ?? '')
      ? (params.range as DateRangeKey)
      : '30';
  const range = resolveRange(rangeKey);
  const data = await loadReportsData(range);

  return (
    <div className="app-shell">
      <Sidebar role="super_admin" />

      <main
        className="app-main"
        style={{ padding: '1.5rem 1.75rem 2rem', minHeight: 0 }}
      >
        {/* Header — title + date range picker */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <p
              style={{
                color: 'var(--accent)',
                fontSize: '0.7rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                fontWeight: 700,
                marginBottom: '0.35rem',
              }}
            >
              Phase R · Admin Analytics
            </p>
            <h1
              style={{
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 300,
                fontSize: 'clamp(1.6rem, 3vw, 2.1rem)',
                lineHeight: 1.1,
                color: 'var(--text)',
                letterSpacing: '-0.005em',
              }}
            >
              Reports —{' '}
              <em style={{ color: 'var(--accent)' }}>{range.label.toLowerCase()}.</em>
            </h1>
          </div>

          <nav
            aria-label="Date range"
            style={{
              display: 'inline-flex',
              gap: '0.25rem',
              padding: '0.25rem',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              background: 'var(--surface-2)',
            }}
          >
            {RANGE_KEYS.map((k) => {
              const active = k === range.key;
              return (
                <Link
                  key={k}
                  href={k === '30' ? '/reports' : `/reports?range=${k}`}
                  style={{
                    padding: '0.35rem 0.7rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    borderRadius: '0.35rem',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--surface)' : 'var(--text-mid)',
                  }}
                >
                  {RANGE_LABELS[k]}
                </Link>
              );
            })}
          </nav>
        </header>

        {/* Hero: Pipeline Velocity */}
        <PipelineVelocityCard data={data.velocity} range={range} />

        {/* 2-column grid for the other five cards */}
        <div
          style={{
            marginTop: '1.25rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(20rem, 100%), 1fr))',
            gap: '1.25rem',
          }}
        >
          <FunnelCard data={data.funnel} />
          <WorkflowRoiCard data={data.workflowRoi} />
          <RepLeaderboardCard data={data.repLeaderboard} />
          <ScoreValidationCard data={data.scoreValidation} />
        </div>

        {/* Stale pipeline — full width below the grid */}
        <div style={{ marginTop: '1.25rem' }}>
          <StalePipelineCard data={data.stalePipeline} />
        </div>

        <Footer />
      </main>
    </div>
  );
}
