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
  call_booked: { label: 'Call booked', tone: 'cyan' },
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
  // D-043: list filter state. Lives above the early-return so hook
  // order stays stable even when no workflow is configured.
  const [pursuedOnly, setPursuedOnly] = useState(false);

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

  // D-043: list filter. Default hides `qualified` (already in the
  // pipeline) and `reject` (Sourcing said no). The "Pursued only"
  // toggle narrows the remaining set to `pursue`.
  //
  // F7-b: the list is cross-workflow — every prospect the rep owns
  // shows here, not just the currently-selected workflow. The
  // selected workflow's rows are floated to the top so the rep
  // doesn't have to switch tabs + scroll just to find a recent
  // prospect. Within each group the server's `ORDER BY created_at
  // DESC` is preserved (Array#filter is stable).
  const visibleProspects = prospects.filter((p) => {
    if (p.sourcingStatus === 'qualify' || p.sourcingStatus === 'reject') return false;
    if (pursuedOnly && p.sourcingStatus !== 'pursue') return false;
    return true;
  });
  const currentWorkflowProspects = visibleProspects.filter(
    (p) => p.workflowKey === wf.key,
  );
  const otherWorkflowProspects = visibleProspects.filter(
    (p) => p.workflowKey !== wf.key,
  );
  const myProspects = [...currentWorkflowProspects, ...otherWorkflowProspects];
  const hiddenCount = prospects.length - visibleProspects.length;

  // For the cross-workflow rows we render a small workflow-color dot
  // + name pill so the rep can scan which workflow a row belongs to
  // without leaving the bottom of Qualify.
  const wfByKey = new Map(workflows.map((w) => [w.key, w]));

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
      {/* D-044: direct-entry on Qualify quietly defaults
          sourcing_status to 'pursue' so the row appears in the
          default Qualify list right away. The rep is here BECAUSE
          they want to qualify this prospect — defaulting to
          'undecided' was a friction point. The toggle still lets
          them override. */}
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
        initialSourcingStatus="pursue"
        initialSourcingNote={null}
      />

      {/* ─── Recent prospects across every workflow (F7-b). The
          currently-selected workflow's rows float to the top so the
          rep doesn't have to switch tabs + scroll to find a recent
          one; everything else follows under an "Other workflows"
          subdivider. */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            marginBottom: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            Your prospects
            <span
              style={{
                marginLeft: '0.6rem',
                fontSize: '0.62rem',
                color: 'var(--text-faint)',
                textTransform: 'none',
                letterSpacing: 'normal',
                fontWeight: 500,
              }}
            >
              · {wf.name} first
              {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            </span>
          </div>
          {/* D-043: "Pursued only" toggle. */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.74rem',
              color: 'var(--text-mid)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={pursuedOnly}
              onChange={(e) => setPursuedOnly(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span>Pursued only</span>
          </label>
        </div>
        {myProspects.length === 0 ? (
          <div className="surface-card">
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
              No prospects yet — qualify one above or source a list at
              /sourcing.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {currentWorkflowProspects.map((p) =>
              renderProspectRow(p, wf, wfByKey),
            )}
            {currentWorkflowProspects.length > 0 &&
              otherWorkflowProspects.length > 0 && (
                <div
                  className="eyebrow"
                  style={{
                    marginTop: '0.85rem',
                    paddingTop: '0.6rem',
                    borderTop: '1px solid var(--border)',
                    color: 'var(--text-faint)',
                  }}
                >
                  Other workflows
                </div>
              )}
            {otherWorkflowProspects.map((p) =>
              renderProspectRow(p, wf, wfByKey),
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Row renderer (F7-b) ─────────────────────────────────────────── */
/* Shared by the current-workflow and other-workflows groups so the
   row chrome stays identical — the only difference between the two
   groups is their position in the list (current floats up). Each row
   carries a 4px workflow-accent left-stripe + a workflow-name pill
   so cross-workflow rows read at a glance. Band is classified
   against the prospect's OWN workflow's bands (each workflow can
   tune its qualified_min independently). */
function renderProspectRow(
  p: ProspectListItem,
  selectedWf: QualifyWorkflow,
  wfByKey: Map<string, QualifyWorkflow>,
) {
  const stage = STAGE_META[p.stage];
  const rowWf = wfByKey.get(p.workflowKey) ?? selectedWf;
  const pBand = classifyBand(p.rankScore, rowWf.bands);
  const scoreColor =
    pBand === 'qualified'
      ? 'var(--good)'
      : pBand === 'borderline'
        ? 'var(--warn)'
        : 'var(--text-faint)';
  const accent = rowWf.accent;
  return (
    <Link
      key={p.id}
      href={`/qualify/${p.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        padding: '0.7rem 0.9rem 0.7rem 0.7rem',
        textDecoration: 'none',
        color: 'inherit',
        // F7-b: 4px workflow-color stripe + 5% tinted background —
        // same dialect as /clients and /contact card lists so the
        // surfaces read as a family.
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${accent}`,
        background: `${accent}0D`,
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
          fontWeight: 700,
          color: accent,
          border: `1px solid ${accent}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0.18rem 0.45rem',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {rowWf.name}
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
}
