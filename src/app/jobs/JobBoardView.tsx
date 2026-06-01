'use client';

/**
 * Jobs board — interactive. Columns by lifecycle stage; each job a card
 * that links into its page. A "show closed" toggle reveals complete +
 * cancelled. Active-stage cards carry the workflow accent stripe, the same
 * dialect as the Pipeline + Clients lists.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtMoney } from '@/lib/pricing';
import {
  JOB_STAGE_FLOW,
  JOB_STAGE_LABEL,
  PAYMENT_LABEL,
  isJobClosed,
  jobStageIndex,
  type JobStage,
  type JobListItem,
} from '@/lib/jobs';
import { quickSetJobStatus, quickSetJobPaid } from './actions';

const CLOSED_STAGES: JobStage[] = ['complete', 'cancelled'];

export function JobBoardView({ jobs, isAdmin }: { jobs: JobListItem[]; isAdmin: boolean }) {
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      jobs.filter((j) => {
        if (!query) return true;
        const hay = `${j.clientName ?? ''} ${j.title ?? ''}`.toLowerCase();
        return hay.includes(query);
      }),
    [jobs, query],
  );

  const byStage = useMemo(() => {
    const m = new Map<JobStage, JobListItem[]>();
    for (const j of filtered) {
      const list = m.get(j.stage) ?? [];
      list.push(j);
      m.set(j.stage, list);
    }
    return m;
  }, [filtered]);

  const liveStages = JOB_STAGE_FLOW;
  const closedCount = filtered.filter((j) => isJobClosed(j.stage)).length;

  if (jobs.length === 0) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No jobs yet. Open a client and hit <strong>+ New job</strong> to book one — or a job
          appears here when you set one up from a signed prospect.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <div
        className="filter-bar-responsive"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client or job title…"
          style={{ flex: '1 1 240px', minWidth: 0 }}
        />
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.74rem',
            color: 'var(--text-mid)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span>
            Show closed
            {!showClosed && closedCount > 0 && (
              <span style={{ color: 'var(--text-faint)' }}> ({closedCount} hidden)</span>
            )}
          </span>
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '0.85rem',
          alignItems: 'start',
        }}
      >
        {liveStages.map((stage) => {
          const list = byStage.get(stage) ?? [];
          return (
            <div key={stage} style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.64rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--text-faint)',
                  marginBottom: '0.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>{JOB_STAGE_LABEL[stage]}</span>
                <span>{list.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {list.map((j) => (
                  <JobCard key={j.id} job={j} isAdmin={isAdmin} />
                ))}
                {list.length === 0 && (
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-faint)',
                      padding: '0.5rem 0.6rem',
                      border: '1px dashed var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    —
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showClosed && (
        <div>
          <div
            style={{
              fontSize: '0.64rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--text-faint)',
              margin: '0.5rem 0',
            }}
          >
            Closed
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {CLOSED_STAGES.flatMap((s) => byStage.get(s) ?? []).map((j) => (
              <JobCard key={j.id} job={j} isAdmin={isAdmin} closed />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, isAdmin, closed }: { job: JobListItem; isAdmin: boolean; closed?: boolean }) {
  const accent = job.workflowAccent ?? 'var(--text-faint)';
  return (
    <div
      style={{
        padding: '0.6rem 0.7rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        background: `${accent}0D`,
        opacity: closed ? 0.7 : 1,
      }}
    >
      <Link
        href={`/jobs/${job.id}`}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        <span
          style={{
            display: 'block',
            fontSize: '0.83rem',
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {job.clientName ?? 'Client'}
        </span>
        {job.title && (
          <span
            style={{
              display: 'block',
              fontSize: '0.73rem',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {job.title}
          </span>
        )}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.4rem',
            marginTop: '0.35rem',
          }}
        >
          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
            {job.shootDateLabel ?? 'No date'}
            {closed ? ` · ${JOB_STAGE_LABEL[job.stage]}` : ''}
          </span>
          {job.valuePrice !== null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <MiniRing fraction={job.paidFraction} />
              <span
                className="money"
                style={{
                  fontSize: '0.74rem',
                  color: job.paymentStatus === 'paid' ? 'var(--good)' : 'var(--text-mid)',
                }}
                title={PAYMENT_LABEL[job.paymentStatus]}
              >
                {fmtMoney(job.valuePrice)}
              </span>
            </span>
          )}
        </span>
        {isAdmin && job.workflowName && (
          <span style={{ display: 'block', fontSize: '0.66rem', color: accent, marginTop: '0.2rem' }}>
            {job.workflowName}
          </span>
        )}
      </Link>

      <QuickStatusBar job={job} />
    </div>
  );
}

/**
 * Master-view quick toggles (Phase 4) — Sent · Done · Paid, one click each,
 * right on the board. Complements Sprout: records status only, no delivery
 * or payment processing. Sits below the card's clickable area so the
 * buttons aren't nested in the card link.
 */
function QuickStatusBar({ job }: { job: JobListItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const sent = jobStageIndex(job.stage) >= jobStageIndex('deliver'); // deliver or later
  const finished = job.stage === 'complete';
  const paid = job.paymentStatus === 'paid';
  const cancelled = job.stage === 'cancelled';

  async function run(fn: () => Promise<{ ok: boolean }>) {
    if (busy) return;
    setBusy(true);
    await fn();
    router.refresh();
    setBusy(false);
  }

  if (cancelled) {
    return (
      <div style={{ marginTop: '0.5rem', fontSize: '0.62rem', color: 'var(--text-faint)' }}>
        Cancelled · reopen from the job page
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.3rem',
        marginTop: '0.5rem',
        paddingTop: '0.45rem',
        borderTop: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <Pill
        active={sent && !finished}
        done={sent}
        label="Sent"
        busy={busy}
        onClick={() => run(() => quickSetJobStatus({ jobId: job.id, status: 'sent' }))}
      />
      <Pill
        active={finished}
        done={finished}
        label="Done"
        busy={busy}
        onClick={() =>
          run(() =>
            quickSetJobStatus({ jobId: job.id, status: finished ? 'reopen' : 'finished' }),
          )
        }
      />
      <Pill
        active={paid}
        done={paid}
        label="Paid"
        busy={busy}
        tone="good"
        onClick={() => run(() => quickSetJobPaid({ jobId: job.id, paid: !paid }))}
      />
    </div>
  );
}

/** Tiny collected-fraction ring for a board card. Pure SVG. */
function MiniRing({ fraction }: { fraction: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const filled = c * Math.max(0, Math.min(1, fraction));
  if (fraction <= 0) return null;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={`${Math.round(fraction * 100)}% collected`}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="var(--good)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

function Pill({
  active,
  done,
  label,
  busy,
  tone = 'accent',
  onClick,
}: {
  active: boolean;
  done: boolean;
  label: string;
  busy: boolean;
  tone?: 'accent' | 'good';
  onClick: () => void;
}) {
  const color = tone === 'good' ? 'var(--good)' : 'var(--accent)';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontSize: '0.6rem',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontWeight: 700,
        padding: '0.2rem 0.5rem',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${done ? color : 'var(--border)'}`,
        background: done ? `${color}22` : 'transparent',
        color: done ? color : 'var(--text-faint)',
        cursor: busy ? 'default' : 'pointer',
      }}
    >
      {done ? `✓ ${label}` : label}
    </button>
  );
}
