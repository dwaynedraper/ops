'use client';

/**
 * Sourcing client — the V1-close redesign.
 *
 * Structure (top to bottom):
 *   1. Workflow picker (which scoring config + column set is active).
 *   2. Filter bar — status filter chips (All / Undecided / Pursued /
 *      Qualified / Rejected).
 *   3. Add-prospect form — name + agency required, everything else
 *      optional. Single Add button; form state is local until Add
 *      fires, so there's no foot-gun where typing one letter creates a
 *      row. After a successful add the form resets.
 *   4. Sortable table of existing rows — default sort is most recent
 *      first. Row-level editing: a pencil per row unlocks every cell
 *      in that row at once; click the green check or click off the row
 *      to commit. An active-row gutter softens accidental click-offs.
 *
 * Lifecycle / status model (D-033 + V1 close):
 *   - Sourcing toggle is `Pursue / Undecided / Reject`. Pursue does NOT
 *     promote the lifecycle stage to `qualified` — the rep has to go
 *     to /qualify/[id] for that. Reject moves stage to `rejected`.
 *   - The /qualify page's toggle is `Qualify / Undecided / Reject` and
 *     is the only way to set `stage = qualified`.
 *   - Both pages share the same `sourcing_status` column; Sourcing
 *     never writes `qualify`, Qualify never writes `pursue`. Reject
 *     means the same thing from either side.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  classifyBand,
  type RankBands,
  type RankFactor,
  type ScoreBand,
} from '@/lib/prospects';
import {
  needsOverride,
  type SourcingColumn,
  type SourcingRow,
  type SourcingStatus,
} from '@/lib/sourcing';
import { HelpBox } from '@/components/HelpBox';
import { getHelpEntry } from '@/lib/help-content';
import { upsertSourcingRow, type UpsertSourcingRowInput } from './actions';

/** Map a sourcing column key to the help-content factor key. Column
 * keys for first-class intake fields use camelCase (`grossVolume`);
 * help-content keys use snake_case (`gross_volume`). Hard-qualifier
 * column keys already match factor keys, so the mapping is identity
 * for them. HelpBox renders nothing when no entry exists for a key,
 * so passing every column through is safe. (D-041.) */
function helpKeyForColumn(columnKey: string): string {
  if (columnKey === 'grossVolume') return 'gross_volume';
  if (columnKey === 'sourceUrl') return 'source_url';
  return columnKey;
}

const OVERRIDE_MIN_CHARS = 20;
const QUALIFY_COL_WIDTH = 56;
const SCORE_COL_WIDTH = 80;
const ACTIONS_COL_WIDTH = 56;

const STATUS_LABEL: Record<SourcingStatus, string> = {
  undecided: '—',
  pursue: 'Pursue',
  qualify: 'Qualify',
  reject: 'Reject',
};

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function prettyUrl(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function parseIntOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseFloatOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export interface SourcingWorkflow {
  key: string;
  name: string;
  branch: 'portraits' | 'realestate' | 'corporate' | null;
  contactNoun: string;
  orgNoun: string | null;
  accent: string;
  bands: RankBands;
  columns: SourcingColumn[];
  factors: RankFactor[];
}

/* ── Row draft state (used by both the add form and the in-table edit) ── */

interface RowDraft {
  contactName: string;
  orgName: string;
  marketArea: string;
  sidesCount: string;
  grossVolume: string;
  sourceUrl: string;
  sourcingStatus: SourcingStatus;
  sourcingNote: string;
  rankInputs: Record<string, boolean | number>;
}

function draftFromRow(row: SourcingRow): RowDraft {
  return {
    contactName: row.contactName,
    orgName: row.orgName ?? '',
    marketArea: row.marketArea ?? '',
    sidesCount: row.sidesCount === null ? '' : String(row.sidesCount),
    grossVolume: row.grossVolume === null ? '' : String(row.grossVolume),
    sourceUrl: row.sourceUrl ?? '',
    sourcingStatus: row.sourcingStatus,
    sourcingNote: row.sourcingNote ?? '',
    rankInputs: { ...row.rankInputs },
  };
}

function emptyDraft(): RowDraft {
  return {
    contactName: '',
    orgName: '',
    marketArea: '',
    sidesCount: '',
    grossVolume: '',
    sourceUrl: '',
    sourcingStatus: 'undecided',
    sourcingNote: '',
    rankInputs: {},
  };
}

/* ── Filters + sorting ────────────────────────────────────────────── */

type StatusFilter = 'all' | SourcingStatus;
type SortKey =
  | 'rankScore'
  | 'contactName'
  | 'orgName'
  | 'marketArea'
  | 'grossVolume'
  | 'sourcingStatus'
  | 'createdAt'
  | string; // also any rank_inputs key (e.g. 'annual_volume')

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/* ── Main component ───────────────────────────────────────────────── */

export function SourcingClient({
  workflows,
  initialRows,
}: {
  workflows: SourcingWorkflow[];
  initialRows: SourcingRow[];
}) {
  const [selectedKey, setSelectedKey] = useState(workflows[0]?.key ?? '');
  const [rows, setRows] = useState<SourcingRow[]>(initialRows);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortState>({ key: 'createdAt', dir: 'desc' });
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const wf = workflows.find((w) => w.key === selectedKey) ?? workflows[0] ?? null;

  /* Upsert helper used by both the add form and the in-table edit. */
  const handleSave = useCallback(
    async (
      id: string | null,
      patch: UpsertSourcingRowInput,
    ): Promise<SourcingRow | null> => {
      const res = await upsertSourcingRow(patch);
      if (res.ok && res.row) {
        setRows((prev) => {
          const idx = prev.findIndex((r) => r.id === res.row!.id);
          if (idx === -1) return [res.row!, ...prev];
          const next = [...prev];
          next[idx] = res.row!;
          return next;
        });
        if (id) {
          setRowErrors((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        } else {
          setFormError(null);
        }
        return res.row;
      }
      if (id) {
        setRowErrors((prev) => ({ ...prev, [id]: res.error ?? 'Could not save.' }));
      } else {
        setFormError(res.error ?? 'Could not add the prospect.');
      }
      return null;
    },
    [],
  );

  if (!wf) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No workflows configured yet — seed the database before sourcing.
        </p>
      </div>
    );
  }

  /* Filter + sort, both client-side over the rep's full row set. */
  const workflowRows = rows.filter((r) => r.workflowKey === wf.key);
  const filteredRows = workflowRows.filter((r) =>
    statusFilter === 'all' ? true : r.sourcingStatus === statusFilter,
  );
  const visibleRows = sortRows(filteredRows, sort);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ─── Workflow picker ───────────────────────────────────────── */}
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

      {/* ─── Where to start (F2.8.4) ──────────────────────────────── */}
      {/* Sits between the workflow tabs and the form so a rep new to
          /sourcing — or returning after a break — gets a clear
          three-step guide before they start typing. Per-workflow
          content; renders nothing if a workflow doesn't have a
          `start` entry authored. */}
      <WhereToStart workflowKey={wf.key} contactNoun={wf.contactNoun} />

      {/* ─── Add-prospect form ────────────────────────────────────── */}
      <AddProspectForm
        key={wf.key}
        workflow={wf}
        formError={formError}
        onAdd={(patch) => handleSave(null, patch)}
      />

      {/* ─── Filter bar ───────────────────────────────────────────── */}
      <FilterBar
        statusFilter={statusFilter}
        onChange={setStatusFilter}
        counts={statusCountsFor(workflowRows)}
      />

      {/* ─── Table ────────────────────────────────────────────────── */}
      <SourcingTable
        workflow={wf}
        rows={visibleRows}
        sort={sort}
        onSortChange={setSort}
        activeRowId={activeRowId}
        setActiveRowId={setActiveRowId}
        rowErrors={rowErrors}
        onSave={handleSave}
      />
    </div>
  );
}

