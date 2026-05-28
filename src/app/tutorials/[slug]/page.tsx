import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { HelpBlockList } from '@/components/HelpBox';
import { getTutorial } from '@/lib/tutorials-content';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = getTutorial(slug);
  return { title: t ? t.title : 'Tutorial' };
}

export default async function TutorialDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tutorial = getTutorial(slug);
  if (!tutorial) notFound();

  const session = await auth();
  const user = session?.user;
  if (!user) redirect(`/signin?callbackUrl=/tutorials/${slug}`);

  const role = user.role ?? 'partner';

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {/* ── Back link + meta ─────────────────────────────────── */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                fontSize: '0.74rem',
                color: 'var(--text-faint)',
                marginBottom: '0.6rem',
              }}
            >
              <Link
                href="/tutorials"
                style={{
                  color: 'var(--text-mid)',
                  textDecoration: 'none',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontSize: '0.68rem',
                }}
              >
                ← Tutorials
              </Link>
              <span aria-hidden style={{ color: 'var(--text-faint)' }}>·</span>
              <span
                style={{
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontSize: '0.68rem',
                }}
              >
                {tutorial.workflowName}
              </span>
              <span aria-hidden style={{ color: 'var(--text-faint)' }}>·</span>
              <span
                style={{
                  fontSize: '0.68rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                ~{tutorial.readMinutes} min
              </span>
            </div>

            {/* ── Title + subtitle ─────────────────────────────────── */}
            <h1
              style={{
                fontSize: 'clamp(1.7rem, 3vw, 2.4rem)',
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                marginBottom: '0.6rem',
                lineHeight: 1.15,
              }}
            >
              {tutorial.title}
            </h1>
            <p
              style={{
                color: 'var(--text-mid)',
                marginBottom: '2rem',
                fontSize: '0.95rem',
                lineHeight: 1.55,
              }}
            >
              {tutorial.subtitle}
            </p>

            {/* ── Section list ─────────────────────────────────────── */}
            <article
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2rem',
              }}
            >
              {tutorial.sections.map((s) => (
                <section
                  key={s.id}
                  id={s.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.95rem',
                  }}
                >
                  <h2
                    style={{
                      fontFamily: 'var(--font-playfair), serif',
                      fontSize: '1.35rem',
                      fontWeight: 400,
                      margin: 0,
                      color: 'var(--text)',
                      borderBottom: '1px solid var(--border)',
                      paddingBottom: '0.4rem',
                    }}
                  >
                    {s.title}
                  </h2>
                  <HelpBlockList blocks={s.body} />
                </section>
              ))}
            </article>

            {/* ── Closing nav ─────────────────────────────────────── */}
            <div
              style={{
                marginTop: '3rem',
                paddingTop: '1.25rem',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.78rem',
              }}
            >
              <Link
                href="/tutorials"
                className="btn-ghost"
                style={{ padding: '0.4rem 0.6rem' }}
              >
                ← All tutorials
              </Link>
              <Link
                href="/sourcing"
                className="btn-primary"
                style={{ padding: '0.4rem 0.85rem' }}
              >
                Start sourcing →
              </Link>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
