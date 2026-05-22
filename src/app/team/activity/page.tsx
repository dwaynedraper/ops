import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { ProspectStage } from '@/lib/prospects';

/**
 * Team — the supervisor report (super_admin only).
 *
 * One card per rep: what moved in their pipeline over a chosen window,
 * plus where their book stands right now. Every windowed metric is drawn
 * from a real timestamp — prospects.created_at, prospect_stage_events
 * .created_at, prospect_contacts.sent_at and .responded_at,
 * prospect_notes.created_at — so the numbers are activity, not a
 * snapshot guess. Attribution is by the prospect's owner: each card is
 * one rep's book of business and what happened inside it.
 *
 * Reached from the /team roster.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Team activity' };

interface RepRow {
  user_id: string;
  name: string;
  role: 'super_admin' | 'partner';
}
interface CountRow {
  owner_id: string;
  n: number;
}
interface StageCountRow {
  owner_id: string;
  stage: ProspectStage;
  n: number;
}

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
] as const;

const DAY_MS = 86_400_000;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/team');

  const role = user.role ?? 'partner';
  // A partner has no business here — the report is the whole team's book.
  if (role !== 'super_admin') notFound();

  const { days: daysParam } = await searchParams;
  const days = WINDOWS.some((w) => w.days === Number(daysParam))
    ? Number(daysParam)
    : 7;
  const since = new Date(new Date().getTime() - days * DAY_MS);

  // The pipeline's forward order — a stage move counts as "advanced"
  // when its to-stage sits later in this list than its from-stage.
  const PIPELINE_ORDER = [
    'researching',
    'qualified',
    'contacting',
    'responded',
    'signed',
    'client',
  ];

  const [
    repRows,
    addedRows,
    advancedRows,
    touchRows,
    replyRows,
    noteRows,
    stageRows,
  ] = await Promise.all([
    sql<RepRow>`
      SELECT pr.user_id,
             COALESCE(NULLIF(pr.display_name, ''), u.name, u.email, 'Unnamed') AS name,
             pr.role
      FROM ops_profiles pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.status <> 'disabled'
      ORDER BY name`,
    // New prospects added in the window.
    sql<CountRow>`
      SELECT owner_id, COUNT(*)::int AS n
      FROM prospects
      WHERE created_at >= ${since}
      GROUP BY owner_id`,
    // Forward stage transitions in the window — a prospect moved up the
    // pipeline (research → tracking → signed). Creation events (NULL
    // from_stage) and exits (passed / dormant) fall out naturally:
    // array_position returns NULL for an unlisted stage.
    sql<CountRow>`
      SELECT p.owner_id, COUNT(*)::int AS n
      FROM prospect_stage_events e
      JOIN prospects p ON p.id = e.prospect_id
      WHERE e.created_at >= ${since}
        AND array_position(${PIPELINE_ORDER}::text[], e.to_stage)
          > array_position(${PIPELINE_ORDER}::text[], e.from_stage)
      GROUP BY p.owner_id`,
    // Every touch logged in the window.
    sql<CountRow>`
      SELECT p.owner_id, COUNT(*)::int AS n
      FROM prospect_contacts c
      JOIN prospects p ON p.id = c.prospect_id
      WHERE c.sent_at >= ${since}
      GROUP BY p.owner_id`,
    // Responses received in the window.
    sql<CountRow>`
      SELECT p.owner_id, COUNT(*)::int AS n
      FROM prospect_contacts c
      JOIN prospects p ON p.id = c.prospect_id
      WHERE c.response_received = true AND c.responded_at >= ${since}
      GROUP BY p.owner_id`,
    // Notes added in the window.
    sql<CountRow>`
      SELECT p.owner_id, COUNT(*)::int AS n
      FROM prospect_notes n
      JOIN prospects p ON p.id = n.prospect_id
      WHERE n.created_at >= ${since}
      GROUP BY p.owner_id`,
    // Current pipeline snapshot — not windowed.
    sql<StageCountRow>`
      SELECT owner_id, stage, COUNT(*)::int AS n
      FROM prospects
      GROUP BY owner_id, stage`,
  ]);

  const mapOf = (rows: CountRow[]) =>
    new Map(rows.map((r) => [r.owner_id, r.n]));
  const added = mapOf(addedRows);
  const advanced = mapOf(advancedRows);
  const touches = mapOf(touchRows);
  const replies = mapOf(replyRows);
  const notes = mapOf(noteRows);

  // owner_id → stage → count
  const stages = new Map<string, Map<ProspectStage, number>>();
  for (const r of stageRows) {
    const m = stages.get(r.owner_id) ?? new Map<ProspectStage, number>();
    m.set(r.stage, r.n);
    stages.set(r.owner_id, m);
  }

  interface RepReport {
    id: string;
    name: string;
    role: 'super_admin' | 'partner';
    added: number;
    advanced: number;
    touches: number;
    replies: number;
    notes: number;
    inResearch: number;
    inCycle: number;
    signed: number;
    activity: number;
  }

  const reports: RepReport[] = repRows.map((r) => {
    const s = stages.get(r.user_id) ?? new Map<ProspectStage, number>();
    const at = (k: ProspectStage) => s.get(k) ?? 0;
    const a = added.get(r.user_id) ?? 0;
    const ad = advanced.get(r.user_id) ?? 0;
    const t = touches.get(r.user_id) ?? 0;
    const rp = replies.get(r.user_id) ?? 0;
    const n = notes.get(r.user_id) ?? 0;
    return {
      id: r.user_id,
      name: r.name,
      role: r.role,
      added: a,
      advanced: ad,
      touches: t,
      replies: rp,
      notes: n,
      inResearch: at('researching') + at('qualified'),
      inCycle: at('contacting') + at('responded'),
      signed: at('signed') + at('client'),
      activity: a + ad + t + rp + n,
    };
  });

  // Most active rep first; quiet reps still listed, at the bottom.
  reports.sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name));

  const team = reports.reduce(
    (acc, r) => ({
      added: acc.added + r.added,
      advanced: acc.advanced + r.advanced,
      touches: acc.touches + r.touches,
      replies: acc.replies + r.replies,
    }),
    { added: 0, advanced: 0, touches: 0, replies: 0 },
  );

  const windowLabel = WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`;

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <Link
              href="/team"
              className="btn-ghost"
              style={{ padding: '0.2rem 0', marginBottom: '0.5rem', display: 'inline-block' }}
            >
              ← Team roster
            </Link>
            <h1
              style={{
                fontSize: 'clamp(1.6rem, 3vw, 2.3rem)',
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                marginBottom: '0.5rem',
              }}
            >
              The <em style={{ color: 'var(--accent)' }}>supervisor</em> report.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.25rem', maxWidth: '58ch' }}>
              What each rep moved over the last {windowLabel}, and where their book
              stands now. Across the team: {team.added} added, {team.advanced} advanced
              a stage, {team.touches} touches, {team.replies} repl
              {team.replies === 1 ? 'y' : 'ies'}.
            </p>

            {/* Window toggle */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.5rem' }}>
              {WINDOWS.map((w) => {
                const on = w.days === days;
                return (
                  <Link
                    key={w.days}
                    href={`/team/activity?days=${w.days}`}
                    style={{
                      padding: '0.3rem 0.7rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'var(--accent-dim)' : 'transparent',
                      color: on ? 'var(--text)' : 'var(--text-faint)',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    {w.label}
                  </Link>
                );
              })}
            </div>

            {reports.length === 0 ? (
              <div className="surface-card">
                <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                  No active reps on the team yet.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {reports.map((r) => (
                  <RepCard key={r.id} rep={r} windowLabel={windowLabel} />
                ))}
              </div>
            )}

            <p
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-faint)',
                marginTop: '1.5rem',
                maxWidth: '62ch',
              }}
            >
              Windowed metrics count real timestamps. &ldquo;Advanced&rdquo; is a
              forward stage move logged in prospect_stage_events — research →
              tracking → signed. The pipeline snapshot is current, not windowed.
            </p>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

