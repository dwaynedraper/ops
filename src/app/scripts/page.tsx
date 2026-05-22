import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { ContactChannel } from '@/lib/tracking';
import { ScriptsClient, type WorkflowScripts } from './ScriptsClient';

/**
 * Script + handoff-link editor — the outreach config, per workflow
 * (super-admin only). Loads every workflow with its scripts (active and
 * inactive) and its handoff links.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Scripts' };

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
  followup_after_days: number;
  subject: string | null;
  body: string;
  active: boolean;
}
interface LinkRow {
  workflow_key: string;
  link_key: string;
  label: string;
  url: string;
}

export default async function ScriptsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/scripts');

  const role = user.role ?? 'partner';
  if (role !== 'super_admin') redirect('/');

  const [workflowRows, scriptRows, linkRows] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
    sql<ScriptRow>`
      SELECT workflow_key, stage_key, label, channel, followup_after_days,
             subject, body, active
      FROM contact_scripts
      ORDER BY workflow_key, step_order`,
    sql<LinkRow>`
      SELECT workflow_key, link_key, label, url
      FROM handoff_links
      ORDER BY workflow_key, sort_order`,
  ]);

  const scriptsByWf = new Map<string, ScriptRow[]>();
  for (const r of scriptRows) {
    const list = scriptsByWf.get(r.workflow_key) ?? [];
    list.push(r);
    scriptsByWf.set(r.workflow_key, list);
  }
  const linksByWf = new Map<string, LinkRow[]>();
  for (const r of linkRows) {
    const list = linksByWf.get(r.workflow_key) ?? [];
    list.push(r);
    linksByWf.set(r.workflow_key, list);
  }

  const workflows: WorkflowScripts[] = workflowRows.map((w) => ({
    key: w.workflow_key,
    name: w.name,
    accent: w.accent,
    scripts: (scriptsByWf.get(w.workflow_key) ?? []).map((r) => ({
      stageKey: r.stage_key,
      label: r.label,
      channel: r.channel,
      followupAfterDays: r.followup_after_days,
      subject: r.subject ?? '',
      body: r.body,
      active: r.active,
    })),
    links: (linksByWf.get(w.workflow_key) ?? []).map((r) => ({
      linkKey: r.link_key,
      label: r.label,
      url: r.url,
    })),
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
              Pick a workflow, then edit its scripts and handoff links. A script
              pulls a handoff link in with <code>{'{{link_key}}'}</code> — change the
              link here and every script that uses it updates. Nothing changes until
              you publish.
            </p>

            <ScriptsClient workflows={workflows} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
