import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sqlOne } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { computeDigest, type DigestItem } from '@/lib/digest';
import { DigestOptIn } from './DigestOptIn';

/**
 * Today — the morning digest, per rep.
 *
 * Owner-scoped (D-019): one scannable brief of what needs the signed-in
 * rep today. The computation lives in src/lib/digest.ts — shared with
 * the digest cron route, so the page and the email always agree. The
 * standalone page the dead /today nav always promised.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today' };

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export default async function TodayPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/today');

  const role = user.role ?? 'partner';
  const firstName = (user.displayName ?? user.name ?? user.email ?? '')
    .toString()
    .split(/[\s@]/)[0];

  const now = new Date();
  const [digest, profile] = await Promise.all([
    computeDigest(user.id, now),
    sqlOne<{ digest_email: boolean }>`
      SELECT digest_email FROM ops_profiles WHERE user_id = ${user.id}`,
  ]);

  const { replies, dueNow, closeOuts, waiting, soonestWait, allClear } = digest;

  const summaryParts: string[] = [];
  if (replies.length > 0) {
    summaryParts.push(`${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} to act on`);
  }
  if (dueNow.length > 0) {
    summaryParts.push(`${dueNow.length} follow-up${dueNow.length === 1 ? '' : 's'} due`);
  }
  if (closeOuts.length > 0) {
    summaryParts.push(`${closeOuts.length} to close out`);
  }

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              {DATE_FMT.format(now)}
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
              {allClear
                ? 'Nothing is waiting on you this morning — a clean slate.'
                : `Your morning brief: ${summaryParts.join(' · ')}.`}
            </p>

            {/* ─── Replies to act on ─────────────────────────────────── */}
            {replies.length > 0 && (
              <Section
                title="Replies waiting on you"
                hint="Someone wrote back — take it to their client page and quote the work."
              >
                {replies.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href={`/prospects/${i.id}`}
                    tag="Replied"
                    tagColor="var(--good)"
                  />
                ))}
              </Section>
            )}

            {/* ─── Follow-ups due ────────────────────────────────────── */}
            {dueNow.length > 0 && (
              <Section
                title="Follow-ups due today"
                hint="Work these top-down — highest score first. The composer is in Tracking."
                action={{ href: '/tracking', label: 'Open Tracking →' }}
              >
                {dueNow.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href="/tracking"
                    tag={`${i.status === 'due' ? 'Due' : 'Ready'} · ${i.nextLabel}`}
                    tagColor={i.status === 'due' ? 'var(--warn)' : 'var(--accent)'}
                  />
                ))}
              </Section>
            )}

            {/* ─── Close-outs ────────────────────────────────────────── */}
            {closeOuts.length > 0 && (
              <Section
                title="Ready to close out"
                hint="The full cycle ran with no reply. Close them so the board stays honest."
                action={{ href: '/tracking', label: 'Open Tracking →' }}
              >
                {closeOuts.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href="/tracking"
                    tag="No reply"
                    tagColor="var(--text-faint)"
                  />
                ))}
              </Section>
            )}

            {/* ─── All clear ─────────────────────────────────────────── */}
            {allClear && (
              <div className="surface-card" style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--text)', marginBottom: '0.85rem' }}>
                  No replies, no follow-ups due, nothing to close. The cycle is current.
                  A good morning to put fresh names in the pipeline.
                </p>
                <Link href="/prospects" className="btn-primary">
                  Research new prospects
                </Link>
              </div>
            )}

            {/* ─── In motion (ambient) ───────────────────────────────── */}
            {waiting.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>
                {waiting.length} prospect{waiting.length === 1 ? ' is' : 's are'} mid-cycle,
                inside the follow-up window
                {soonestWait !== null
                  ? ` — the next comes due in ${soonestWait} day${soonestWait === 1 ? '' : 's'}.`
                  : '.'}
              </p>
            )}

            {/* ─── Email opt-in ──────────────────────────────────────── */}
            <DigestOptIn enabled={profile?.digest_email ?? false} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.3rem',
        }}
      >
        <div className="eyebrow">{title}</div>
        {action && (
          <Link href={action.href} className="btn-ghost" style={{ padding: '0.2rem 0' }}>
            {action.label}
          </Link>
        )}
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>
        {hint}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>{children}</div>
    </section>
  );
}

// ─── One prospect row ─────────────────────────────────────────────────

function DigestRow({
  item,
  href,
  tag,
  tagColor,
}: {
  item: DigestItem;
  href: string;
  tag: string;
  tagColor: string;
}) {
  return (
    <Link
      href={href}
      className="surface-tool"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        padding: '0.7rem 0.9rem',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span
        className="money"
        style={{
          fontSize: '1rem',
          color: 'var(--text-faint)',
          minWidth: '2.2rem',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {item.rankScore.toFixed(1)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: '0.88rem',
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.contactName}
        </span>
        <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: item.workflowAccent,
              marginRight: '0.4rem',
            }}
          />
          {item.workflowName}
          {item.orgName ? ` · ${item.orgName}` : ''}
        </span>
      </span>
      <span
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: tagColor,
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {tag}
      </span>
    </Link>
  );
}
