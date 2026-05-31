'use client';

/**
 * Jobs board — interactive. Columns by lifecycle stage; each job a card
 * that links into its page. A "show closed" toggle reveals complete +
 * cancelled. Active-stage cards carry the workflow accent stripe, the same
 * dialect as the Pipeline + Clients lists.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmtMoney } from '@/lib/pricing';
import {
  JOB_STAGE_FLOW,
  JOB_STAGE_LABEL,
  PAYMENT_LABEL,
  isJobClosed,
  type JobStage,
  type JobListItem,
} from '@/lib/jobs';

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
    <Link
      href={`/jobs/${job.id}`}
      style={{
        display: 'block',
        padding: '0.6rem 0.7rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        background: `${accent}0D`,
        textDecoration: 'none',
        color: 'inherit',
        opacity: closed ? 0.6 : 1,
      }}
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
        )}
      </span>
      {isAdmin && job.workflowName && (
        <span style={{ display: 'block', fontSize: '0.66rem', color: accent, marginTop: '0.2rem' }}>
          {job.workflowName}
        </span>
      )}
    </Link>
  );
}
