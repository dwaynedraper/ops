'use server';

/**
 * Contact-script editor server action.
 *
 * `publishScripts` commits the outreach scripts the tracking page hands
 * reps. Super-admin only (D-014); a local draft until this runs (D-012).
 *
 * Scripts are upserted by `stage_key` — a logged contact snapshots the
 * message it sent, so editing a script never rewrites history. Step
 * order is derived from the list order. Retiring a script is done with
 * its `active` flag.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getPool } from '@/lib/db';
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

export interface PublishScriptsResult {
  ok: boolean;
  error?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function publishScripts(input: {
  scripts: ScriptInput[];
}): Promise<PublishScriptsResult> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return { ok: false, error: 'Only a super-admin can change contact scripts.' };
  }

  if (input.scripts.length === 0) {
    return { ok: false, error: 'Keep at least one contact script.' };
  }

  const used = new Set<string>();
  const resolved: {
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
      return {
        ok: false,
        error: `“${label}” needs a whole follow-up-days value of 0 or more.`,
      };
    }

    let key = s.stageKey.trim();
    if (!key) {
      const base = slugify(label) || 'step';
      key = base;
      let n = 2;
      while (used.has(key)) key = `${base}_${n++}`;
    }
    if (used.has(key)) return { ok: false, error: `Duplicate script key “${key}”.` };
    used.add(key);

    resolved.push({
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

  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');

    for (const s of resolved) {
      await dbc.query(
        `INSERT INTO contact_scripts
           (stage_key, label, channel, step_order, followup_after_days, subject, body, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (stage_key) DO UPDATE SET
           label=EXCLUDED.label, channel=EXCLUDED.channel, step_order=EXCLUDED.step_order,
           followup_after_days=EXCLUDED.followup_after_days, subject=EXCLUDED.subject,
           body=EXCLUDED.body, active=EXCLUDED.active`,
        [s.stageKey, s.label, s.channel, s.stepOrder, s.followupAfterDays, s.subject, s.body, s.active],
      );
    }

    await dbc.query('COMMIT');
    revalidatePath('/scripts');
    return { ok: true };
  } catch (err) {
    await dbc.query('ROLLBACK');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not publish the scripts.',
    };
  } finally {
    dbc.release();
  }
}