// ─── One rep's card ───────────────────────────────────────────────────

function RepCard({
  rep,
  windowLabel,
}: {
  rep: {
    name: string;
    role: 'super_admin' | 'partner';
    added: number;
    advanced: number;
    touches: number;
    replies: number;
    notes: number;
    inResearch: number;
    inCycle: number;
    signed: number;
    activity: number;
  };
  windowLabel: string;
}) {
  // The plain-English line — the report the way you'd say it out loud.
  const sentence =
    rep.activity === 0
      ? `No logged activity in the last ${windowLabel}.`
      : 'Over the last ' +
        windowLabel +
        ': ' +
        [
          rep.added > 0 && `added ${rep.added} prospect${rep.added === 1 ? '' : 's'}`,
          rep.advanced > 0 &&
            `advanced ${rep.advanced} a stage`,
          rep.touches > 0 && `logged ${rep.touches} touch${rep.touches === 1 ? '' : 'es'}`,
          rep.replies > 0 &&
            `earned ${rep.replies} repl${rep.replies === 1 ? 'y' : 'ies'}`,
          rep.notes > 0 && `wrote ${rep.notes} note${rep.notes === 1 ? '' : 's'}`,
        ]
          .filter(Boolean)
          .join(', ') +
        '.';

  return (
    <div className="surface-card">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
          {rep.name}
        </div>
        {rep.role === 'super_admin' && (
          <span
            style={{
              fontSize: '0.6rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--text-faint)',
            }}
          >
            Admin
          </span>
        )}
      </div>

      <p style={{ fontSize: '0.82rem', color: 'var(--text-mid)', marginBottom: '0.85rem' }}>
        {sentence}
      </p>

      {/* Windowed activity */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
          gap: '0.6rem',
          marginBottom: '0.85rem',
        }}
      >
        <Stat n={rep.added} label="Added" />
        <Stat n={rep.advanced} label="Advanced" />
        <Stat n={rep.touches} label="Touches" />
        <Stat n={rep.replies} label="Replies" />
        <Stat n={rep.notes} label="Notes" />
      </div>

      {/* Current pipeline snapshot */}
      <div
        style={{
          display: 'flex',
          gap: '1.1rem',
          flexWrap: 'wrap',
          paddingTop: '0.7rem',
          borderTop: '1px solid var(--border)',
          fontSize: '0.74rem',
          color: 'var(--text-faint)',
        }}
      >
        <span>
          <strong style={{ color: 'var(--text-mid)' }}>{rep.inResearch}</strong> in
          research
        </span>
        <span>
          <strong style={{ color: 'var(--text-mid)' }}>{rep.inCycle}</strong> in cycle
        </span>
        <span>
          <strong style={{ color: 'var(--text-mid)' }}>{rep.signed}</strong> signed
        </span>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
      <span
        className="money"
        style={{
          fontSize: '1.3rem',
          color: n > 0 ? 'var(--text)' : 'var(--text-faint)',
          lineHeight: 1,
        }}
      >
        {n}
      </span>
      <span
        style={{
          fontSize: '0.64rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--text-faint)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
