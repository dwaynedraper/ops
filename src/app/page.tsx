import Link from 'next/link';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { STAGE_LABEL, DEFAULT_BANDS, type ProspectStage } from '@/lib/prospects';
import {
  computeCycle,
  statusRank,
  type ContactScript,
  type ContactChannel,
  type CycleContact,
  type TrackingStatus,
} from '@/lib/tracking';

/**
 * Dashboard — the daily working surface.
 *
 * Owner-scoped (D-019): every count and queue here is the signed-in rep's
 * own pipeline. Three things, in priority order:
 *   1. Follow-ups due — prospects whose next touch is ready or overdue,
 *      computed on read from the contact cycle (no scheduler — D-020).
 *   2. The qualified banner — once enough prospects are qualified, prompt
 *      the rep to start contacting.
 *   3. Pipeline counts — where everything stands, by stage.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard' };

interface StageCountRow {
  stage: ProspectStage;
  n: number;
}
interface ScriptRow {
  id: string;
  stage_key: string;
  label: string;
  channel: ContactChannel;
  step_order: number;
  followup_after_days: number;
  subject: string | null;
  body: string;
}
interface CycleProspectRow {
  id: string;
  agent_name: string;
  agency: string | null;
  stage: ProspectStage;
  rank_score: string;
}
interface ContactRow {
  prospect_id: string;
  step_key: string;
  sent_at: Date;
  response_received: boolean;
}
interface ConfigRow {
  key: string;
  value: string;
}

const CYCLE_STAGES = ['qualified', 'contacting', 'responded'] as const;
// Stage tiles, in pipeline order. passed / dormant are summarised separately.
const TILE_STAGES: ProspectStage[] = [
  'researching',
  'qualified',
  'contacting',
  'responded',
  'signed',
  'client',
];

interface FollowUp {
  id: string;
  agentName: string;
  agency: string | null;
  rankScore: number;
  status: TrackingStatus;
  nextLabel: string;
}

export default async function Dashboard() {
  const session = await auth();
  const user = session?.user;
  const role = user?.role ?? 'partner';
  const firstName = (user?.displayName ?? user?.name ?? user?.email ?? '')
    .toString()
    .split(/[\s@]/)[0];

  // No session shouldn't happen (proxy.ts gates this) — render a safe shell.
  if (!user) {
    return (
      <div className="app-shell">
        <Sidebar role={role} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <main className="app-shell-main" style={{ flex: 1 }} />
          <Footer />
        </div>
      </div>
    );
  }

  const [countRows, scriptRows, cycleRows, configRows] = await Promise.all([
    sql<StageCountRow>`
      SELECT stage, COUNT(*)::int AS n
      FROM prospects
      WHERE owner_id = ${user.id}
      GROUP BY stage`,
    sql<ScriptRow>`
      SELECT id, stage_key, label, channel, step_order, followup_after_days,
             subject, body
      FROM contact_scripts
      WHERE active = true
      ORDER BY step_order`,
    sql<CycleProspectRow>`
      SELECT id, agent_name, agency, stage, rank_score
      FROM prospects
      WHERE owner_id = ${user.id} AND stage = ANY(${[...CYCLE_STAGES]})`,
    sql<ConfigRow>`SELECT key, value FROM rank_config`,
  ]);

  // ─── Pipeline counts ─────────────────────────────────────────────────
  const counts = new Map<ProspectStage, number>();
  for (const r of countRows) counts.set(r.stage, r.n);
  const countFor = (s: ProspectStage) => counts.get(s) ?? 0;

  // ─── Qualified banner ────────────────────────────────────────────────
  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const target = cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount;
  const qualifiedCount = countFor('qualified');
  const targetHit = qualifiedCount >= target && qualifiedCount > 0;

  // ─── Follow-ups due ──────────────────────────────────────────────────
  const scripts: ContactScript[] = scriptRows.map((r) => ({
    id: r.id,
    stageKey: r.stage_key,
    label: r.label,
    channel: r.channel,
    stepOrder: r.step_order,
    followupAfterDays: r.followup_after_days,
    subject: r.subject,
    body: r.body,
  }));

  const cycleIds = cycleRows.map((p) => p.id);
  const contactRows =
    cycleIds.length > 0
      ? await sql<ContactRow>`
          SELECT prospect_id, step_key, sent_at, response_received
          FROM prospect_contacts
          WHERE prospect_id = ANY(${cycleIds})`
      : [];

  const contactsByProspect = new Map<string, CycleContact[]>();
  for (const c of contactRows) {
    const list = contactsByProspect.get(c.prospect_id) ?? [];
    list.push({
      stepKey: c.step_key,
      sentAt: new Date(c.sent_at),
      responseReceived: c.response_received,
    });
    contactsByProspect.set(c.prospect_id, list);
  }

  const now = new Date();
  const followUps: FollowUp[] = [];
  for (const p of cycleRows) {
    const cycle = computeCycle(
      scripts,
      contactsByProspect.get(p.id) ?? [],
      p.stage,
      now,
    );
    // Only what needs the rep right now.
    if (cycle.status === 'ready' || cycle.status === 'due') {
      followUps.push({
        id: p.id,
        agentName: p.agent_name,
        agency: p.agency,
        rankScore: Number(p.rank_score),
        status: cycle.status,
        nextLabel: cycle.nextScript?.label ?? 'Next touch',
      });
    }
  }
  // Overdue follow-ups before fresh first-touches; then higher score first.
  followUps.sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    return r !== 0 ? r : b.rankScore - a.rankScore;
  });

  const passedDormant = countFor('passed') + countFor('dormant');

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Dashboard
            </div>
            <h1
              style={{
                fontSize: 'clamp(1.75rem, 3vw, 2.5rem)',
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                marginBottom: '0.5rem',
              }}
            >
              Welcome back, <em style={{ color: 'var(--accent)' }}>{firstName || 'partner'}</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '2rem', maxWidth: '52ch' }}>
              Who needs you today, and where the pipeline stands. Start at the top of
              the list and work down.
            </p>

            {/* ─── Qualified banner ──────────────────────────────────── */}
            {targetHit && (
              <Link
                href="/tracking"
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--border-accent)',
                  borderRadius: 'var(--radius)',
                  padding: '1rem 1.25rem',
                  marginBottom: '1.75rem',
                }}
              >
                <div
                  style={{
                    fontSize: '0.66rem',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    marginBottom: '0.3rem',
                  }}
                >
                  Time to contact
                </div>
                <div style={{ fontSize: '0.92rem', color: 'var(--text)' }}>
                  {qualifiedCount} qualified prospects are waiting. Open Tracking and
                  start the contact cycle. →
                </div>
              </Link>
            )}

            {/* ─── Follow-ups due ────────────────────────────────────── */}
            <section style={{ marginBottom: '2rem' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  marginBottom: '0.85rem',
                }}
              >
                <div className="eyebrow">Follow-ups due</div>
                {followUps.length > 0 && (
                  <Link
                    href="/tracking"
                    className="btn-ghost"
                    style={{ padding: '0.2rem 0' }}
                  >
                    Open Tracking →
                  </Link>
                )}
              </div>

              {followUps.length === 0 ? (
                <div className="surface-card">
                  <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    Nothing due right now — you&apos;re clear. Qualify new agents in
                    Research, or let an open follow-up window come around.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {followUps.map((f) => (
                    <Link
                      key={f.id}
                      href="/tracking"
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
                      <span
                        className="money"
                        style={{
                          fontSize: '1rem',
                          color: 'var(--text-faint)',
                          minWidth: '2.2rem',
                          textAlign: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {f.rankScore.toFixed(1)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: 'block',
                            fontSize: '0.88rem',
                            fontWeight: 600,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.agentName}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontSize: '0.74rem',
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.agency ?? 'No agency on file'}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: '0.62rem',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          color: f.status === 'due' ? 'var(--warn)' : 'var(--accent)',
                          flexShrink: 0,
                        }}
                      >
                        {f.status === 'due' ? 'Due' : 'Ready'} · {f.nextLabel}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* ─── Pipeline counts ───────────────────────────────────── */}
            <section>
              <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
                Your pipeline
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '1rem',
                }}
              >
                {TILE_STAGES.map((s) => (
                  <div key={s} className="surface-card">
                    <div
                      style={{
                        fontSize: '0.65rem',
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: 'var(--text-mid)',
                        fontWeight: 600,
                        marginBottom: '0.5rem',
                      }}
                    >
                      {STAGE_LABEL[s]}
                    </div>
                    <div
                      className="money"
                      style={{ fontSize: '1.65rem', color: 'var(--text)', lineHeight: 1.1 }}
                    >
                      {countFor(s)}
                    </div>
                  </div>
                ))}
              </div>
              {passedDormant > 0 && (
                <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: '0.75rem' }}>
                  {countFor('passed')} passed · {countFor('dormant')} dormant — off the
                  active board.
                </p>
              )}
            </section>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
