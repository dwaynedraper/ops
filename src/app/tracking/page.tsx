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
  type HandoffLink,
  type TrackingCard,
} from '@/lib/tracking';
import { TrackingClient, type TrackingWorkflow } from './TrackingClient';

/**
 * Tracking route — the contact cycle, multi-workflow.
 *
 * Server component: loads every active workflow's scripts and every
 * owner-scoped prospect in a cycle stage. Each prospect's cycle is
 * computed against its own workflow's scripts.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tracking' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  accent: string;
}
interface ScriptRow {
  id: string;
  workflow_key: string;
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
  workflow_key: string;
  contact_name: string;
  org_name: string | null;
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
interface LinkRow {
  workflow_key: string;
  link_key: string;
  label: string;
  url: string;
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

  const [workflowRows, scriptRows, linkRows, prospectRows] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
    sql<ScriptRow>`
      SELECT id, workflow_key, stage_key, label, channel, step_order,
             followup_after_days, subject, body
      FROM contact_scripts
      WHERE active = true
      ORDER BY workflow_key, step_order`,
    sql<LinkRow>`
      SELECT workflow_key, link_key, label, url
      FROM handoff_links
      ORDER BY workflow_key, sort_order`,
    isAdmin
      ? sql<ProspectRow>`
          SELECT id, workflow_key, contact_name, org_name, email, phone,
                 market_area, stage, rank_score
          FROM prospects
          WHERE stage = ANY(${[...CYCLE_STAGES]})
          ORDER BY created_at DESC`
      : sql<ProspectRow>`
          SELECT id, workflow_key, contact_name, org_name, email, phone,
                 market_area, stage, rank_score
          FROM prospects
          WHERE stage = ANY(${[...CYCLE_STAGES]}) AND owner_id = ${user.id}
          ORDER BY created_at DESC`,
  ]);

  // Scripts grouped by workflow — each prospect's cycle uses its own set.
  const scriptsByWorkflow: Record<string, ContactScript[]> = {};
  for (const r of scriptRows) {
    const script: ContactScript = {
      id: r.id,
      stageKey: r.stage_key,
      label: r.label,
      channel: r.channel,
      stepOrder: r.step_order,
      followupAfterDays: r.followup_after_days,
      subject: r.subject,
      body: r.body,
    };
    (scriptsByWorkflow[r.workflow_key] ??= []).push(script);
  }

  // Handoff links grouped by workflow — the composer resolves a script's
  // config placeholders (e.g. {{booking_link}}) from its workflow's set.
  const linksByWorkflow: Record<string, HandoffLink[]> = {};
  for (const r of linkRows) {
    (linksByWorkflow[r.workflow_key] ??= []).push({
      linkKey: r.link_key,
      label: r.label,
      url: r.url,
    });
  }

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
    const scripts = scriptsByWorkflow[p.workflow_key] ?? [];
    const labelByStep = new Map(scripts.map((s) => [s.stageKey, s.label]));
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
      stepLabel: labelByStep.get(c.step_key) ?? c.step_key,
      channel: c.channel,
      sentAtLabel: DATE_FMT.format(new Date(c.sent_at)),
      responseReceived: c.response_received,
    }));
    return {
      prospect: {
        id: p.id,
        workflowKey: p.workflow_key,
        contactName: p.contact_name,
        orgName: p.org_name,
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

  cards.sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    if (r !== 0) return r;
    if (a.status === 'waiting' && b.status === 'waiting') {
      const d = (a.dueInDays ?? 0) - (b.dueInDays ?? 0);
      if (d !== 0) return d;
    }
    return b.prospect.rankScore - a.prospect.rankScore;
  });

  const workflows: TrackingWorkflow[] = workflowRows.map((w) => ({
    key: w.workflow_key,
    name: w.name,
    accent: w.accent,
  }));

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
              Every prospect in a contact cycle, across all workflows, in order of
              who needs you next. Each one runs its own workflow&apos;s scripts.
            </p>

            <TrackingClient
              cards={cards}
              workflows={workflows}
              scriptsByWorkflow={scriptsByWorkflow}
              linksByWorkflow={linksByWorkflow}
              repName={repName}
            />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
