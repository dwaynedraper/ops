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
  type ContactLog,
  type CycleContact,
  type TrackingCard,
} from '@/lib/tracking';
import { TrackingClient } from './TrackingClient';

/**
 * Tracking route — the contact cycle.
 *
 * Server component: loads the contact scripts and every owner-scoped
 * prospect currently in a cycle stage (qualified / contacting / responded)
 * with its logged touches, then computes each one's cycle state. The
 * interactive board, script-fill composer, and stage actions live in the
 * client component. proxy.ts already blocks anonymous access.
 *
 * Visibility is owner-scoped (D-019): a partner sees their own prospects,
 * a super_admin sees everyone's.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tracking' };

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
interface ProspectRow {
  id: string;
  agent_name: string;
  agency: string | null;
  email: string | null;
  phone: string | null;
  market_area: string | null;
  stage: ProspectStage;
  rank_score: string;
}
interface ContactRow {
  id: string;
  prospect_id: string;
  step_key: string;
  channel: string;
  sent_at: Date;
  response_received: boolean;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const CYCLE_STAGES = ['qualified', 'contacting', 'responded'] as const;

export default async function TrackingPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/tracking');

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';
  const repName = user.displayName ?? user.name ?? '';

  const [scriptRows, prospectRows] = await Promise.all([
    sql<ScriptRow>`
      SELECT id, stage_key, label, channel, step_order, followup_after_days,
             subject, body
      FROM contact_scripts
      WHERE active = true
      ORDER BY step_order`,
    isAdmin
      ? sql<ProspectRow>`
          SELECT id, agent_name, agency, email, phone, market_area, stage, rank_score
          FROM prospects
          WHERE stage = ANY(${[...CYCLE_STAGES]})
          ORDER BY created_at DESC`
      : sql<ProspectRow>`
          SELECT id, agent_name, agency, email, phone, market_area, stage, rank_score
          FROM prospects
          WHERE stage = ANY(${[...CYCLE_STAGES]}) AND owner_id = ${user.id}
          ORDER BY created_at DESC`,
  ]);

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
  const scriptLabel = new Map(scripts.map((s) => [s.stageKey, s.label]));

  // Pull every touch for the prospects on the board in one query.
  const prospectIds = prospectRows.map((p) => p.id);
  const contactRows =
    prospectIds.length > 0
      ? await sql<ContactRow>`
          SELECT id, prospect_id, step_key, channel, sent_at, response_received
          FROM prospect_contacts
          WHERE prospect_id = ANY(${prospectIds})
          ORDER BY sent_at ASC`
      : [];

  const contactsByProspect = new Map<string, ContactRow[]>();
  for (const c of contactRows) {
    const list = contactsByProspect.get(c.prospect_id) ?? [];
    list.push(c);
    contactsByProspect.set(c.prospect_id, list);
  }

  const now = new Date();
  const cards: TrackingCard[] = prospectRows.map((p) => {
    const rows = contactsByProspect.get(p.id) ?? [];
    const cycleContacts: CycleContact[] = rows.map((c) => ({
      stepKey: c.step_key,
      sentAt: new Date(c.sent_at),
      responseReceived: c.response_received,
    }));
    const cycle = computeCycle(scripts, cycleContacts, p.stage, now);
    const contacts: ContactLog[] = rows.map((c) => ({
      id: c.id,
      stepKey: c.step_key,
      stepLabel: scriptLabel.get(c.step_key) ?? c.step_key,
      channel: c.channel,
      sentAtLabel: DATE_FMT.format(new Date(c.sent_at)),
      responseReceived: c.response_received,
    }));
    return {
      prospect: {
        id: p.id,
        agentName: p.agent_name,
        agency: p.agency,
        email: p.email,
        phone: p.phone,
        marketArea: p.market_area,
        stage: p.stage,
        rankScore: Number(p.rank_score),
      },
      contacts,
      status: cycle.status,
      nextStepKey: cycle.nextScript?.stageKey ?? null,
      dueInDays: cycle.dueInDays,
    };
  });

  // Most urgent first; within 'waiting', soonest due; then higher score.
  cards.sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    if (r !== 0) return r;
    if (a.status === 'waiting' && b.status === 'waiting') {
      const d = (a.dueInDays ?? 0) - (b.dueInDays ?? 0);
      if (d !== 0) return d;
    }
    return b.prospect.rankScore - a.prospect.rankScore;
  });

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Tracking
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
              Work the <em style={{ color: 'var(--accent)' }}>cycle</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '56ch' }}>
              Every qualified prospect, in order of who needs you next. Fill the
              script, copy it, send it, log it. The follow-up clock is the app&apos;s
              job — yours is the message.
            </p>

            <TrackingClient cards={cards} scripts={scripts} repName={repName} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