/* ── Add-prospect form ────────────────────────────────────────────── */

/* ── Where-to-start onboarding strip (F2.8.4) ─────────────────────── */

function WhereToStart({
  workflowKey,
  contactNoun,
}: {
  workflowKey: string;
  contactNoun: string;
}) {
  // Render nothing if the workflow doesn't have a `start` entry yet —
  // V2 only ships real_estate; other workflows backlog the content.
  const entry = getHelpEntry(workflowKey, 'start', 'sourcing');
  if (!entry) return null;

  const lowerNoun = contactNoun.toLowerCase();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        flexWrap: 'wrap',
        padding: '0.7rem 1rem',
        background: 'var(--accent-dim)',
        border: '1px solid var(--border-accent)',
        borderRadius: 'var(--radius)',
      }}
    >
      <span
        style={{
          fontSize: '0.6rem',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--accent)',
        }}
      >
        Where to start
      </span>
      <span
        style={{
          fontSize: '0.82rem',
          color: 'var(--text-mid)',
          flex: 1,
          minWidth: '14ch',
        }}
      >
        Sourcing {lowerNoun}s in three steps — get the list, fill each
        row, keep moving.
      </span>
      <HelpBox
        workflowKey={workflowKey}
        factorKey="start"
        mode="sourcing"
        label="Open the guide →"
      />
    </div>
  );
}

