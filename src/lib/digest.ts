/**
 * The morning digest — one rep's brief, computed from the contact cycle.
 *
 * Shared by the Dashboard at `/` (renders it as panels — F12 folded the
 * old `/today` route in via D-063) and the digest cron route (emails
 * it). Owner-scoped: every item belongs to the given rep. Built on the
 * same pure cycle logic as Contact, so the digest, the Dashboard, and
 * the morning email always agree.
 */

import { sql } from '@/lib/db';
import {
  computeCycle,
  statusRank,
  type ContactScript,
  type ContactChannel,
  type CycleContact,
  type TrackingStatus,
} from '@/lib/tracking';
import type { ProspectStage } from '@/lib/prospects';

export interface DigestItem {
  id: string;
  workflowKey: string;
  workflowName: string;
  workflowAccent: string;
  contactName: string;
  orgName: string | null;
  rankScore: number;
  status: TrackingStatus;
  nextLabel: string;
  dueInDays: number | null;
}

export interface DigestData {
  /** Prospects who replied — the rep needs to take it from here. */
  replies: DigestItem[];
  /** Follow-ups due now (due) or first touches ready to send (ready). */
  dueNow: DigestItem[];
  /** Cycles that ran out with no reply — ready to close. */
  closeOuts: DigestItem[];
  /** Mid-window prospects — not actionable today, shown ambiently. */
  waiting: DigestItem[];
  /** Whole days until the soonest waiting prospect comes due, or null. */
  soonestWait: number | null;
  /** Count across the three action lists. */
  total: number;
  /** True when nothing needs the rep today. */
  allClear: boolean;
}

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

/** Compute one rep's digest, as of `now` (injected for testability). */
export async function computeDigest(
  userId: string,
  now: Date = new Date(),
): Promise<DigestData> {
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
      WHERE owner_id = ${userId} AND stage = ANY(${[...CYCLE_STAGES]})`,
  ]);

  const wfByKey = new Map(workflowRows.map((w) => [w.workflow_key, w]));

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

  const items: DigestItem[] = cycleRows.map((p) => {
    const cycle = computeCycle(
      scriptsByWf[p.workflow_key] ?? [],
      contactsByProspect.get(p.id) ?? [],
      p.stage,
      now,
    );
    const wf = wfByKey.get(p.workflow_key);
    return {
      id: p.id,
      workflowKey: p.workflow_key,
      workflowName: wf?.name ?? p.workflow_key,
      workflowAccent: wf?.accent ?? '#94a3b8',
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

  const waits = waiting
    .map((w) => w.dueInDays)
    .filter((d): d is number => d !== null);
  const soonestWait = waits.length > 0 ? Math.min(...waits) : null;

  const total = replies.length + dueNow.length + closeOuts.length;

  return {
    replies,
    dueNow,
    closeOuts,
    waiting,
    soonestWait,
    total,
    allClear: total === 0,
  };
}
