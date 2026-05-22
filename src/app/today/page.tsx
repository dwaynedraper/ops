import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { ProspectStage } from '@/lib/prospects';
import {
  computeCycle,
  statusRank,
  type ContactScript,
  type ContactChannel,
  type CycleContact,
  type TrackingStatus,
} from '@/lib/tracking';

/**
 * Today — the morning digest, per rep.
 *
 * Owner-scoped (D-019): one scannable brief of what needs the signed-in
 * rep today, drawn from the same contact-cycle machinery as Tracking and
 * the Dashboard. Three action lists in priority order — replies waiting,
 * follow-ups due, cycles to close — plus an ambient line for what's still
 * mid-window. The standalone page the dead /today nav always promised.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  accent: string;
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

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

interface DigestItem {
  id: string;
  workflowKey: string;
  contactName: string;
  orgName: string | null;
  rankScore: number;
  status: TrackingStatus;
  nextLabel: string;
  dueInDays: number | null;
}

export default async function TodayPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/today');

  const role = user.role ?? 'partner';
  const firstName = (user.displayName ?? user.name ?? user.email ?? '')
    .toString()
    .split(/[\s@]/)[0];

  const [workflowRows, scriptRows, cycleRows] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
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

  // Scripts grouped by workflow — each prospect's cycle uses its own set.
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
  const items: DigestItem[] = cycleRows.map((p) => {
    const cycle = computeCycle(
      scriptsByWf[p.workflow_key] ?? [],
      contactsByProspect.get(p.id) ?? [],
      p.stage,
      now,
    );
    return {
      id: p.id,
      workflowKey: p.workflow_key,
      contactName: p.contact_name,
      orgName: p.org_name,
      rankScore: Number(p.rank_score),
      status: cycle.status,
      nextLabel: cycle.nextScript?.label ?? 'Next touch',
      dueInDays: cycle.dueInDays,
    };
  });

  const byUrgency = (a: DigestItem, b: DigestItem) => {
    const r = statusRank(a.status) - statusRank(b.status);
    return r !== 0 ? r : b.rankScore - a.rankScore;
  };

  const replies = items.filter((i) => i.status === 'replied').sort(byUrgency);
  const dueNow = items
    .filter((i) => i.status === 'due' || i.status === 'ready')
    .sort(byUrgency);
  const closeOuts = items.filter((i) => i.status === 'cycle_done').sort(byUrgency);
  const waiting = items.filter((i) => i.status === 'waiting');
  const soonestWait = waiting.reduce(
    (m, w) => Math.min(m, w.dueInDays ?? Infinity),
    Infinity,
  );

  const wfByKey = new Map(workflowRows.map((w) => [w.workflow_key, w]));
  const allClear = replies.length === 0 && dueNow.length === 0 && closeOuts.length === 0;

  // The one-line summary across the three action lists.
  const summaryParts: string[] = [];
  if (replies.length > 0) {
    summaryParts.push(`${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} to act on`);
  }
  if (dueNow.length > 0) {
    summaryParts.push(`${dueNow.length} follow-up${dueNow.length === 1 ? '' : 's'} due`);
  }
  if (closeOuts.length > 0) {
    summaryParts.push(`${closeOuts.length} to close out`);
  }

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
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
            <p style={{ color: 'var(--text-mid)', marginBottom: '2rem', maxWidth: '52ch' }}>
              {allClear
                ? 'Nothing is waiting on you this morning — a clean slate.'
                : `Your morning brief: ${summaryParts.join(' · ')}.`}
            </p>

            {/* ─── Replies to act on ─────────────────────────────────── */}
            {replies.length > 0 && (
              <Section
                title="Replies waiting on you"
                hint="Someone wrote back — take it to their client page and quote the work."
              >
                {replies.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href={`/prospects/${i.id}`}
                    accent={wfByKey.get(i.workflowKey)?.accent}
                    workflowName={wfByKey.get(i.workflowKey)?.name ?? i.workflowKey}
                    tag="Replied"
                    tagColor="var(--good)"
                  />
                ))}
              </Section>
            )}

            {/* ─── Follow-ups due ────────────────────────────────────── */}
            {dueNow.length > 0 && (
              <Section
                title="Follow-ups due today"
                hint="Work these top-down — highest score first. The composer is in Tracking."
                action={{ href: '/tracking', label: 'Open Tracking →' }}
              >
                {dueNow.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href="/tracking"
                    accent={wfByKey.get(i.workflowKey)?.accent}
                    workflowName={wfByKey.get(i.workflowKey)?.name ?? i.workflowKey}
                    tag={`${i.status === 'due' ? 'Due' : 'Ready'} · ${i.nextLabel}`}
                    tagColor={i.status === 'due' ? 'var(--warn)' : 'var(--accent)'}
                  />
                ))}
              </Section>
            )}

            {/* ─── Close-outs ────────────────────────────────────────── */}
            {closeOuts.length > 0 && (
              <Section
                title="Ready to close out"
                hint="The full cycle ran with no reply. Close them so the board stays honest."
                action={{ href: '/tracking', label: 'Open Tracking →' }}
              >
                {closeOuts.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href="/tracking"
                    accent={wfByKey.get(i.workflowKey)?.accent}
                    workflowName={wfByKey.get(i.workflowKey)?.name ?? i.workflowKey}
                    tag="No reply"
                    tagColor="var(--text-faint)"
                  />
                ))}
              </Section>
            )}

            {/* ─── All clear ─────────────────────────────────────────── */}
            {allClear && (
              <div className="surface-card" style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--text)', marginBottom: '0.85rem' }}>
                  No replies, no follow-ups due, nothing to close. The cycle is current.
                  A good morning to put fresh names in the pipeline.
                </p>
                <Link href="/prospects" className="btn-primary">
                  Research new prospects
                </Link>
              </div>
            )}

            {/* ─── In motion (ambient) ───────────────────────────────── */}
            {waiting.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>
                {waiting.length} prospect{waiting.length === 1 ? ' is' : 's are'} mid-cycle,
                inside the follow-up window
                {Number.isFinite(soonestWait)
                  ? ` — the next comes due in ${soonestWait} day${soonestWait === 1 ? '' : 's'}.`
                  : '.'}
              </p>
            )}
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────

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
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>
        {hint}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>{children}</div>
    </section>
  );
}

// ─── One prospect row ─────────────────────────────────────────────────

function DigestRow({
  item,
  href,
  accent,
  workflowName,
  tag,
  tagColor,
}: {
  item: DigestItem;
  href: string;
  accent: string | undefined;
  workflowName: string;
  tag: string;
  tagColor: string;
}) {
  return (
    <Link
      href={href}
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
              background: accent ?? 'var(--text-faint)',
              marginRight: '0.4rem',
            }}
          />
          {workflowName}
          {item.orgName ? ` · ${item.orgName}` : ''}
        </span>
      </span>
      <span
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: tagColor,
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {tag}
      </span>
    </Link>
  );
}
