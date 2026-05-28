'use client';

/**
 * The /qualify (no-id) wrapper.
 *
 * After the P8 unification (D-033), Qualify is one surface in two
 * modes; the **edit** mode lives at `/qualify/[id]`. This file is the
 * **create** mode: a workflow picker, the shared `QualifyForm` for
 * a brand-new agent (rep found them through non-Sourcing research),
 * and the rep's recent prospects below for quick navigation.
 *
 * The form itself (gates, scoring, status, override, score panel,
 * save) lives in `QualifyForm`. Both modes save through
 * `upsertSourcingRow`; after a successful create, the form redirects
 * to `/qualify/[new-id]` so the rep stays on Qualify with the new
 * record loaded.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  classifyBand,
  type RankFactor,
  type RankBands,
  type ProspectStage,
  type ProspectListItem,
} from '@/lib/prospects';
import { QualifyForm, type QualifyFormWorkflow } from './QualifyForm';

export interface QualifyWorkflow {
  key: string;
  name: string;
  branch: 'portraits' | 'realestate' | 'corporate' | null;
  contactNoun: string;
  orgNoun: string | null;
  accent: string;
  factors: RankFactor[];
  bands: RankBands;
  qualifiedCount: number;
}

type StageTone = 'good' | 'warn' | 'accent' | 'cyan' | 'muted';
const STAGE_META: Record<ProspectStage, { label: string; tone: StageTone }> = {
  researching: { label: 'Researching', tone: 'muted' },
  qualified: { label: 'Qualified', tone: 'good' },
  contacting: { label: 'Contacting', tone: 'accent' },
  responded: { label: 'Responded', tone: 'warn' },
  signed: { label: 'Signed', tone: 'good' },
  client: { label: 'Client', tone: 'cyan' },
  rejected: { label: 'Rejected', tone: 'muted' },
  dormant: { label: 'Dormant', tone: 'muted' },
};
const TONE_COLOR: Record<StageTone, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
  cyan: 'var(--brand-cyan)',
  muted: 'var(--text-faint)',
};

export function QualifyClient({
  workflows,
  prospects,
}: {
  workflows: QualifyWorkflow[];
  prospects: ProspectListItem[];
}) {
  const [selectedKey, setSelectedKey] = useState(workflows[0]?.key ?? '');

  const wf = workflows.find((w) => w.key === selectedKey) ?? workflows[0] ?? null;

  if (!wf) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No workflows configured yet — seed the database to start qualifying.
        </p>
      </div>
    );
  }

  const formWorkflow: QualifyFormWorkflow = {
    key: wf.key,
    name: wf.name,
    accent: wf.accent,
    contactNoun: wf.contactNoun,
    orgNoun: wf.orgNoun,
    factors: wf.factors,
    bands: wf.bands,
  };

  const myProspects = prospects.filter((p) => p.workflowKey === wf.key);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ─── Workflow picker (create mode only — edit mode locks the workflow). */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {workflows.map((w) => {
          const active = w.key === wf.key;
          return (
            <button
              key={w.key}
              onClick={() => setSelectedKey(w.key)}
              style={{
                padding: '0.5rem 0.95rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${active ? w.accent : 'var(--border-strong)'}`,
                background: active ? `${w.accent}22` : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-mid)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s, color 0.15s',
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
                  marginRight: '0.45rem',
                }}
              />
              {w.name}
            </button>
          );
        })}
      </div>

      {/* ─── The shared QualifyForm — create mode (no prospectId). */}
      {/* React key on workflow.key remounts the form when the rep
          switches workflows, so internal state resets cleanly. */}
      <QualifyForm
        key={wf.key}
        prospectId={null}
        workflow={formWorkflow}
        initialIdentity={{
          contactName: '',
          orgName: null,
          marketArea: null,
          grossVolume: null,
          sourceUrl: null,
        }}
        initialInputs={{}}
        initialScore={0}
        initialStage="researching"
        initialSourcingStatus="undecided"
        initialSourcingNote={null}
      />

      {/* ─── This workflow's recent prospects. */}
      <section>
        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
          Your {wf.name} prospects
        </div>
        {myProspects.length === 0 ? (
          <div className="surface-card">
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
              No prospects in this workflow yet — qualify one above or source a
              list at /sourcing.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {myProspects.map((p) => {
              const stage = STAGE_META[p.stage];
              const pBand = classifyBand(p.rankScore, wf.bands);
              const scoreColor =
                pBand === 'qualified'
                  ? 'var(--good)'
                  : pBand === 'borderline'
                    ? 'var(--warn)'
                    : 'var(--text-faint)';
              return (
                <Link
                  key={p.id}
                  href={`/qualify/${p.id}`}
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
                      fontSize: '1.15rem',
                      color: scoreColor,
                      minWidth: '2.4rem',
                      textAlign: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {p.rankScore.toFixed(1)}
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
                      {p.contactName}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {[p.orgName, p.marketArea].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: TONE_COLOR[stage.tone],
                      border: `1px solid ${TONE_COLOR[stage.tone]}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.2rem 0.5rem',
                      flexShrink: 0,
                    }}
                  >
                    {stage.label}
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
                    {p.createdAt}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