function AddProspectForm({
  workflow,
  formError,
  onAdd,
}: {
  workflow: SourcingWorkflow;
  formError: string | null;
  onAdd: (patch: UpsertSourcingRowInput) => Promise<SourcingRow | null>;
}) {
  const [draft, setDraft] = useState<RowDraft>(() => emptyDraft());
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const liveScore = computeLiveScore(workflow, draft.rankInputs);
  const band = classifyBand(liveScore, workflow.bands);
  // D-045: don't force a reason on a fresh add-prospect row whose
  // factors are all empty (band='reject' / score 0 isn't meaningful).
  const override = needsOverride(draft.sourcingStatus, band, {
    rankInputs: draft.rankInputs,
    factorKeys: workflow.factors.map((f) => f.key),
  });
  const reasonOk = !override || draft.sourcingNote.trim().length >= OVERRIDE_MIN_CHARS;

  const canAdd =
    !adding &&
    reasonOk &&
    draft.contactName.trim().length > 0 &&
    draft.orgName.trim().length > 0;

  async function handleAdd() {
    if (!canAdd) return;
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      const patch: UpsertSourcingRowInput = {
        workflowKey: workflow.key,
        contactName: draft.contactName,
        orgName: draft.orgName,
        marketArea: draft.marketArea || null,
        sidesCount: parseIntOrNull(draft.sidesCount),
        grossVolume: parseFloatOrNull(draft.grossVolume),
        sourceUrl: draft.sourceUrl || null,
        sourcingStatus: draft.sourcingStatus,
        sourcingNote: override ? draft.sourcingNote.trim() : null,
        rankInputPatches: draft.rankInputs,
      };
      const created = await onAdd(patch);
      if (created) setDraft(emptyDraft());
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  const intakeCols = workflow.columns.filter(
    (c) => c.group === 'intake' && c.key !== 'sourcingStatus',
  );
  const qualifierCols = workflow.columns.filter((c) => c.group === 'qualifier');

  return (
    <div
      className="surface-tool"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        padding: '1rem 1.1rem',
      }}
    >
      <div className="eyebrow">Add a {workflow.contactNoun.toLowerCase()}</div>

      {/* Identity + intake */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {intakeCols.map((col) => (
          <FormField
            key={col.key}
            column={col}
            draft={draft}
            setDraft={setDraft}
            contactNoun={workflow.contactNoun}
            orgNoun={workflow.orgNoun}
            workflowKey={workflow.key}
          />
        ))}
      </div>

      {/* Hard qualifiers — collapsible visual section */}
      {qualifierCols.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
            paddingTop: '0.4rem',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontSize: '0.62rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            Hard qualifiers (optional now — refine on Qualify)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.55rem',
            }}
          >
            {qualifierCols.map((col) => (
              <QualifierField
                key={col.key}
                column={col}
                factor={workflow.factors.find((f) => f.key === col.key)}
                draft={draft}
                setDraft={setDraft}
                workflowKey={workflow.key}
              />
            ))}
          </div>
        </div>
      )}

      {/* Status toggle + override expansion */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          paddingTop: '0.5rem',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontSize: '0.62rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--text-faint)',
          }}
        >
          Status
        </div>
        <SourcingStatusToggle
          value={draft.sourcingStatus}
          onChange={(s) => setDraft((d) => ({ ...d, sourcingStatus: s }))}
        />
        <ScorePill score={liveScore} band={band} />
      </div>

      {override && (
        <OverrideExpansion
          status={draft.sourcingStatus}
          band={band}
          reason={draft.sourcingNote}
          setReason={(r) => setDraft((d) => ({ ...d, sourcingNote: r }))}
        />
      )}

      {/* Add button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          paddingTop: '0.3rem',
        }}
      >
        <button
          className="btn-primary"
          disabled={!canAdd}
          onClick={handleAdd}
          style={{ justifyContent: 'center' }}
        >
          {adding ? 'Adding…' : `Add ${workflow.contactNoun.toLowerCase()}`}
        </button>
        {!canAdd && !adding && (
          <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
            {draft.contactName.trim() === ''
              ? 'Name is required.'
              : draft.orgName.trim() === ''
                ? `${workflow.orgNoun ?? 'Agency'} is required.`
                : override && !reasonOk
                  ? `Override reason needs ${OVERRIDE_MIN_CHARS}+ characters.`
                  : ''}
          </span>
        )}
        {formError && (
          <span style={{ fontSize: '0.74rem', color: 'var(--bad)' }}>{formError}</span>
        )}
      </div>
    </div>
  );
}

/* Per-column input for the add form (intake columns: identity + sides/volume/sourceUrl). */
function FormField({
  column,
  draft,
  setDraft,
  contactNoun,
  orgNoun,
  workflowKey,
}: {
  column: SourcingColumn;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
  contactNoun: string;
  orgNoun: string | null;
  workflowKey: string;
}) {
  const fieldKey = column.key as keyof RowDraft;
  const current = String(draft[fieldKey] ?? '');

  let label = column.label;
  if (column.key === 'contactName') label = `${contactNoun} name`;
  if (column.key === 'orgName' && orgNoun) label = orgNoun;

  const required = column.key === 'contactName' || column.key === 'orgName';
  const inputType =
    column.kind === 'integer' || column.kind === 'currency'
      ? 'number'
      : column.kind === 'url'
        ? 'url'
        : 'text';

  return (
    <label style={{ display: 'block' }}>
      <span
        className="label"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}
      >
        <span>
          {label}
          {required && (
            <span style={{ color: 'var(--bad)', marginLeft: '0.2rem' }}>*</span>
          )}
        </span>
        <HelpBox
          workflowKey={workflowKey}
          factorKey={helpKeyForColumn(column.key)}
          mode="sourcing"
          label="What goes here?"
        />
      </span>
      <input
        className="input"
        type={inputType}
        inputMode={
          column.kind === 'integer'
            ? 'numeric'
            : column.kind === 'currency'
              ? 'decimal'
              : undefined
        }
        step={column.kind === 'currency' ? '0.01' : undefined}
        min={column.kind === 'integer' || column.kind === 'currency' ? 0 : undefined}
        value={current}
        onChange={(e) =>
          setDraft((d) => ({ ...d, [fieldKey]: e.target.value } as RowDraft))
        }
        placeholder={
          column.key === 'contactName'
            ? 'Jordan Avery'
            : column.help
              ? undefined
              : undefined
        }
      />
    </label>
  );
}

function QualifierField({
  column,
  factor,
  draft,
  setDraft,
  workflowKey,
}: {
  column: SourcingColumn;
  factor: RankFactor | undefined;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
  workflowKey: string;
}) {
  if (column.kind === 'bool') {
    const checked = draft.rankInputs[column.key] === true;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          fontSize: '0.78rem',
          color: 'var(--text)',
          padding: '0.5rem 0.6rem',
          borderRadius: 'var(--radius-sm)',
          background: checked ? 'var(--accent-dim)' : 'transparent',
          border: `1px solid ${checked ? 'var(--border-accent)' : 'var(--border)'}`,
        }}
      >
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                rankInputs: { ...d.rankInputs, [column.key]: e.target.checked },
              }))
            }
            style={{ accentColor: 'var(--accent)' }}
          />
          <span>{column.label}</span>
        </label>
        <HelpBox
          workflowKey={workflowKey}
          factorKey={helpKeyForColumn(column.key)}
          mode="sourcing"
          label="How to call it"
        />
      </div>
    );
  }
  // integer
  const value =
    typeof draft.rankInputs[column.key] === 'number'
      ? (draft.rankInputs[column.key] as number)
      : 0;
  return (
    <label style={{ display: 'block', fontSize: '0.78rem' }}>
      <span
        className="label"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}
      >
        <span>{column.label}</span>
        <HelpBox
          workflowKey={workflowKey}
          factorKey={helpKeyForColumn(column.key)}
          mode="sourcing"
          label="How to read it"
        />
      </span>
      <input
        type="number"
        min={0}
        value={value === 0 ? '' : value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          const clean = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
          setDraft((d) => ({
            ...d,
            rankInputs: { ...d.rankInputs, [column.key]: clean },
          }));
        }}
        className="input"
        placeholder={factor?.maxInput != null ? `≤${factor.maxInput}` : '0'}
      />
    </label>
  );
}

/* ── Filter bar ───────────────────────────────────────────────────── */

