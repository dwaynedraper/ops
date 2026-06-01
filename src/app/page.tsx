import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { DigestOptIn } from '@/components/DigestOptIn';
import { fmtMoney } from '@/lib/pricing';
import { STAGE_LABEL, type ProspectStage } from '@/lib/prospects';
import { JOB_STAGE_LABEL } from '@/lib/jobs';
import { computeDigest, type DigestItem } from '@/lib/digest';
import { computeCommandCenter, type CommandRow } from '@/lib/command-center';
import { computeRepPulse, PULSE_WINDOW_DAYS, type RepPulseRow } from '@/lib/rep-pulse';
import { computeCashStrip, type CashStrip } from '@/lib/cash';
import { loadCalendar } from '@/lib/calendar-db';
import { addDays } from '@/lib/calendar';
import { GlanceStrip, type GlanceItem } from './GlanceStrip';

/**
 * Dashboard — the Command Center (D-062, D-063, Phase 3).
 *
 * One screen that runs the day. It composes two engines, both owner-scoped
 * (D-019): the prospect digest (lib/digest.ts — replies, follow-ups,
 * close-outs) and the job command center (lib/command-center.ts — shoots,
 * deliveries, money, prints, reviews). Sections run top-down by urgency:
 *
 *   1. This week        — shoots in the next 7 days (Wed/Thu rhythm)
 *   2. Needs you now     — the merged "do this next" feed
 *   3. Money             — outstanding balances + deposits
 *   4. To send / deliver — prospect close-outs + job handoffs & reviews
 *   5. Pipeline          — the cross-workflow funnel (retained)
 *
 * The digest engine still powers the morning email, so screen and inbox
 * agree (D-063); the command center now rides along in that email too.
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

const QUALIFIED_STAGES: ProspectStage[] = [
  'qualified',
  'contacting',
  'responded',
  'call_booked',
  'signed',
  'client',
];
const TILE_STAGES: ProspectStage[] = [
  'researching',
  'qualified',
  'contacting',
  'responded',
  'call_booked',
  'signed',
  'client',
];

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const SHOOT_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function shootLabel(date: string | null): string {
  if (!date) return 'No date';
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? 'No date' : SHOOT_FMT.format(d);
}

export default async function Dashboard() {
  const session = await auth();
  const user = session?.user;
  const role = user?.role ?? 'partner';
  const firstName = (user?.displayName ?? user?.name ?? user?.email ?? '')
    .toString()
    .split(/[\s@]/)[0];

  if (!user) {
    redirect('/signin');
  }

  const now = new Date();
  const isAdmin = role === 'super_admin';
  const [workflowRows, countRows, targetRows, digest, command, profile, repPulse, cash] =
    await Promise.all([
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
      computeDigest(user.id, now),
      computeCommandCenter(user.id, now),
      sqlOne<{ digest_email: boolean }>`
        SELECT digest_email FROM ops_profiles WHERE user_id = ${user.id}`,
      // Team pulse + cash strip are super-admin-only, whole-business views —
      // skip both queries entirely for partners.
      isAdmin ? computeRepPulse(now) : Promise.resolve([] as RepPulseRow[]),
      isAdmin ? computeCashStrip(now) : Promise.resolve(null),
    ]);

  // The dashboard 8-day glance (§3.2): today + 7, in the viewer's zone.
  const TZ = 'America/Chicago';
  const todayCivil = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // 'YYYY-MM-DD'
  const glanceItems: GlanceItem[] = (
    await loadCalendar(user.id, todayCivil, addDays(todayCivil, 7), TZ)
  ).map((it) => ({
    date: it.date,
    title: it.title,
    kind: it.kind,
    blockType: it.blockType,
    startClock: it.startClock,
    durationMin: it.durationMin,
  }));

  // Calls booked — Dean's own queue of prospects who self-booked a call via
  // the Sprout link (Phase 5E). Owner-scoped to the viewer; in practice the
  // calls route to Dean, who owns / closes them.
  const callsBooked = await sql<{
    id: string;
    contact_name: string;
    org_name: string | null;
    call_at: Date | null;
    workflow_name: string | null;
    accent: string | null;
  }>`
    SELECT p.id, p.contact_name, p.org_name, p.call_at,
           w.name AS workflow_name, w.accent
    FROM prospects p
    LEFT JOIN workflows w ON w.workflow_key = p.workflow_key
    WHERE p.stage = 'call_booked' AND p.owner_id = ${user.id}
    ORDER BY p.call_at ASC NULLS LAST, p.updated_at DESC`;

  const counts = new Map<string, Map<ProspectStage, number>>();
  for (const r of countRows) {
    const m = counts.get(r.workflow_key) ?? new Map<ProspectStage, number>();
    m.set(r.stage, r.n);
    counts.set(r.workflow_key, m);
  }
  const countOf = (wf: string, s: ProspectStage) => counts.get(wf)?.get(s) ?? 0;
  const targetByWf = new Map(targetRows.map((r) => [r.workflow_key, Number(r.value)]));

  const { replies, dueNow, closeOuts } = digest;

  // The unified morning summary — both engines in one line.
  const summaryParts: string[] = [];
  if (command.counts.needsNow > 0) summaryParts.push(`${command.counts.needsNow} need${command.counts.needsNow === 1 ? 's' : ''} action`);
  if (command.counts.shootsThisWeek > 0) summaryParts.push(`${command.counts.shootsThisWeek} shoot${command.counts.shootsThisWeek === 1 ? '' : 's'} this week`);
  if (replies.length > 0) summaryParts.push(`${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`);
  if (dueNow.length > 0) summaryParts.push(`${dueNow.length} follow-up${dueNow.length === 1 ? '' : 's'} due`);
  if (command.money.outstanding > 0) summaryParts.push(`${fmtMoney(command.money.outstanding)} outstanding`);

  const everythingClear =
    command.allClear && replies.length === 0 && dueNow.length === 0 && closeOuts.length === 0;

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              {DATE_FMT.format(now)}
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
              Good morning, <em style={{ color: 'var(--accent)' }}>{firstName || 'partner'}</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '2rem', maxWidth: '60ch' }}>
              {everythingClear
                ? 'Nothing is waiting on you this morning — a clean slate.'
                : `Your day: ${summaryParts.join(' · ')}.`}
            </p>

            {/* ─── The week ahead — 8-day glance (§3.2) ───────────────── */}
            <GlanceStrip today={todayCivil} items={glanceItems} />

            {/* ─── Cash strip (super-admin) — felt before read ────────── */}
            {isAdmin && cash && !cash.empty && <CashStripBar cash={cash} />}

            {/* ─── Calls booked — your call queue (Phase 5E) ──────────── */}
            {callsBooked.length > 0 && (
              <Section
                title="Calls booked"
                hint="Prospects who scheduled a call with you through the booking link. Yours to take."
              >
                {callsBooked.map((c) => {
                  const when = c.call_at
                    ? new Intl.DateTimeFormat('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(c.call_at))
                    : 'Time TBD';
                  return (
                    <Link
                      key={c.id}
                      href={`/prospects/${c.id}`}
                      className="surface-tool list-row-responsive"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.85rem',
                        padding: '0.7rem 0.9rem',
                        textDecoration: 'none',
                        color: 'inherit',
                        borderLeft: `3px solid ${c.accent ?? 'var(--brand-cyan)'}`,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>
                          {c.contact_name}
                          {c.org_name ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {c.org_name}</span> : null}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {c.workflow_name ?? 'Prospect'}
                        </span>
                      </span>
                      <span
                        className="list-row-trail"
                        style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--brand-cyan)', flexShrink: 0, textAlign: 'right' }}
                      >
                        {when}
                      </span>
                    </Link>
                  );
                })}
              </Section>
            )}

            {/* ─── 1. This week — shoots ──────────────────────────────── */}
            {command.thisWeek.length > 0 && (
              <Section
                title="This week"
                hint="Your booked shoots in the next seven days — Wednesdays and Thursdays do the heavy lifting."
                action={{ href: '/jobs', label: 'Open Jobs →' }}
              >
                {command.thisWeek.map((j) => (
                  <JobRow key={`week-${j.id}`} job={j} trail={shootLabel(j.shootDate)} trailColor="var(--accent)" />
                ))}
              </Section>
            )}

            {/* ─── 2. Needs you now — the merged feed ─────────────────── */}
            {(command.needsNow.length > 0 || replies.length > 0 || dueNow.length > 0) && (
              <Section
                title="Needs you now"
                hint="Worked top-down: the most time-sensitive thing first. Don't decide — just start at the top."
              >
                {command.needsNow.map((j) => (
                  <JobRow
                    key={`now-${j.id}`}
                    job={j}
                    trail={j.reason ?? JOB_STAGE_LABEL[j.stage]}
                    trailColor="var(--warn)"
                  />
                ))}
                {replies.map((i) => (
                  <ProspectRow key={`reply-${i.id}`} item={i} href={`/prospects/${i.id}`} tag="Replied" tagColor="var(--good)" />
                ))}
                {dueNow.map((i) => (
                  <ProspectRow
                    key={`due-${i.id}`}
                    item={i}
                    href="/contact"
                    tag={`${i.status === 'due' ? 'Due' : 'Ready'} · ${i.nextLabel}`}
                    tagColor={i.status === 'due' ? 'var(--warn)' : 'var(--accent)'}
                  />
                ))}
              </Section>
            )}

            {/* ─── 3. Money ───────────────────────────────────────────── */}
            {command.money.lines.length > 0 && (
              <Section
                title="Money"
                hint={
                  command.money.outstanding > 0
                    ? `${fmtMoney(command.money.outstanding)} in unpaid work, plus balances in progress.`
                    : 'Balances and deposits in progress.'
                }
              >
                {command.money.lines.map((j) => (
                  <JobRow
                    key={`money-${j.id}`}
                    job={j}
                    trail={j.valuePrice !== null ? fmtMoney(j.valuePrice) : (j.reason ?? '')}
                    trailColor={j.paymentStatus === 'deposit_paid' ? 'var(--warn)' : 'var(--bad)'}
                    subReason={j.reason}
                  />
                ))}
              </Section>
            )}

            {/* ─── 4. To send / to deliver ────────────────────────────── */}
            {(command.toDeliver.length > 0 || closeOuts.length > 0) && (
              <Section
                title="To send & deliver"
                hint="Galleries and prints to hand off, reviews to ask for, and outreach cycles to close out."
                action={closeOuts.length > 0 ? { href: '/contact', label: 'Open Contact →' } : undefined}
              >
                {command.toDeliver.map((j) => (
                  <JobRow key={`deliver-${j.id}`} job={j} trail={j.reason ?? 'Deliver'} trailColor="var(--brand-cyan)" />
                ))}
                {closeOuts.map((i) => (
                  <ProspectRow key={`close-${i.id}`} item={i} href="/contact" tag="No reply" tagColor="var(--text-faint)" />
                ))}
              </Section>
            )}

            {/* ─── All clear ──────────────────────────────────────────── */}
            {everythingClear && (
              <div className="surface-card" style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--text)', marginBottom: '0.85rem' }}>
                  No shoots due, nothing overdue, no replies waiting, nothing owed. The board is
                  current — a good morning to put fresh names in the pipeline.
                </p>
                <Link href="/qualify" className="btn-primary">
                  Qualify new prospects
                </Link>
              </div>
            )}

            {/* ─── Team pulse (super-admin) ───────────────────────────── */}
            {isAdmin && repPulse.length > 0 && (
              <section style={{ marginBottom: '1.75rem' }}>
                <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>
                  Team pulse
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>
                  Last {PULSE_WINDOW_DAYS} days — who&apos;s closing. Revenue counts jobs marked paid.
                </p>
                <div className="surface-card">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {repPulse.slice(0, 5).map((r, i) => (
                      <RepPulseLine key={r.repId} rep={r} rank={i + 1} top={i < 2} />
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ─── 5. Pipeline by workflow ────────────────────────────── */}
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
                        <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)' }}>
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
                            href="/contact"
                            style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--good)', textDecoration: 'none' }}
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
                            <span className="money" style={{ fontSize: '1.05rem', color: 'var(--text)' }}>
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

            <DigestOptIn enabled={profile?.digest_email ?? false} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

// ─── Section shell ────────────────────────────────────────────────────

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.3rem',
        }}
      >
        <div className="eyebrow">{title}</div>
        {action && (
          <Link href={action.href} className="btn-ghost" style={{ padding: '0.2rem 0' }}>
            {action.label}
          </Link>
        )}
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>{hint}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>{children}</div>
    </section>
  );
}

