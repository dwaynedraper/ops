import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { tutorialIndexFor } from '@/lib/tutorials-content';

/**
 * Tutorials index — one card per workflow, with a Read button on
 * workflows that have a walkthrough and a "Coming soon" state on
 * the rest. v1 ships with real_estate populated; other workflows
 * land as their content is written (D-029, P6).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tutorials' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  accent: string;
}

export default async function TutorialsIndexPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/tutorials');

  const role = user.role ?? 'partner';

  const workflowRows = await sql<WorkflowRow>`
    SELECT workflow_key, name, accent
    FROM workflows
    WHERE active = true
    ORDER BY sort_order, name`;

  const index = tutorialIndexFor(
    workflowRows.map((w) => ({
      workflowKey: w.workflow_key,
      name: w.name,
      accent: w.accent,
    })),
  );

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Tutorials
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
              Learn the <em style={{ color: 'var(--accent)' }}>motion</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '64ch' }}>
              The end-to-end walkthrough for each workflow — Sourcing → Qualify
              → Contact → Email. Start with the workflow you&apos;re working
              today, then come back as you pick up the others.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
              }}
            >
              {index.map((row) => (
                <TutorialCard key={row.workflowKey} row={row} />
              ))}
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

function TutorialCard({
  row,
}: {
  row: ReturnType<typeof tutorialIndexFor>[number];
}) {
  const ready = row.tutorial !== null;
  return (
    <div
      className="surface-tool"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        padding: '1.1rem 1.15rem',
        borderColor: ready ? row.accent + '55' : 'var(--border)',
        opacity: ready ? 1 : 0.65,
      }}
    >
      <div
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: row.accent,
        }}
      >
        {row.name}
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-playfair), serif',
          fontSize: '1.2rem',
          fontWeight: 400,
          margin: 0,
          color: 'var(--text)',
          lineHeight: 1.25,
        }}
      >
        {ready ? row.tutorial!.title : 'Walkthrough coming soon'}
      </h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-mid)', lineHeight: 1.5, margin: 0 }}>
        {ready
          ? row.tutorial!.subtitle
          : `When the ${row.name} workflow has a source list and a documented motion, its walkthrough lands here.`}
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '0.25rem',
        }}
      >
        {ready ? (
          <Link
            href={`/tutorials/${row.tutorial!.slug}`}
            className="btn-primary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
          >
            Read walkthrough →
          </Link>
        ) : (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
            Coming soon
          </span>
        )}
        {ready && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
            ~{row.tutorial!.readMinutes} min
          </span>
        )}
      </div>
    </div>
  );
}