function FilterBar({
  statusFilter,
  onChange,
  counts,
}: {
  statusFilter: StatusFilter;
  onChange: (s: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
}) {
  const opts: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'undecided', label: 'Undecided' },
    { key: 'pursue', label: 'Pursued' },
    { key: 'qualify', label: 'Qualified' },
    { key: 'reject', label: 'Rejected' },
  ];

  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <span
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--text-faint)',
          marginRight: '0.25rem',
        }}
      >
        Filter
      </span>
      {opts.map((opt) => {
        const active = opt.key === statusFilter;
        const count = counts[opt.key] ?? 0;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${active ? 'var(--border-accent)' : 'var(--border)'}`,
              background: active ? 'var(--accent-dim)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-mid)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {opt.label}{' '}
            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {count}</span>
          </button>
        );
      })}
    </div>
  );
}

function statusCountsFor(rows: SourcingRow[]): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = {
    all: rows.length,
    undecided: 0,
    pursue: 0,
    qualify: 0,
    reject: 0,
  };
  for (const r of rows) {
    out[r.sourcingStatus] = (out[r.sourcingStatus] ?? 0) + 1;
  }
  return out;
}

/* ── Sorting helper ───────────────────────────────────────────────── */

function sortRows(rows: SourcingRow[], sort: SortState): SourcingRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last
    if (bv === null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return copy;
}

function sortValue(row: SourcingRow, key: SortKey): string | number | null {
  switch (key) {
    case 'rankScore':
      return row.rankScore;
    case 'contactName':
      return row.contactName;
    case 'orgName':
      return row.orgName;
    case 'marketArea':
      return row.marketArea;
    case 'grossVolume':
      return row.grossVolume;
    case 'sourcingStatus':
      return row.sourcingStatus;
    case 'createdAt':
      // ISO timestamps sort lexicographically the same way they sort
      // chronologically — string compare is fine. Default sort is
      // 'createdAt' desc, so a newly-saved prospect (whose createdAt
      // is "now") lands on top regardless of any prior sort the rep
      // toggled. (D-035.)
      return row.createdAt;
    default:
      // rank input — return the value if it's a number, else null
      const v = row.rankInputs[key];
      if (typeof v === 'number') return v;
      if (v === true) return 1;
      if (v === false) return 0;
      return null;
  }
}

/* ── Table ────────────────────────────────────────────────────────── */

function SourcingTable({
  workflow,
  rows,
  sort,
  onSortChange,
  activeRowId,
  setActiveRowId,
  rowErrors,
  onSave,
}: {
  workflow: SourcingWorkflow;
  rows: SourcingRow[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  activeRowId: string | null;
  setActiveRowId: (id: string | null) => void;
  rowErrors: Record<string, string>;
  onSave: (
    id: string | null,
    patch: UpsertSourcingRowInput,
  ) => Promise<SourcingRow | null>;
}) {
  const cols = workflow.columns;

  const template = useMemo(() => {
    // Column order: [Qualify button] [Score] [...workflow cols] [Actions]
    const parts: string[] = [`${QUALIFY_COL_WIDTH}px`, `${SCORE_COL_WIDTH}px`];
    for (const c of cols) parts.push(`${c.width}px`);
    parts.push(`${ACTIONS_COL_WIDTH}px`);
    return parts.join(' ');
  }, [cols]);

  return (
    <div className="surface-tool" style={{ padding: '0.5rem', overflowX: 'auto' }}>
      <div role="table" aria-label={`${workflow.name} sourcing`} style={{ minWidth: 'min-content' }}>
        <TableHeader
          template={template}
          columns={cols}
          sort={sort}
          onSortChange={onSortChange}
          workflowKey={workflow.key}
        />
        {rows.length === 0 ? (
          <div
            role="row"
            style={{
              padding: '1.5rem 0.75rem',
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            No matching prospects. Add one above or change the filter.
          </div>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              workflow={workflow}
              row={row}
              template={template}
              isActive={activeRowId === row.id}
              onActivate={() => setActiveRowId(row.id)}
              onDeactivate={() => setActiveRowId(null)}
              onSave={onSave}
              error={rowErrors[row.id]}
              anotherRowIsActive={activeRowId !== null && activeRowId !== row.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TableHeader({
  template,
  columns,
  sort,
  onSortChange,
  workflowKey,
}: {
  template: string;
  columns: SourcingColumn[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  workflowKey: string;
}) {
  function toggleSort(key: SortKey) {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key, dir: 'desc' });
    }
  }

  const cellBase: React.CSSProperties = {
    fontSize: '0.62rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 700,
    padding: '0.55rem 0.65rem',
    color: 'var(--text-faint)',
  };

  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: template,
        alignItems: 'end',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Qualify-button column — leftmost. Header reads "Qualify
          selection"; each row's cell holds the per-row button that
          opens /qualify/[id]. (D-042 placeholder; the actual
          one-click Qualify gating arrives in F6.) */}
      <div
        role="columnheader"
        style={{ ...cellBase, textAlign: 'center', lineHeight: 1.15 }}
      >
        Qualify
        <br />
        selection
      </div>
      <SortHeader
        label="Score"
        sortKey="rankScore"
        currentSort={sort}
        onClick={toggleSort}
        style={{ ...cellBase, textAlign: 'center' }}
      />
      {columns.map((c) => {
        const sortable = sortableKeyForColumn(c);
        const cellColor =
          c.group === 'qualifier' ? 'var(--accent)' : 'var(--text-faint)';
        // Each header cell holds the sort button (or static label) plus
        // an optional batch-sourcing HelpBox trigger. HelpBox renders
        // nothing when no entry exists for the column, so it's safe to
        // unconditionally pass every column through. (D-041.)
        return (
          <div
            key={c.key}
            role="columnheader"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.25rem',
              padding: '0.55rem 0.4rem',
              minWidth: 0,
            }}
          >
            {sortable ? (
              <SortHeader
                label={c.label}
                sortKey={sortable}
                currentSort={sort}
                onClick={toggleSort}
                style={{ ...cellBase, padding: 0, color: cellColor }}
                maxInput={c.maxInput ?? null}
              />
            ) : (
              <span style={{ ...cellBase, padding: 0, color: cellColor }}>
                {c.label}
              </span>
            )}
            <HelpBox
              workflowKey={workflowKey}
              factorKey={helpKeyForColumn(c.key)}
              mode="sourcing"
              label=""
            />
          </div>
        );
      })}
      <div role="columnheader" style={cellBase} aria-label="Actions">
        {/* pencil / check column */}
      </div>
    </div>
  );
}

function sortableKeyForColumn(c: SourcingColumn): SortKey | null {
  if (c.key === 'sourcingNote') return null;
  if (c.key === 'sourceUrl') return null;
  return c.key;
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  onClick,
  style,
  maxInput,
  title,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortState;
  onClick: (k: SortKey) => void;
  style: React.CSSProperties;
  maxInput?: number | null;
  title?: string;
}) {
  const active = currentSort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      title={title}
      style={{
        ...style,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: style.textAlign,
        color: active ? 'var(--text)' : style.color,
      }}
    >
      {label}
      {/* D-036: every sortable header carries a sort affordance.
         Active column shows ↑/↓; inactive columns show a low-opacity
         ↕ so reps can see at a glance which headers click-to-sort. */}
      <span
        aria-hidden
        style={{
          marginLeft: '0.25rem',
          opacity: active ? 1 : 0.4,
          fontSize: active ? 'inherit' : '0.85em',
        }}
      >
        {active ? (currentSort.dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
      {maxInput != null && (
        <span
          style={{
            fontWeight: 400,
            fontSize: '0.58rem',
            color: 'var(--text-faint)',
            letterSpacing: 'normal',
            textTransform: 'none',
            marginLeft: '0.25rem',
          }}
        >
          · ≤{maxInput}
        </span>
      )}
    </button>
  );
}

/* ── A single row — display or edit mode based on `isActive` ──────── */

function TableRow({
  workflow,
  row,
  template,
  isActive,
  onActivate,
  onDeactivate,
  onSave,
  error,
  anotherRowIsActive,
}: {
  workflow: SourcingWorkflow;
  row: SourcingRow;
  template: string;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onSave: (
    id: string | null,
    patch: UpsertSourcingRowInput,
  ) => Promise<SourcingRow | null>;
  error?: string;
  anotherRowIsActive: boolean;
}) {
  // Local draft is reset every time the row enters edit mode (see
  // handleActivate). Between edits, the displayed values come straight
  // from `row` via renderDisplay — so a server-side score recompute
  // (from another rep editing the rank-factor config, say) shows up
  // without needing a draft re-sync here.
  //
  // V2 (D-037, D-039): status toggle + bool checkboxes commit IMMEDIATELY
  // and never live in the draft. Edit mode (pencil) only unlocks the
  // first-class non-control cells (name / agency / market / sides /
  // gross_volume / source_url) for in-place edit. Integer rank inputs
  // are also still draft+save (typing into them every keystroke would
  // spam the server).
  const router = useRouter();
  const [draft, setDraft] = useState<RowDraft>(() => draftFromRow(row));
  const [busy, setBusy] = useState(false);

  // Pending-status flow: when clicking a status button would create an
  // override case (the rep's call disagrees with the band), we don't
  // commit immediately. Instead we surface the inline override panel,
  // collect the ≥20-char reason, and commit on Confirm. Cancel restores
  // the saved status.
  const [pendingStatus, setPendingStatus] = useState<SourcingStatus | null>(null);
  const [pendingReason, setPendingReason] = useState('');
  const [pendingBusy, setPendingBusy] = useState(false);

  const band = classifyBand(row.rankScore, workflow.bands);
  // D-045 options reused at every needsOverride call site in the row —
  // the row's saved rank_inputs + the full factor key set.
  const overrideOpts = {
    rankInputs: row.rankInputs,
    factorKeys: workflow.factors.map((f) => f.key),
  };
  const pendingReasonOk =
    pendingStatus === null ||
    !needsOverride(pendingStatus, band, overrideOpts) ||
    pendingReason.trim().length >= OVERRIDE_MIN_CHARS;

  // What the status toggle visually reflects — pending takes precedence
  // so the rep sees their in-flight choice while filling the reason.
  const visibleStatus: SourcingStatus = pendingStatus ?? row.sourcingStatus;

  const handleActivate = useCallback(() => {
    setDraft(draftFromRow(row));
    onActivate();
  }, [onActivate, row]);

  /** Save first-class non-control cell edits. Status + bool rank inputs
   * are NOT included — they commit immediately at click time and the
   * server already has them. */
  const commit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Only include integer rank-input patches — bool ones committed
      // already via handleBoolChange.
      const integerRankPatches: Record<string, number> = {};
      for (const f of workflow.factors) {
        if (f.kind === 'bool') continue;
        const v = draft.rankInputs[f.key];
        if (typeof v === 'number') integerRankPatches[f.key] = v;
      }
      const patch: UpsertSourcingRowInput = {
        id: row.id,
        contactName: draft.contactName,
        orgName: draft.orgName || null,
        marketArea: draft.marketArea || null,
        sidesCount: parseIntOrNull(draft.sidesCount),
        grossVolume: parseFloatOrNull(draft.grossVolume),
        sourceUrl: draft.sourceUrl || null,
        rankInputPatches: integerRankPatches,
      };
      await onSave(row.id, patch);
      onDeactivate();
    } finally {
      setBusy(false);
    }
  }, [busy, draft, onDeactivate, onSave, row.id, workflow.factors]);

  function handleCancel() {
    setDraft(draftFromRow(row));
    onDeactivate();
  }

  /** Row body click — navigate to /qualify/[id] when the row isn't in
   * edit mode and no override is pending. (D-039.) */
  function handleNavigate() {
    if (isActive) return;
    if (pendingStatus !== null) return;
    if (anotherRowIsActive) return;
    router.push(`/qualify/${row.id}`);
  }

  /** Status toggle click — immediate commit if no override needed;
   * otherwise surface the inline override panel and wait for the
   * rep's reason. (D-037.) */
  async function handleStatusChange(next: SourcingStatus) {
    if (next === row.sourcingStatus) {
      // Re-click on the current status — clear any pending state.
      setPendingStatus(null);
      setPendingReason('');
      return;
    }
    if (needsOverride(next, band, overrideOpts)) {
      setPendingStatus(next);
      setPendingReason('');
      return;
    }
    setBusy(true);
    try {
      await onSave(row.id, { id: row.id, sourcingStatus: next });
      setPendingStatus(null);
      setPendingReason('');
    } finally {
      setBusy(false);
    }
  }

  async function handlePendingConfirm() {
    if (pendingStatus === null) return;
    if (!pendingReasonOk) return;
    setPendingBusy(true);
    try {
      await onSave(row.id, {
        id: row.id,
        sourcingStatus: pendingStatus,
        sourcingNote: pendingReason.trim(),
      });
      setPendingStatus(null);
      setPendingReason('');
    } finally {
      setPendingBusy(false);
    }
  }

  function handlePendingCancel() {
    setPendingStatus(null);
    setPendingReason('');
  }

  /** Bool rank-input checkbox click — immediate commit. (D-037.) */
  async function handleBoolChange(key: string, next: boolean) {
    setBusy(true);
    try {
      await onSave(row.id, {
        id: row.id,
        rankInputPatches: { [key]: next },
      });
    } finally {
      setBusy(false);
    }
  }

  /* Row editability — clicking anywhere on the row body that isn't an
     interactive control activates edit mode. The leftmost Qualify
     button and the Name cell are the two exceptions that navigate to
     /qualify/[id] instead. Edit mode, pending-override, or another
     active row all suspend the activate-on-click so the rep can
     finish what they're doing. (Supersedes D-039: row body
     navigates → row body activates edit; the explicit Qualify
     column carries the navigate intent.) */
  const editable = !isActive && pendingStatus === null && !anotherRowIsActive;

  /* Row styling — gutter above/below when active, plus a soft background
     tint so clicking off feels intentional. */
  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: template,
    alignItems: 'stretch',
    borderBottom: '1px solid var(--border)',
    opacity: row.sourcingStatus === 'reject' && !isActive ? 0.55 : 1,
    cursor: editable ? 'pointer' : 'default',
  };
  const wrapperStyle: React.CSSProperties = isActive
    ? {
        padding: '10px 0',
        background: 'var(--steel-dim)',
        borderRadius: 'var(--radius-sm)',
        margin: '4px 0',
        border: '1px solid var(--border-accent)',
      }
    : {};

  return (
    <div style={wrapperStyle}>
      <div
        role="row"
        style={rowStyle}
        onClick={editable ? handleActivate : undefined}
        data-tooltip={editable ? 'Click to edit' : undefined}
        data-tooltip-pos="below"
      >
        <QualifyButtonCell onNavigate={handleNavigate} />
        <ScoreCell row={row} bands={workflow.bands} />
        {workflow.columns.map((col) => (
          <RowCell
            key={col.key}
            column={col}
            factor={
              col.isRankInput ? workflow.factors.find((f) => f.key === col.key) : undefined
            }
            row={row}
            draft={draft}
            setDraft={setDraft}
            isActive={isActive}
            visibleStatus={visibleStatus}
            onStatusChange={handleStatusChange}
            onBoolChange={handleBoolChange}
            onNavigate={handleNavigate}
          />
        ))}
        <ActionsCell
          isActive={isActive}
          busy={busy}
          canSave
          onSave={commit}
          onCancel={handleCancel}
        />
      </div>
      {pendingStatus !== null && needsOverride(pendingStatus, band, overrideOpts) && (
        <div
          style={{ padding: '0.4rem 0.6rem' }}
          onClick={(e) => e.stopPropagation()}
        >
          <OverrideExpansion
            status={pendingStatus}
            band={band}
            reason={pendingReason}
            setReason={setPendingReason}
          />
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
              marginTop: '0.55rem',
            }}
          >
            <button
              type="button"
              onClick={handlePendingCancel}
              className="btn-ghost"
              disabled={pendingBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePendingConfirm}
              className="btn-primary"
              disabled={!pendingReasonOk || pendingBusy}
              style={{ padding: '0.45rem 1rem', fontSize: '0.7rem' }}
            >
              Save with reason
            </button>
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            fontSize: '0.74rem',
            color: 'var(--bad)',
            padding: '0.3rem 0.65rem 0.55rem',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

/* Per-cell rendering. V2 behavior (D-037, D-039):
   - Status toggle + bool rank-input checkboxes are ALWAYS interactive
     and commit immediately on click. They live outside the draft.
   - Integer rank-input cells display read-only until the pencil
     unlocks edit mode (typing a number on every keystroke would spam
     the server — these stay draft+save).
   - First-class text cells (name, agency, market, gross_volume,
     source_url) also stay draft+save.
   - Display-mode cells no longer activate edit on click; the row's
     own onClick handles navigation to /qualify/[id]. Edit-mode cells
     stop propagation so typing doesn't trigger navigation. */
function RowCell({
  column,
  factor,
  row,
  draft,
  setDraft,
  isActive,
  visibleStatus,
  onStatusChange,
  onBoolChange,
  onNavigate,
}: {
  column: SourcingColumn;
  factor: RankFactor | undefined;
  row: SourcingRow;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
  isActive: boolean;
  visibleStatus: SourcingStatus;
  onStatusChange: (next: SourcingStatus) => void;
  onBoolChange: (key: string, next: boolean) => void;
  onNavigate: () => void;
}) {
  // Primary cell (Name) — always a navigation link to /qualify/[id]
  // regardless of edit mode. The name is not editable from Sourcing
  // (rep edits it on Qualify if it ever needs to change). The
  // leftmost Qualify button + this cell are the two row exceptions
  // that navigate instead of activating edit (F2.8.1).
  if (column.isPrimary) {
    return (
      <div
        role="cell"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        data-tooltip="Open in Qualify"
        data-tooltip-pos="below"
        style={{
          padding: '0.55rem 0.65rem',
          fontSize: '0.85rem',
          fontWeight: 500,
          color: 'var(--accent)',
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationColor: 'var(--border-accent)',
          textUnderlineOffset: '0.2rem',
          textDecorationStyle: 'dotted',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: 1.3,
        }}
      >
        {row.contactName || <Dim>—</Dim>}
      </div>
    );
  }

  // Status cell — always renders the toggle (D-037). Stop propagation
  // so clicking a status button doesn't also trigger row navigation.
  if (column.key === 'sourcingStatus') {
    return (
      <div
        role="cell"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.3rem 0.4rem',
          cursor: 'default',
        }}
      >
        <SourcingStatusToggle value={visibleStatus} onChange={onStatusChange} />
      </div>
    );
  }

  // Bool rank-input cell — always interactive (D-037).
  if (column.isRankInput && column.kind === 'bool') {
    const liveChecked = row.rankInputs[column.key] === true;
    return (
      <div
        role="cell"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.3rem 0.4rem',
          cursor: 'default',
        }}
      >
        <input
          type="checkbox"
          checked={liveChecked}
          onChange={(e) => onBoolChange(column.key, e.target.checked)}
          aria-label={column.label}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
      </div>
    );
  }

  // Integer rank-input cell — display-only until edit mode unlocks it.
  if (column.isRankInput && column.kind === 'integer') {
    if (!isActive) {
      const liveValue =
        typeof row.rankInputs[column.key] === 'number'
          ? (row.rankInputs[column.key] as number)
          : 0;
      return (
        <DisplayCell align="right">
          {liveValue > 0 ? String(liveValue) : <Dim>—</Dim>}
        </DisplayCell>
      );
    }
    const draftValue =
      typeof draft.rankInputs[column.key] === 'number'
        ? (draft.rankInputs[column.key] as number)
        : 0;
    return (
      <div
        role="cell"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '0.3rem 0.4rem' }}
      >
        <input
          type="number"
          min={0}
          value={draftValue === 0 ? '' : draftValue}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            const clean = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
            setDraft((d) => ({
              ...d,
              rankInputs: { ...d.rankInputs, [column.key]: clean },
            }));
          }}
          className="input"
          aria-label={column.label}
          placeholder={factor?.maxInput != null ? `≤${factor.maxInput}` : '0'}
          style={cellInputStyle}
        />
      </div>
    );
  }

  // First-class text / number / currency / url cell.
  const fieldKey = column.key as keyof RowDraft;
  const liveValue = isActive ? String(draft[fieldKey] ?? '') : '';
  const displayValue = renderDisplay(column, row);

  if (!isActive) {
    // Display-only; the row's onClick handles navigation. The
    // `anotherRowIsActive` ref is unused here — display cells no
    // longer activate edit on click (D-039).
    return <DisplayCell>{displayValue}</DisplayCell>;
  }

  const inputType =
    column.kind === 'integer' || column.kind === 'currency'
      ? 'number'
      : column.kind === 'url'
        ? 'url'
        : 'text';

  return (
    <div
      role="cell"
      onClick={(e) => e.stopPropagation()}
      style={{ padding: '0.3rem 0.4rem' }}
    >
      <input
        type={inputType}
        inputMode={
          column.kind === 'integer'
            ? 'numeric'
            : column.kind === 'currency'
              ? 'decimal'
              : undefined
        }
        step={column.kind === 'currency' ? '0.01' : undefined}
        min={column.kind === 'integer' || column.kind === 'currency' ? 0 : undefined}
        value={liveValue}
        onChange={(e) =>
          setDraft((d) => ({ ...d, [fieldKey]: e.target.value } as RowDraft))
        }
        aria-label={column.label}
        className="input"
        style={cellInputStyle}
      />
    </div>
  );
}

function renderDisplay(column: SourcingColumn, row: SourcingRow): React.ReactNode {
  const fieldKey = column.key as keyof SourcingRow;
  const value = row[fieldKey];
  if (value === null || value === undefined || value === '') return <Dim>—</Dim>;
  if (column.kind === 'currency' && typeof value === 'number') return formatMoney(value);
  if (column.kind === 'url' && typeof value === 'string') return prettyUrl(value);
  return String(value);
}

function DisplayCell({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  // V2: display cells are no longer click-to-edit (D-039). The row's
  // own onClick handles navigation to /qualify/[id]; the cell just
  // inherits the row's cursor so the pointer affordance reads right.
  return (
    <div
      role="cell"
      style={{
        padding: '0.55rem 0.65rem',
        fontSize: '0.82rem',
        color: 'var(--text)',
        cursor: 'inherit',
        textAlign: align ?? 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        lineHeight: 1.3,
      }}
    >
      {children}
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--text-faint)' }}>{children}</span>;
}

const cellInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.35rem 0.45rem',
  fontSize: '0.82rem',
};

/* ── Save / Cancel column (edit mode only) ───────────────────────── */
/* Display mode renders an empty cell — the row-body click is the
   edit trigger now (F2.8.1 replaces the pencil-as-edit-trigger). */

function ActionsCell({
  isActive,
  busy,
  canSave,
  onSave,
  onCancel,
}: {
  isActive: boolean;
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="cell"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.25rem',
        padding: '0.3rem',
        cursor: 'default',
      }}
    >
      {isActive && (
        <>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !canSave}
            aria-label="Save row"
            data-tooltip={canSave ? 'Save edits' : 'Resolve the validation issue first'}
            style={{
              width: 26,
              height: 26,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: canSave ? 'var(--good)' : 'var(--steel-dim)',
              color: canSave ? 'white' : 'var(--text-faint)',
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel edits"
            data-tooltip="Discard edits"
            style={{
              width: 22,
              height: 22,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--text-faint)',
              cursor: 'pointer',
              fontSize: '0.7rem',
            }}
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

/* ── Qualify button column (leftmost) ─────────────────────────────── */
/* Per-row navigate-to-/qualify/[id] button. Sits in the new leftmost
   column; the header above reads "Qualify selection." Stop-propagates
   the click so the row-body activate-edit doesn't also fire. */

function QualifyButtonCell({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div
      role="cell"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.3rem',
        cursor: 'default',
      }}
    >
      <button
        type="button"
        onClick={onNavigate}
        aria-label="Open in Qualify"
        data-tooltip="Open in Qualify"
        style={{
          width: 32,
          height: 26,
          border: '1px solid var(--border-accent)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        →
      </button>
    </div>
  );
}

/* ── Score cell ───────────────────────────────────────────────────── */

function ScoreCell({ row, bands }: { row: SourcingRow; bands: RankBands }) {
  const band = classifyBand(row.rankScore, bands);
  const color =
    band === 'qualified'
      ? 'var(--good)'
      : band === 'borderline'
        ? 'var(--warn)'
        : 'var(--text-faint)';
  return (
    <div
      role="cell"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.55rem 0.3rem',
        position: 'relative',
      }}
      data-tooltip={
        row.hasPartialScore
          ? 'Partial — supporting factors fill in on Qualify.'
          : 'No qualifiers filled yet.'
      }
      data-tooltip-pos="below"
    >
      <span
        className="money"
        style={{ fontSize: '1.05rem', color, fontWeight: 600 }}
      >
        {row.rankScore.toFixed(1)}
      </span>
      {row.hasPartialScore && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 4,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent)',
            opacity: 0.7,
          }}
        />
      )}
    </div>
  );
}

/* ── Status toggle — interactive in display + edit mode (D-037) ──── */

function SourcingStatusToggle({
  value,
  onChange,
}: {
  value: SourcingStatus;
  onChange: (s: SourcingStatus) => void;
}) {
  /* Sourcing exposes Pursue / Undecided / Reject — never `qualify`,
     which is reserved for the /qualify page. If a row's current value
     is 'qualify' (set from /qualify), show none of the Sourcing buttons
     as active and let the rep pick a fresh sourcing call if they want. */
  const opts: SourcingStatus[] = ['pursue', 'undecided', 'reject'];
  return (
    <div
      role="group"
      aria-label="Status"
      style={{
        display: 'inline-flex',
        gap: 2,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 2,
      }}
    >
      {opts.map((opt) => {
        const active = opt === value;
        const color =
          opt === 'pursue'
            ? 'var(--good)'
            : opt === 'reject'
              ? 'var(--bad)'
              : 'var(--text-faint)';
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            data-tooltip={
              opt === 'pursue'
                ? 'Worth qualifying — keeps stage at Researching'
                : opt === 'reject'
                  ? 'Not worth pursuing — moves stage to Rejected'
                  : 'Park as undecided'
            }
            style={{
              fontSize: '0.66rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '0.28rem 0.45rem',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: active ? `${color}22` : 'transparent',
              color: active ? color : 'var(--text-faint)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {STATUS_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}

function ScorePill({ score, band }: { score: number; band: ScoreBand }) {
  const color =
    band === 'qualified'
      ? 'var(--good)'
      : band === 'borderline'
        ? 'var(--warn)'
        : 'var(--text-faint)';
  return (
    <span
      style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        color,
        padding: '0.2rem 0.55rem',
        borderRadius: 'var(--radius-sm)',
        background: `${color}11`,
        border: `1px solid ${color}33`,
      }}
    >
      <span className="money" style={{ fontWeight: 700 }}>
        {score.toFixed(1)}
      </span>
      <span style={{ color: 'var(--text-faint)', marginLeft: '0.3rem' }}>
        / 10
      </span>
    </span>
  );
}

/* ── Override expansion ──────────────────────────────────────────── */

function OverrideExpansion({
  status,
  band,
  reason,
  setReason,
}: {
  status: SourcingStatus;
  band: ScoreBand;
  reason: string;
  setReason: (r: string) => void;
}) {
  const reasonOk = reason.trim().length >= OVERRIDE_MIN_CHARS;
  const bandLabel =
    band === 'qualified' ? 'Qualified' : band === 'reject' ? 'Below the bar' : 'Borderline';
  const statusLabel = STATUS_LABEL[status];
  return (
    <div
      role="region"
      aria-label="Override reason"
      style={{
        padding: '0.7rem',
        background: 'var(--steel-dim)',
        borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--border-accent)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem',
      }}
    >
      <p style={{ fontSize: '0.76rem', color: 'var(--warn)', margin: 0 }}>
        Pre-score band is <strong>{bandLabel}</strong>. You picked{' '}
        <strong>{statusLabel}</strong>. Drop a reason — at least{' '}
        {OVERRIDE_MIN_CHARS} characters.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="What I saw that the numbers didn't catch."
        className="input"
        style={{
          width: '100%',
          padding: '0.45rem',
          fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
          fontSize: '0.82rem',
          lineHeight: 1.4,
          resize: 'vertical',
        }}
      />
      <div style={{ fontSize: '0.7rem', color: reasonOk ? 'var(--text-faint)' : 'var(--warn)' }}>
        {reason.trim().length} chars
        {reasonOk
          ? ' · enough'
          : ` · ${OVERRIDE_MIN_CHARS - reason.trim().length} more`}
      </div>
    </div>
  );
}

/* ── Live score helper (matches scoreProspect math; client-side preview). ── */

function computeLiveScore(
  workflow: SourcingWorkflow,
  inputs: Record<string, boolean | number>,
): number {
  let total = 0;
  for (const f of workflow.factors) {
    if (f.kind === 'bool') {
      if (inputs[f.key] === true) total += f.weight;
    } else {
      const v = typeof inputs[f.key] === 'number' ? (inputs[f.key] as number) : 0;
      if (f.key === 'annual_volume') {
        // Mirror lib/prospects.ts PIECEWISE_CURVES.annual_volume.
        if (v <= 0) total += 0;
        else if (v <= 10) total += (v / 10) * 2;
        else if (v <= 30) total += 2 + (v - 10) / 20;
        else total += 3;
      } else {
        const max = f.maxInput ?? 0;
        if (max > 0) {
          const clamped = Math.min(Math.max(v, 0), max);
          total += f.weight * (clamped / max);
        }
      }
    }
  }
  // Normalize to 0-10 (mirrors scoreProspect).
  const totalWeight = workflow.factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight <= 0) return 0;
  return Math.round((total / totalWeight) * 10 * 10) / 10;
}
