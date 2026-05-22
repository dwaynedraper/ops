/**
 * Contact-cycle logic + shared types — the pure core of the tracking page.
 *
 * No database, no server imports. Pulled into the client bundle (the
 * composer fills placeholders and previews live) and re-used on the
 * server (the route computes each prospect's cycle state). Keeping it
 * pure means client and server read the cycle the same way.
 *
 * The contact cycle is the ordered set of contact_scripts (first touch →
 * follow-ups → final). A prospect advances one step per logged touch.
 * `followup_after_days` on the step just sent decides when the next one
 * is due; a step with 0 ends the cycle (see schema.sql · contact_scripts).
 */

import type { ProspectStage } from './prospects';

export type ContactChannel = 'email' | 'dm' | 'call';

export interface ContactScript {
  id: string;
  stageKey: string;
  label: string;
  channel: ContactChannel;
  stepOrder: number;
  followupAfterDays: number;
  subject: string | null;
  body: string;
}

/**
 * A per-workflow handoff link. Resolves a config placeholder — a
 * {{link_key}} token in a script — to a live URL. The rep never types
 * these; the composer fills them automatically (see schema.sql ·
 * handoff_links, PHASE-D-PLAN §8).
 */
export interface HandoffLink {
  linkKey: string;
  label: string;
  url: string;
}

/** A logged touch, as the tracking page renders it (serializable). */
export interface ContactLog {
  id: string;
  stepKey: string;
  stepLabel: string;
  channel: string;
  sentAtLabel: string;
  responseReceived: boolean;
}

/**
 * Where a prospect sits in the contact cycle:
 *   ready      — qualified, no touch sent yet; first touch is up
 *   due        — a follow-up is due now (last touch past its window)
 *   waiting    — last touch still inside its follow-up window
 *   replied    — the agent responded; the rep takes it from here
 *   cycle_done — the final touch was sent, no reply, nothing left here
 */
export type TrackingStatus = 'ready' | 'due' | 'waiting' | 'replied' | 'cycle_done';

export interface CycleState {
  status: TrackingStatus;
  /** The script to send next, or null when the cycle is exhausted. */
  nextScript: ContactScript | null;
  /** For 'waiting' only: whole days until the next touch is due. */
  dueInDays: number | null;
}

/** The minimal contact shape computeCycle needs. */
export interface CycleContact {
  stepKey: string;
  sentAt: Date;
  responseReceived: boolean;
}

/** A prospect plus its cycle state, as the tracking client receives it. */
export interface TrackingCard {
  prospect: {
    id: string;
    workflowKey: string;
    contactName: string;
    orgName: string | null;
    email: string | null;
    phone: string | null;
    marketArea: string | null;
    stage: ProspectStage;
    rankScore: number;
  };
  contacts: ContactLog[];
  status: TrackingStatus;
  /** stage_key of the script to send next, or null if the cycle is done. */
  nextStepKey: string | null;
  dueInDays: number | null;
}

const MS_PER_DAY = 86_400_000;

// ─── Placeholder templating ───────────────────────────────────────────

// Matches {{ token }} — letters, digits, underscores.
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Every distinct {{placeholder}} across the given texts, in first-seen order. */
export function extractPlaceholders(...texts: (string | null | undefined)[]): string[] {
  const seen: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(TOKEN_RE)) {
      const key = match[1];
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

/**
 * Split placeholders into the two kinds (PHASE-D-PLAN §8). A token whose
 * name matches a handoff link's key is a *config* placeholder — resolved
 * automatically to the link's URL, never shown as an input. Everything
 * else is a *human* placeholder the rep fills at compose time.
 */
export function splitPlaceholders(
  placeholders: string[],
  links: HandoffLink[],
): { human: string[]; config: HandoffLink[] } {
  const byKey = new Map(links.map((l) => [l.linkKey, l]));
  const human: string[] = [];
  const config: HandoffLink[] = [];
  for (const key of placeholders) {
    const link = byKey.get(key);
    if (link) config.push(link);
    else human.push(key);
  }
  return { human, config };
}

/**
 * Fill {{placeholders}} from `values`. An unfilled token is left visible
 * as {{token}} so the rep can see what's still missing in the preview.
 */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN_RE, (whole, key: string) => {
    const value = values[key];
    return value !== undefined && value.trim() !== '' ? value : whole;
  });
}

// ─── Cycle progression ────────────────────────────────────────────────

/** The next script to send: the lowest-ordered one not yet logged. */
export function nextScript(
  scripts: ContactScript[],
  doneStepKeys: Set<string>,
): ContactScript | null {
  const ordered = [...scripts].sort((a, b) => a.stepOrder - b.stepOrder);
  for (const script of ordered) {
    if (!doneStepKeys.has(script.stageKey)) return script;
  }
  return null;
}

/**
 * Resolve a prospect's place in the contact cycle from its stage and the
 * touches logged so far. Pure: pass `now` so the result is deterministic.
 */
export function computeCycle(
  scripts: ContactScript[],
  contacts: CycleContact[],
  stage: ProspectStage,
  now: Date,
): CycleState {
  // A reply ends the rep's cycle work — the client page takes over.
  if (stage === 'responded') {
    return { status: 'replied', nextScript: null, dueInDays: null };
  }

  const done = new Set(contacts.map((c) => c.stepKey));
  const upcoming = nextScript(scripts, done);

  // Nothing sent yet — the first touch is ready to go.
  if (contacts.length === 0) {
    return { status: 'ready', nextScript: upcoming, dueInDays: null };
  }

  const latest = contacts.reduce((a, b) => (b.sentAt > a.sentAt ? b : a));
  const latestScript = scripts.find((s) => s.stageKey === latest.stepKey) ?? null;
  const followupAfter = latestScript?.followupAfterDays ?? 0;

  // Final touch sent (no more scripts, or a 0-day step) — cycle exhausted.
  if (upcoming === null || followupAfter === 0) {
    return { status: 'cycle_done', nextScript: null, dueInDays: null };
  }

  const daysSince = (now.getTime() - latest.sentAt.getTime()) / MS_PER_DAY;
  if (daysSince >= followupAfter) {
    return { status: 'due', nextScript: upcoming, dueInDays: null };
  }
  return {
    status: 'waiting',
    nextScript: upcoming,
    dueInDays: Math.max(1, Math.ceil(followupAfter - daysSince)),
  };
}

/** Sort weight for the prospect list — most urgent first. */
export function statusRank(status: TrackingStatus): number {
  switch (status) {
    case 'due':
      return 0;
    case 'ready':
      return 1;
    case 'waiting':
      return 2;
    case 'replied':
      return 3;
    case 'cycle_done':
      return 4;
  }
}
