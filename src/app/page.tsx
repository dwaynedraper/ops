import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { STAGE_LABEL, type ProspectStage } from '@/lib/prospects';
import {
  computeCycle,
  statusRank,
  type ContactScript,
  type ContactChannel,
  type CycleContact,
  type TrackingStatus,
} from '@/lib/tracking';

/**
 * Dashboard — the daily working surface, multi-workflow.
 *
 * Owner-scoped (D-019): every count and queue is the signed-in rep's own
 * pipeline. Follow-ups are cross-workflow and urgency-sorted; the pipeline
 * is grouped by workflow, each reading its own qualified target.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  accent: string;
}
interface StageCountRow {
  workflow_key: string;
  stage: ProspectStage;
  n: number;
}
interface TargetRow {
  workflow_key: string;
  value: string;
}
interface ScriptRow {
  workflow_key: string;
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
  workflow_key: string;
  contact_name: string;
  org_name: string | null;
  stage: ProspectStage;
  rank_score: string;
}
interface ContactRow {
  prospect_id: string;
  step_key: string;
  sent_at: Date;
  response_received: boolean;
}

const CYCLE_STAGES = ['qualified', 'contacting', 'responded'] as const;
const QUALIFIED_STAGES: ProspectStage[] = [
  'qualified',
  'contacting',
  'responded',
  'signed',
  'client',
];
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
  workflowKey: string;
  contactName: string;
  orgName: string | null;
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

  // Logged-out users get redirected, consistent with every other page.
  // proxy.ts normally catches this first; this is the defense-in-depth.
  if (!user) {
    redirect('/signin');
  }

  const [workflowRows, countRows, targetRows, scriptRows, cycleRows] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
    sql<StageCountRow>`
      SELECT workflow_key, stage, COUNT(*)::int AS n
      FROM prospects
      WHERE owner_id = ${user.id}
      GROUP BY workflow_key, stage`,
    sql<TargetRow>`
      SELECT workflow_key, value FROM rank_config WHERE key = 'qualified_target_count'`,
    sql<ScriptRow>`
      SELECT workflow_key, stage_key, label, channel, step_order, followup_after_days,
             subject, body
      FROM contact_scripts
      WHERE active = true
      ORDER BY workflow_key, step_order`,
    sql<CycleProspectRow>`
      SELECT id, workflow_key, contact_name, org_name, stage, rank_score
      FROM prospects
      WHERE owner_id = ${user.id} AND stage = ANY(${[...CYCLE_STAGES]})`,
  ]);

  // workflow_key → stage → count
  const counts = new Map<string, Map<ProspectStage, number>>();
  for (const r of countRows) {
    const m = counts.get(r.workflow_key) ?? new Map<ProspectStage, number>();
    m.set(r.stage, r.n);
    counts.set(r.workflow_key, m);
  }
  const countOf = (wf: string, s: ProspectStage) => counts.get(wf)?.get(s) ?? 0;

  const targetByWf = new Map(targetRows.map((r) => [r.workflow_key, Number(r.value)]));

  // Scripts grouped by workflow.
  const scriptsByWf: Record<string, ContactScript[]> = {};
  for (const r of scriptRows) {
    (scriptsByWf[r.workflow_key] ??= []).push({
      id: '',
      stageKey: r.stage_key,
      label: r.label,
      channel: r.channel,
      stepOrder: r.step_order,
      followupAfterDays: r.followup_after_days,
      subject: r.subject,
      body: r.body,
    });
  }

  // Follow-ups due — across workflows, computed against each one's scripts.
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
      scriptsByWf[p.workflow_key] ?? [],
      contactsByProspect.get(p.id) ?? [],
      p.stage,
      now,
    );
    if (cycle.status === 'ready' || cycle.status === 'due') {
      followUps.push({
        id: p.id,
        workflowKey: p.workflow_key,
        contactName: p.contact_name,
        orgName: p.org_name,
        rankScore: Number(p.rank_score),
        status: cycle.status,
        nextLabel: cycle.nextScript?.label ?? 'Next touch',
      });
    }
  }
  followUps.sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    return r !== 0 ? r : b.rankScore - a.rankScore;
  });

  const wfByKey = new Map(workflowRows.map((w) => [w.workflow_key, w]));

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
              Who needs you today, and where each workflow stands. Start at the top
              of the list and work down.
            </p>

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
                  <Link href="/tracking" className="btn-ghost" style={{ padding: '0.2rem 0' }}>
                    Open Tracking →
                  </Link>
                )}
              </div>

              {followUps.length === 0 ? (
                <div className="surface-card">
                  <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    Nothing due right now — you&apos;re clear. Qualify new prospects,
                    or let an open follow-up window come around.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {followUps.map((f) => {
                    const wf = wfByKey.get(f.workflowKey);
                    return (
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
                            {f.contactName}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '0.74rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                display: 'inline-block',
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: wf?.accent ?? 'var(--text-faint)',
                                marginRight: '0.4rem',
                              }}
                            />
                            {wf?.name ?? f.workflowKey}
                            {f.orgName ? ` · ${f.orgName}` : ''}
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
                    );
                  })}
                </div>
              )}
            </section>

            {/* ─── Pipeline by workflow ──────────────────────────────── */}
            <section>
              <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
                Pipeline by workflow
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {workflowRows.map((w) => {
                  const qualified = QUALIFIED_STAGES.reduce(
                    (s, st) => s + countOf(w.workflow_key, st),
                    0,
                  );
                  const target = targetByWf.get(w.workflow_key) ?? 10;
                  const hit = qualified >= target && qualified > 0;
                  return (
                    <div key={w.workflow_key} className="surface-card">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          marginBottom: '0.6rem',
                        }}
                      >
                        <div
                          style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)' }}
                        >
                          <span
                            aria-hidden
                            style={{
                              display: 'inline-block',
                              width: 9,
                              height: 9,
                              borderRadius: '50%',
                              background: w.accent,
                              marginRight: '0.5rem',
                            }}
                          />
                          {w.name}
                        </div>
                        {hit ? (
                          <Link
                            href="/tracking"
                            style={{
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              color: 'var(--good)',
                              textDecoration: 'none',
                            }}
                          >
                            {qualified} / {target} qualified — start contacting →
                          </Link>
                        ) : (
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                            {qualified} / {target} qualified
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                          gap: '0.5rem',
                        }}
                      >
                        {TILE_STAGES.map((s) => (
                          <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                            <span
                              className="money"
                              style={{ fontSize: '1.05rem', color: 'var(--text)' }}
                            >
                              {countOf(w.workflow_key, s)}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                              {STAGE_LABEL[s]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
