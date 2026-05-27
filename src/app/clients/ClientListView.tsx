'use client';

/**
 * Client List — interactive.
 *
 * The master view of every prospect/client. Workflow toggle chips (each
 * with a one-click "only" solo), a stage filter, and name/org search —
 * all client-side over the rows the server already scoped to the viewer.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  classifyBand,
  DEFAULT_BANDS,
  STAGE_LABEL,
  type ProspectStage,
} from '@/lib/prospects';

export interface ClientWorkflow {
  key: string;
  name: string;
  accent: string;
}

export interface ClientRow {
  id: string;
  workflowKey: string;
  contactName: string;
  orgName: string | null;
  marketArea: string | null;
  rankScore: number;
  stage: ProspectStage;
  ownerName: string | null;
  updatedAtLabel: string;
}

type StageTone = 'good' | 'warn' | 'accent' | 'cyan' | 'muted';
const STAGE_TONE: Record<ProspectStage, StageTone> = {
  researching: 'muted',
  qualified: 'good',
  contacting: 'accent',
  responded: 'warn',
  signed: 'good',
  client: 'cyan',
  passed: 'muted',
  dormant: 'muted',
};
const TONE_COLOR: Record<StageTone, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
  cyan: 'var(--brand-cyan)',
  muted: 'var(--text-faint)',
};

const STAGE_ORDER: ProspectStage[] = [
  'researching',
  'qualified',
  'contacting',
  'responded',
  'signed',
  'client',
  'passed',
  'dormant',
];

export function ClientListView({
  workflows,
  rows,
  isAdmin,
}: {
  workflows: ClientWorkflow[];
  rows: ClientRow[];
  isAdmin: boolean;
}) {
  const [shown, setShown] = useState<Set<string>>(
    () => new Set(workflows.map((w) => w.key)),
  );
  const [stage, setStage] = useState<ProspectStage | ''>('');
  const [search, setSearch] = useState('');

  const wfName = useMemo(
    () => new Map(workflows.map((w) => [w.key, w.name])),
    [workflows],
  );
  const wfAccent = useMemo(
    () => new Map(workflows.map((w) => [w.key, w.accent])),
    [workflows],
  );

  function toggle(key: string) {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function solo(key: string) {
    setShown(new Set([key]));
  }
  function showAll() {
    setShown(new Set(workflows.map((w) => w.key)));
  }

  const query = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (!shown.has(r.workflowKey)) return false;
    if (stage && r.stage !== stage) return false;
    if (query) {
      const hay = `${r.contactName} ${r.orgName ?? ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const allShown = shown.size === workflows.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Workflow toggles */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {workflows.map((w) => {
          const on = shown.has(w.key);
          return (
            <span
              key={w.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${on ? w.accent : 'var(--border)'}`,
                background: on ? `${w.accent}22` : 'transparent',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => toggle(w.key)}
                style={{
                  padding: '0.4rem 0.7rem',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  color: on ? 'var(--text)' : 'var(--text-faint)',
                  textDecoration: on ? 'none' : 'line-through',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: w.accent,
                    marginRight: '0.4rem',
                    opacity: on ? 1 : 0.4,
                  }}
                />
                {w.name}
              </button>
              <button
                onClick={() => solo(w.key)}
                title={`Show only ${w.name}`}
                style={{
                  padding: '0.4rem 0.5rem',
                  background: 'transparent',
                  border: 'none',
                  borderLeft: `1px solid ${on ? w.accent : 'var(--border)'}`,
                  cursor: 'pointer',
                  fontSize: '0.62rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--text-faint)',
                }}
              >
                only
              </button>
            </span>
          );
        })}
        {!allShown && (
          <button className="btn-ghost" onClick={showAll} style={{ padding: '0.3rem 0.4rem' }}>
            Show all
          </button>
        )}
      </div>

      {/* Stage + search */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="select"
          value={stage}
          onChange={(e) => setStage(e.target.value as ProspectStage | '')}
          style={{ width: 'auto' }}
          aria-label="Stage filter"
        >
          <option value="">All stages</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or organization…"
          style={{ flex: '1 1 220px', minWidth: 0 }}
        />
        <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="surface-card">
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            {rows.length === 0
              ? 'No prospects yet — qualify some.'
              : 'Nothing matches these filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {filtered.map((r) => {
            const band = classifyBand(r.rankScore, DEFAULT_BANDS);
            const scoreColor =
              band === 'qualified'
                ? 'var(--good)'
                : band === 'borderline'
                  ? 'var(--warn)'
                  : 'var(--text-faint)';
            const accent = wfAccent.get(r.workflowKey) ?? 'var(--text-faint)';
            return (
              <Link
                key={r.id}
                href={`/prospects/${r.id}`}
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
                    fontSize: '1.05rem',
                    color: scoreColor,
                    minWidth: '2.3rem',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {r.rankScore.toFixed(1)}
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
                    {r.contactName}
                  </span>
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
                    {[r.orgName, r.marketArea].filter(Boolean).join(' · ') || '—'}
                    {isAdmin && r.ownerName ? `  ·  ${r.ownerName}` : ''}
                  </span>
                </span>

                <span
                  style={{
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    color: accent,
                    border: `1px solid ${accent}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.18rem 0.45rem',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {wfName.get(r.workflowKey) ?? r.workflowKey}
                </span>

                <span
                  style={{
                    fontSize: '0.62rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: TONE_COLOR[STAGE_TONE[r.stage]],
                    border: `1px solid ${TONE_COLOR[STAGE_TONE[r.stage]]}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.2rem 0.5rem',
                    flexShrink: 0,
                  }}
                >
                  {STAGE_LABEL[r.stage]}
                </span>

                <span
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-faint)',
                    minWidth: '3.2rem',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {r.updatedAtLabel}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
