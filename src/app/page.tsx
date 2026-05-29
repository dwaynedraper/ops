import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { DigestOptIn } from '@/components/DigestOptIn';
import { STAGE_LABEL, type ProspectStage } from '@/lib/prospects';
import { computeDigest, type DigestItem } from '@/lib/digest';

/**
 * Dashboard — the daily working surface (D-062, D-063).
 *
 * V2 (F12) folded the standalone /today route into the Dashboard. The
 * digest computation in `lib/digest.ts` is unchanged — it still
 * powers both this page and the morning email cron, so the page and
 * the email always agree.
 *
 * Owner-scoped (D-019): every count and queue is the signed-in rep's
 * own pipeline. The digest panels (replies, follow-ups, close-outs)
 * carry the "what needs you today" intent; the pipeline-by-workflow
 * section underneath gives the cross-workflow funnel view that the
 * old /today page didn't have.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard' };

interface WorkflowRow {
  workflow_key: string;
  name: string;
  accent: string;
}
interface StageCountRow {
  workflow_key: string;
  stage: ProspectStage;
  n: number;
}
interface TargetRow {
  workflow_key: string;
  value: string;
}

const QUALIFIED_STAGES: ProspectStage[] = [
  'qualified',
  'contacting',
  'responded',
  'signed',
  'client',
];
const TILE_STAGES: ProspectStage[] = [
  'researching',
  'qualified',
  'contacting',
  'responded',
  'signed',
  'client',
];

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export default async function Dashboard() {
  const session = await auth();
  const user = session?.user;
  const role = user?.role ?? 'partner';
  const firstName = (user?.displayName ?? user?.name ?? user?.email ?? '')
    .toString()
    .split(/[\s@]/)[0];

  // Logged-out users get redirected, consistent with every other page.
  // proxy.ts normally catches this first; this is the defense-in-depth.
  if (!user) {
    redirect('/signin');
  }

  const now = new Date();
  // F12 (D-063): the digest computation lives in `lib/digest.ts` and
  // is shared with the morning-email cron route, so the page and the
  // email always agree. The Dashboard runs it alongside the pipeline
  // queries.
  const [workflowRows, countRows, targetRows, digest, profile] = await Promise.all([
    sql<WorkflowRow>`
      SELECT workflow_key, name, accent FROM workflows
      WHERE active = true ORDER BY sort_order, name`,
    sql<StageCountRow>`
      SELECT workflow_key, stage, COUNT(*)::int AS n
      FROM prospects
      WHERE owner_id = ${user.id}
      GROUP BY workflow_key, stage`,
    sql<TargetRow>`
      SELECT workflow_key, value FROM rank_config WHERE key = 'qualified_target_count'`,
    computeDigest(user.id, now),
    sqlOne<{ digest_email: boolean }>`
      SELECT digest_email FROM ops_profiles WHERE user_id = ${user.id}`,
  ]);

  // workflow_key → stage → count
  const counts = new Map<string, Map<ProspectStage, number>>();
  for (const r of countRows) {
    const m = counts.get(r.workflow_key) ?? new Map<ProspectStage, number>();
    m.set(r.stage, r.n);
    counts.set(r.workflow_key, m);
  }
  const countOf = (wf: string, s: ProspectStage) => counts.get(wf)?.get(s) ?? 0;

  const targetByWf = new Map(targetRows.map((r) => [r.workflow_key, Number(r.value)]));

  // Digest breakdown for the morning brief (D-063 — folded in from
  // the old /today route).
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
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
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

            {/* ─── Replies waiting on you (D-063) ────────────────────── */}
            {replies.length > 0 && (
              <DigestSection
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
              </DigestSection>
            )}

            {/* ─── Follow-ups due (D-063) ────────────────────────────── */}
            {dueNow.length > 0 && (
              <DigestSection
                title="Follow-ups due today"
                hint="Work these top-down — highest score first. The composer is in Contact."
                action={{ href: '/contact', label: 'Open Contact →' }}
              >
                {dueNow.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href="/contact"
                    tag={`${i.status === 'due' ? 'Due' : 'Ready'} · ${i.nextLabel}`}
                    tagColor={i.status === 'due' ? 'var(--warn)' : 'var(--accent)'}
                  />
                ))}
              </DigestSection>
            )}

            {/* ─── Close-outs (D-063) ────────────────────────────────── */}
            {closeOuts.length > 0 && (
              <DigestSection
                title="Ready to close out"
                hint="The full cycle ran with no reply. Close them so the board stays honest."
                action={{ href: '/contact', label: 'Open Contact →' }}
              >
                {closeOuts.map((i) => (
                  <DigestRow
                    key={i.id}
                    item={i}
                    href="/contact"
                    tag="No reply"
                    tagColor="var(--text-faint)"
                  />
                ))}
              </DigestSection>
            )}

            {/* ─── All clear ─────────────────────────────────────────── */}
            {allClear && (
              <div className="surface-card" style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--text)', marginBottom: '0.85rem' }}>
                  No replies, no follow-ups due, nothing to close. The cycle is current.
                  A good morning to put fresh names in the pipeline.
                </p>
                <Link href="/qualify" className="btn-primary">
                  Qualify new prospects
                </Link>
              </div>
            )}

            {/* ─── In motion (ambient) ───────────────────────────────── */}
            {waiting.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginBottom: '2rem' }}>
                {waiting.length} prospect{waiting.length === 1 ? ' is' : 's are'} mid-cycle,
                inside the follow-up window
                {soonestWait !== null
                  ? ` — the next comes due in ${soonestWait} day${soonestWait === 1 ? '' : 's'}.`
                  : '.'}
              </p>
            )}

            {/* ─── Pipeline by workflow ──────────────────────────────── */}
            <section>
              <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
                Pipeline by workflow
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {workflowRows.map((w) => {
                  const qualified = QUALIFIED_STAGES.reduce(
                    (s, st) => s + countOf(w.workflow_key, st),
                    0,
                  );
                  const target = targetByWf.get(w.workflow_key) ?? 10;
                  const hit = qualified >= target && qualified > 0;
                  return (
                    <div key={w.workflow_key} className="surface-card">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          marginBottom: '0.6rem',
                        }}
                      >
                        <div
                          style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)' }}
                        >
                          <span
                            aria-hidden
                            style={{
                              display: 'inline-block',
                              width: 9,
                              height: 9,
                              borderRadius: '50%',
                              background: w.accent,
                              marginRight: '0.5rem',
                            }}
                          />
                          {w.name}
                        </div>
                        {hit ? (
                          <Link
                            href="/contact"
                            style={{
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              color: 'var(--good)',
                              textDecoration: 'none',
                            }}
                          >
                            {qualified} / {target} qualified — start contacting →
                          </Link>
                        ) : (
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                            {qualified} / {target} qualified
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                          gap: '0.5rem',
                        }}
                      >
                        {TILE_STAGES.map((s) => (
                          <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                            <span
                              className="money"
                              style={{ fontSize: '1.05rem', color: 'var(--text)' }}
                            >
                              {countOf(w.workflow_key, s)}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                              {STAGE_LABEL[s]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ─── Email opt-in (folded from /today, D-063) ─────────── */}
            <DigestOptIn enabled={profile?.digest_email ?? false} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

// ─── Digest section + row helpers (folded from /today, D-063) ────────

function DigestSection({
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
      className="surface-tool list-row-responsive"
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
        className="list-row-trail"
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: tagColor,
          flexShrink: 0,
          textAlign: 'right',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {tag}
      </span>
    </Link>
  );
}
