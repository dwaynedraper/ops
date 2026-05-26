'use server';

/**
 * Script + handoff-link editor server action.
 *
 * `publishScripts` commits one workflow's outreach scripts and its
 * handoff links together (PHASE-D-PLAN §8). Super-admin only (D-014); a
 * local draft until this runs (D-012).
 *
 * Scripts are upserted by (workflow_key, stage_key); a logged contact
 * snapshots its message, so an edit never rewrites history. Handoff
 * links have no dependents, so the workflow's link set is replaced
 * wholesale — link keys can change freely.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getPool } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import type { ContactChannel } from '@/lib/tracking';

export interface ScriptInput {
  /** Empty for a script added in this draft — the server assigns a key. */
  stageKey: string;
  label: string;
  channel: ContactChannel;
  followupAfterDays: number;
  subject: string;
  body: string;
  active: boolean;
}

export interface LinkInput {
  linkKey: string;
  label: string;
  url: string;
}

export interface PublishScriptsResult {
  ok: boolean;
  error?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function publishScripts(input: {
  workflowKey: string;
  scripts: ScriptInput[];
  links: LinkInput[];
}): Promise<PublishScriptsResult> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return { ok: false, error: 'Only a super-admin can change contact scripts.' };
  }

  if (input.scripts.length === 0) {
    return { ok: false, error: 'Keep at least one contact script.' };
  }

  // ─── Resolve scripts ────────────────────────────────────────────────
  const usedStage = new Set<string>();
  const scripts: {
    stageKey: string;
    label: string;
    channel: ContactChannel;
    stepOrder: number;
    followupAfterDays: number;
    subject: string | null;
    body: string;
    active: boolean;
  }[] = [];
  let order = 10;

  for (const s of input.scripts) {
    const label = s.label.trim();
    if (!label) return { ok: false, error: 'Every script needs a label.' };
    const body = s.body.trim();
    if (!body) return { ok: false, error: `“${label}” needs a message body.` };
    if (s.channel !== 'email' && s.channel !== 'dm' && s.channel !== 'call') {
      return { ok: false, error: `“${label}” has an invalid channel.` };
    }
    if (!Number.isInteger(s.followupAfterDays) || s.followupAfterDays < 0) {
      return { ok: false, error: `“${label}” needs a whole follow-up-days value of 0 or more.` };
    }
    let key = s.stageKey.trim();
    if (!key) {
      const base = slugify(label) || 'step';
      key = base;
      let n = 2;
      while (usedStage.has(key)) key = `${base}_${n++}`;
    }
    if (usedStage.has(key)) return { ok: false, error: `Duplicate script key “${key}”.` };
    usedStage.add(key);
    scripts.push({
      stageKey: key,
      label,
      channel: s.channel,
      stepOrder: order,
      followupAfterDays: s.followupAfterDays,
      subject: s.subject.trim() || null,
      body,
      active: s.active,
    });
    order += 10;
  }

  // ─── Resolve handoff links ──────────────────────────────────────────
  const usedLink = new Set<string>();
  const links: { linkKey: string; label: string; url: string; sortOrder: number }[] = [];
  let linkOrder = 10;

  for (const l of input.links) {
    const label = l.label.trim();
    const url = l.url.trim();
    const key = slugify(l.linkKey);
    if (!key) return { ok: false, error: 'Every handoff link needs a key.' };
    if (!label) return { ok: false, error: `Handoff link “${key}” needs a label.` };
    if (!url) return { ok: false, error: `Handoff link “${key}” needs a URL.` };
    if (usedLink.has(key)) return { ok: false, error: `Duplicate handoff-link key “${key}”.` };
    usedLink.add(key);
    links.push({ linkKey: key, label, url, sortOrder: linkOrder });
    linkOrder += 10;
  }

  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');

    const wf = await dbc.query<{ workflow_key: string }>(
      'SELECT workflow_key FROM workflows WHERE workflow_key = $1',
      [input.workflowKey],
    );
    if (wf.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return { ok: false, error: 'That workflow no longer exists.' };
    }

    for (const s of scripts) {
      await dbc.query(
        `INSERT INTO contact_scripts
           (workflow_key, stage_key, label, channel, step_order, followup_after_days, subject, body, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (workflow_key, stage_key) DO UPDATE SET
           label=EXCLUDED.label, channel=EXCLUDED.channel, step_order=EXCLUDED.step_order,
           followup_after_days=EXCLUDED.followup_after_days, subject=EXCLUDED.subject,
           body=EXCLUDED.body, active=EXCLUDED.active`,
        [
          input.workflowKey, s.stageKey, s.label, s.channel, s.stepOrder,
          s.followupAfterDays, s.subject, s.body, s.active,
        ],
      );
    }

    // Links have no dependents — replace the workflow's set wholesale.
    await dbc.query('DELETE FROM handoff_links WHERE workflow_key = $1', [input.workflowKey]);
    for (const l of links) {
      await dbc.query(
        `INSERT INTO handoff_links (workflow_key, link_key, label, url, sort_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [input.workflowKey, l.linkKey, l.label, l.url, l.sortOrder],
      );
    }

    await dbc.query('COMMIT');
    revalidatePath('/scripts');
    return { ok: true };
  } catch (err) {
    await dbc.query('ROLLBACK');
    return {
      ok: false,
      error: actionError(err, 'Could not publish the scripts.'),
    };
  } finally {
    dbc.release();
  }
}
