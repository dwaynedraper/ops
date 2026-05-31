import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import type { ProspectStage } from '@/lib/prospects';
import { PipelineListView, type ClientRow, type ClientWorkflow } from './PipelineListView';

/**
 * Pipeline — the master view of every prospect and client (was /clients;
 * renamed when durable Clients arrived — see CLIENTS-AND-JOBS-PLAN.md).
 *
 * Owner-scoped (D-4): a rep sees their own; a super_admin sees the whole
 * team's. The interactive client carries the workflow toggles, the stage
 * filter, and search.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Pipeline' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  accent: string;
}
interface ProspectRow {
  id: string;
  workflow_key: string;
  contact_name: string;
  org_name: string | null;
  market_area: string | null;
  rank_score: string;
  stage: ProspectStage;
  owner_name: string | null;
  updated_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default async function PipelinePage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/pipeline');

  const role = user.role ?? 'partner';
  const isAdmin = role === 'super_admin';

  const [workflowRows, prospectRows] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
    isAdmin
      ? sql<ProspectRow>`
          SELECT p.id, p.workflow_key, p.contact_name, p.org_name, p.market_area,
                 p.rank_score, p.stage, p.updated_at, u.name AS owner_name
          FROM prospects p
          LEFT JOIN users u ON u.id = p.owner_id
          ORDER BY p.updated_at DESC`
      : sql<ProspectRow>`
          SELECT p.id, p.workflow_key, p.contact_name, p.org_name, p.market_area,
                 p.rank_score, p.stage, p.updated_at, u.name AS owner_name
          FROM prospects p
          LEFT JOIN users u ON u.id = p.owner_id
          WHERE p.owner_id = ${user.id}
          ORDER BY p.updated_at DESC`,
  ]);

  const workflows: ClientWorkflow[] = workflowRows.map((w) => ({
    key: w.workflow_key,
    name: w.name,
    accent: w.accent,
  }));

  const rows: ClientRow[] = prospectRows.map((p) => ({
    id: p.id,
    workflowKey: p.workflow_key,
    contactName: p.contact_name,
    orgName: p.org_name,
    marketArea: p.market_area,
    rankScore: Number(p.rank_score),
    stage: p.stage,
    ownerName: p.owner_name,
    updatedAtLabel: DATE_FMT.format(new Date(p.updated_at)),
  }));

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Pipeline
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
              Everyone in the <em style={{ color: 'var(--accent)' }}>pipeline</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
              Every prospect and client in one place. Toggle a workflow off, solo
              one, filter by stage, or search by name.
            </p>

            <PipelineListView workflows={workflows} rows={rows} isAdmin={isAdmin} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
