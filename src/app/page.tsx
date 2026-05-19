import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';

/**
 * Dashboard. Now session-aware: reads the role from auth() and passes it
 * to the sidebar, greets the signed-in user by name. Real quote / pipeline
 * data lands in Week 2-3; this is the working layout.
 */
export default async function Home() {
  const session = await auth();
  // proxy.ts guarantees we have a session here, but be defensive.
  const user = session?.user;
  const role = user?.role ?? 'partner';
  const firstName = (user?.displayName ?? user?.name ?? user?.email ?? '')
    .toString()
    .split(/[\s@]/)[0];

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Dashboard
            </div>
            <h1
              style={{
                fontSize: 'clamp(1.75rem, 3vw, 2.5rem)',
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                marginBottom: '0.5rem',
              }}
            >
              Good morning, <em style={{ color: 'var(--accent)' }}>{firstName || 'partner'}</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '2rem', maxWidth: '52ch' }}>
              The operating layer for Sharp Sighted Studio. Build a quote, track a
              prospect, run the day. This is the working surface — and the only
              place where the math, the inventory, and the partner roster live in
              real time.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '1rem',
                marginBottom: '2rem',
              }}
            >
              <StatTile label="Open quotes" value="—" hint="Week 3 brings this online" />
              <StatTile label="Quotes this month" value="—" hint="Week 3 brings this online" />
              <StatTile label="Next shoot day" value="Wed 5/20" hint="Scheduled" tone="accent" />
              <StatTile label="Build progress" value="Day 5 of 30" hint="Auth live" tone="accent" />
            </div>

            <div className="surface-tool" style={{ marginBottom: '1.5rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
                Build status · 30-day MVP
              </div>
              <h2
                style={{
                  fontFamily: 'var(--font-playfair), serif',
                  fontSize: '1.4rem',
                  fontWeight: 400,
                  marginBottom: '1rem',
                }}
              >
                <em style={{ color: 'var(--accent)' }}>Week 1</em> — foundation
              </h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <Step done>Scaffold the /ops Next.js 16 project</Step>
                <Step done>Port design tokens and brand chrome from /studio</Step>
                <Step done>Stand up Neon Postgres + auth schema</Step>
                <Step done>Wire Auth.js v5 with Resend magic links</Step>
                <Step>Deploy to Vercel, point ops.sharpsighted.studio DNS</Step>
                <Step>Verify magic-link sign-in end-to-end on production</Step>
              </ul>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
              }}
            >
              <ModuleCard
                title="Pricing Calculator"
                eyebrow="Module · v1"
                status="Building · Week 2"
                copy="Pick a package. Layer add-ons. See the working price update live. Save the quote, send the PDF."
              />
              <ModuleCard
                title="Quote Library"
                eyebrow="Module · v1"
                status="Week 3"
                copy="Every quote you've ever built. Search by client, by package, by date. Duplicate a past quote in two clicks."
              />
              <ModuleCard
                title="Prospect Tracker"
                eyebrow="Module · v2"
                status="Post-MVP"
                copy="The Prospect Playbook as software. Zillow source → outreach template → discovery → close. Lives next door."
              />
              <ModuleCard
                title="Daily Queue"
                eyebrow="Module · v2"
                status="Post-MVP"
                copy="What to do first today, ranked by impact. Day-shape aware (W/Th shoot days, Fri–Tue W-2). With timers."
              />
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <div className="surface-card">
      <div
        style={{
          fontSize: '0.65rem',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--text-mid)',
          fontWeight: 600,
          marginBottom: '0.5rem',
        }}
      >
        {label}
      </div>
      <div
        className="money"
        style={{
          fontSize: '1.65rem',
          color: tone === 'accent' ? 'var(--accent)' : 'var(--text)',
          lineHeight: 1.1,
          marginBottom: hint ? '0.35rem' : 0,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{hint}</div>
      )}
    </div>
  );
}

function Step({ children, done = false }: { children: React.ReactNode; done?: boolean }) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        fontSize: '0.85rem',
        color: done ? 'var(--text-mid)' : 'var(--text)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: `1.5px solid ${done ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: done ? 'var(--accent)' : 'transparent',
          flexShrink: 0,
        }}
      />
      <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{children}</span>
    </li>
  );
}

function ModuleCard({
  title,
  eyebrow,
  status,
  copy,
}: {
  title: string;
  eyebrow: string;
  status: string;
  copy: string;
}) {
  return (
    <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div className="eyebrow" style={{ marginBottom: 0 }}>
        {eyebrow}
      </div>
      <h3
        style={{
          fontFamily: 'var(--font-playfair), serif',
          fontSize: '1.25rem',
          fontWeight: 400,
          letterSpacing: '-0.005em',
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)', lineHeight: 1.5 }}>{copy}</p>
      <div
        style={{
          fontSize: '0.65rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          fontWeight: 700,
          marginTop: 'auto',
          paddingTop: '0.5rem',
        }}
      >
        {status}
      </div>
    </div>
  );
}