// ─── Job row (command center) ─────────────────────────────────────────

function JobRow({
  job,
  trail,
  trailColor,
  subReason,
}: {
  job: CommandRow;
  trail: string;
  trailColor: string;
  subReason?: string | null;
}) {
  const accent = job.workflowAccent ?? 'var(--text-faint)';
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="surface-tool list-row-responsive"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        padding: '0.7rem 0.9rem',
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: `3px solid ${accent}`,
      }}
    >
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
          {job.clientName ?? 'Client'}
          {job.title ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {job.title}</span> : null}
        </span>
        <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          {job.workflowName ?? JOB_STAGE_LABEL[job.stage]}
          {subReason && trail !== subReason ? ` · ${subReason}` : ''}
        </span>
      </span>
      <span
        className="list-row-trail"
        style={{
          fontSize: '0.66rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: trailColor,
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {trail}
      </span>
    </Link>
  );
}

// ─── Cash strip (super-admin) ─────────────────────────────────────────

function CashStripBar({ cash }: { cash: CashStrip }) {
  const fmtDay = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  };

  return (
    <section
      className="surface-card"
      style={{ marginBottom: '1.75rem', padding: '1rem 1.25rem' }}
    >
      <div
        style={{
          display: 'flex',
          gap: '2rem',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        {/* Collected — solid, confident */}
        <Stat label="Collected this month" value={fmtMoney(cash.collectedThisMonth)} kind="solid" />
        {/* Outstanding — ghosted: same green, outline only */}
        <Stat label="Outstanding" value={fmtMoney(cash.outstanding)} kind="ghost" />
        {/* Out — muted, down-arrow; reads as outflow, not alarm */}
        {cash.outThisMonth > 0 && (
          <Stat label="Out this month" value={`↓ ${fmtMoney(cash.outThisMonth)}`} kind="muted" />
        )}
      </div>

      {(cash.lastIn || cash.nextExpected) && (
        <div
          style={{
            marginTop: '0.8rem',
            paddingTop: '0.7rem',
            borderTop: '1px solid var(--border)',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            display: 'flex',
            gap: '1.25rem',
            flexWrap: 'wrap',
          }}
        >
          {cash.lastIn && (
            <span>
              Last in:{' '}
              <strong style={{ color: 'var(--good)' }}>
                {fmtDay(cash.lastIn.date)} · {fmtMoney(cash.lastIn.amount)}
              </strong>{' '}
              <span style={{ color: 'var(--text-faint)' }}>({cash.lastIn.label})</span>
            </span>
          )}
          {cash.nextExpected && (
            <span>
              Next expected:{' '}
              <strong style={{ color: 'var(--text)' }}>
                {fmtDay(cash.nextExpected.date)} · {fmtMoney(cash.nextExpected.amount)}
              </strong>{' '}
              <span style={{ color: 'var(--text-faint)' }}>({cash.nextExpected.label})</span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, kind }: { label: string; value: string; kind: 'solid' | 'ghost' | 'muted' }) {
  const color =
    kind === 'solid' ? 'var(--good)' : kind === 'muted' ? 'var(--text-mid)' : 'transparent';
  return (
    <div>
      <div
        className="money"
        style={{
          fontSize: '1.5rem',
          lineHeight: 1,
          color,
          // Ghosted: outlined green text, no fill — "same money, not here yet."
          WebkitTextStroke: kind === 'ghost' ? '1px var(--good)' : undefined,
          opacity: kind === 'ghost' ? 0.8 : 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.6rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          fontWeight: 700,
          marginTop: '0.25rem',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Rep pulse line (super-admin) ─────────────────────────────────────

function RepPulseLine({ rep, rank, top }: { rep: RepPulseRow; rank: number; top: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
        <span
          style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            color: top ? 'var(--accent)' : 'var(--text-faint)',
            minWidth: '1.2rem',
          }}
        >
          {rank}
        </span>
        <span
          style={{
            fontSize: '0.86rem',
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {rep.repName}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.85rem', flexShrink: 0 }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{rep.booked} booked</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{rep.signed} signed</span>
        <span className="money" style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
          {fmtMoney(rep.revenue)}
        </span>
      </div>
    </div>
  );
}

// ─── Prospect row (digest) ────────────────────────────────────────────

function ProspectRow({
  item,
  href,
  tag,
  tagColor,
}: {
  item: DigestItem;
  href: string;
  tag: string;
  tagColor: string;
}) {
  return (
    <Link
      href={href}
      className="surface-tool list-row-responsive"
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
        {item.rankScore.toFixed(1)}
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
          {item.contactName}
        </span>
        <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: item.workflowAccent,
              marginRight: '0.4rem',
            }}
          />
          {item.workflowName}
          {item.orgName ? ` · ${item.orgName}` : ''}
        </span>
      </span>
      <span
        className="list-row-trail"
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: tagColor,
          flexShrink: 0,
          textAlign: 'right',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {tag}
      </span>
    </Link>
  );
}
