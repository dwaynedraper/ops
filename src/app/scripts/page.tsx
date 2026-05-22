import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { ContactChannel } from '@/lib/tracking';
import { ScriptsClient, type ScriptInit } from './ScriptsClient';

/**
 * Contact-script editor — the outreach scripts (super-admin only).
 *
 * Loads every script (active and inactive) in cycle order and hands them
 * to the editor.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Scripts' };

interface ScriptRow {
  stage_key: string;
  label: string;
  channel: ContactChannel;
  followup_after_days: number;
  subject: string | null;
  body: string;
  active: boolean;
}

export default async function ScriptsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/scripts');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const rows = await sql<ScriptRow>`
    SELECT stage_key, label, channel, followup_after_days, subject, body, active
    FROM contact_scripts
    ORDER BY step_order`;

  const scripts: ScriptInit[] = rows.map((r) => ({
    stageKey: r.stage_key,
    label: r.label,
    channel: r.channel,
    followupAfterDays: r.followup_after_days,
    subject: r.subject ?? '',
    body: r.body,
    active: r.active,
  }));

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Scripts
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
              The <em style={{ color: 'var(--accent)' }}>outreach</em> cycle.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '60ch' }}>
              The scripts reps copy on the tracking page, in cycle order. Each
              follow-up interval sets when the next touch comes due — set it to 0
              to end the cycle. Use <code>{'{{placeholder}}'}</code> slots for the
              parts a rep fills in. Nothing changes until you publish.
            </p>

            <ScriptsClient scripts={scripts} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
