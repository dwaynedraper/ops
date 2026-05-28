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
import {
  classifyBand,
  type RankBands,
  type RankFactor,
  type ScoreBand,
} from '@/lib/prospects';
import {
  type SourcingColumn,
  type SourcingRow,
  type SourcingStatus,
} from '@/lib/sourcing';
import { upsertSourcingRow, type UpsertSourcingRowInput } from './actions';

const OVERRIDE_MIN_CHARS = 20;
const SCORE_COL_WIDTH = 80;
const ACTIONS_COL_WIDTH = 56;

const STATUS_LABEL: Record<SourcingStatus, string> = {
  undecided: '—',
  pursue: 'Pursue',
  qualify: 'Qualify',
  reject: 'Reject',
};

function isPositive(status: SourcingStatus): boolean {
  return status === 'pursue' || status === 'qualify';
}

/** Mirror of the server-side override rule. */
function needsOverride(status: SourcingStatus, band: ScoreBand): boolean {
  if (status === 'undecided') return false;
  if (band === 'qualified' && status === 'reject') return true;
  if (band === 'reject' && isPositive(status)) return true;
  return false;
}

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
  const override = needsOverride(draft.sourcingStatus, band);
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
}: {
  column: SourcingColumn;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
  contactNoun: string;
  orgNoun: string | null;
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
      <span className="label">
        {label}
        {required && (
          <span style={{ color: 'var(--bad)', marginLeft: '0.2rem' }}>*</span>
        )}
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
}: {
  column: SourcingColumn;
  factor: RankFactor | undefined;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
}) {
  if (column.kind === 'bool') {
    const checked = draft.rankInputs[column.key] === true;
    return (
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          fontSize: '0.78rem',
          color: 'var(--text)',
          padding: '0.5rem 0.6rem',
          borderRadius: 'var(--radius-sm)',
          background: checked ? 'var(--accent-dim)' : 'transparent',
          border: `1px solid ${checked ? 'var(--border-accent)' : 'var(--border)'}`,
          cursor: 'pointer',
        }}
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
    );
  }
  // integer
  const value =
    typeof draft.rankInputs[column.key] === 'number'
      ? (draft.rankInputs[column.key] as number)
      : 0;
  return (
    <label style={{ display: 'block', fontSize: '0.78rem' }}>
      <span className="label">{column.label}</span>
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
      // SourcingRow doesn't carry createdAt; fall back to id (uuid ordering
      // isn't time-based — but the parent list comes from the server
      // pre-sorted by created_at DESC, so the initial position is the
      // proxy). For now sort by id which is stable.
      return row.id;
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
    const parts: string[] = [`${SCORE_COL_WIDTH}px`];
    for (const c of cols) parts.push(`${c.width}px`);
    parts.push(`${ACTIONS_COL_WIDTH}px`);
    return parts.join(' ');
  }, [cols]);

  return (
    <div className="surface-tool" style={{ padding: '0.5rem', overflowX: 'auto' }}>
      <div role="table" aria-label={`${workflow.name} sourcing`} style={{ minWidth: 'min-content' }}>
        <TableHeader template={template} columns={cols} sort={sort} onSortChange={onSortChange} />
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
}: {
  template: string;
  columns: SourcingColumn[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
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
      <SortHeader
        label="Score"
        sortKey="rankScore"
        currentSort={sort}
        onClick={toggleSort}
        style={{ ...cellBase, textAlign: 'center' }}
      />
      {columns.map((c) => {
        const sortable = sortableKeyForColumn(c);
        return sortable ? (
          <SortHeader
            key={c.key}
            label={c.label}
            sortKey={sortable}
            currentSort={sort}
            onClick={toggleSort}
            style={{
              ...cellBase,
              color: c.group === 'qualifier' ? 'var(--accent)' : 'var(--text-faint)',
            }}
            maxInput={c.maxInput ?? null}
            title={c.help ?? undefined}
          />
        ) : (
          <div
            role="columnheader"
            key={c.key}
            style={{
              ...cellBase,
              color: c.group === 'qualifier' ? 'var(--accent)' : 'var(--text-faint)',
            }}
            title={c.help ?? undefined}
          >
            {c.label}
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
      {active && (
        <span aria-hidden style={{ marginLeft: '0.25rem' }}>
          {currentSort.dir === 'asc' ? '↑' : '↓'}
        </span>
      )}
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
  const [draft, setDraft] = useState<RowDraft>(() => draftFromRow(row));
  const [busy, setBusy] = useState(false);

  const band = classifyBand(row.rankScore, workflow.bands);
  const override = needsOverride(draft.sourcingStatus, band);
  const reasonOk = !override || draft.sourcingNote.trim().length >= OVERRIDE_MIN_CHARS;

  const handleActivate = useCallback(() => {
    setDraft(draftFromRow(row));
    onActivate();
  }, [onActivate, row]);

  const commit = useCallback(async () => {
    if (busy) return;
    if (!reasonOk) return;
    setBusy(true);
    try {
      const patch: UpsertSourcingRowInput = {
        id: row.id,
        contactName: draft.contactName,
        orgName: draft.orgName || null,
        marketArea: draft.marketArea || null,
        sidesCount: parseIntOrNull(draft.sidesCount),
        grossVolume: parseFloatOrNull(draft.grossVolume),
        sourceUrl: draft.sourceUrl || null,
        sourcingStatus: draft.sourcingStatus,
        sourcingNote: override ? draft.sourcingNote.trim() : null,
        rankInputPatches: draft.rankInputs,
      };
      await onSave(row.id, patch);
      onDeactivate();
    } finally {
      setBusy(false);
    }
  }, [busy, draft, onDeactivate, onSave, override, reasonOk, row.id]);

  function handleCancel() {
    setDraft(draftFromRow(row));
    onDeactivate();
  }

  /* Row styling — gutter above/below when active, plus a soft background
     tint so clicking off feels intentional. */
  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: template,
    alignItems: 'stretch',
    borderBottom: '1px solid var(--border)',
    opacity: row.sourcingStatus === 'reject' && !isActive ? 0.55 : 1,
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
      <div role="row" style={rowStyle}>
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
            onActivate={handleActivate}
            anotherRowIsActive={anotherRowIsActive}
          />
        ))}
        <ActionsCell
          isActive={isActive}
          busy={busy}
          canSave={reasonOk}
          onEdit={handleActivate}
          onSave={commit}
          onCancel={handleCancel}
        />
      </div>
      {isActive && override && (
        <div style={{ padding: '0.4rem 0.6rem' }}>
          <OverrideExpansion
            status={draft.sourcingStatus}
            band={band}
            reason={draft.sourcingNote}
            setReason={(r) => setDraft((d) => ({ ...d, sourcingNote: r }))}
          />
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

/* Per-cell rendering — read-only display when row isn't active,
   input when row is active. */
function RowCell({
  column,
  factor,
  row,
  draft,
  setDraft,
  isActive,
  onActivate,
  anotherRowIsActive,
}: {
  column: SourcingColumn;
  factor: RankFactor | undefined;
  row: SourcingRow;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
  isActive: boolean;
  onActivate: () => void;
  anotherRowIsActive: boolean;
}) {
  // Status cell renders as toggle when active, label-pill when locked.
  if (column.key === 'sourcingStatus') {
    if (!isActive) {
      return (
        <div
          role="cell"
          style={{ display: 'flex', alignItems: 'center', padding: '0.55rem 0.5rem' }}
        >
          <StatusPill value={row.sourcingStatus} />
        </div>
      );
    }
    return (
      <div
        role="cell"
        style={{ display: 'flex', alignItems: 'center', padding: '0.3rem 0.4rem' }}
      >
        <SourcingStatusToggle
          value={draft.sourcingStatus}
          onChange={(s) => setDraft((d) => ({ ...d, sourcingStatus: s }))}
        />
      </div>
    );
  }

  // Bool rank-input cell: checkbox when active, ✓/— when locked.
  if (column.isRankInput && column.kind === 'bool') {
    const liveChecked = isActive
      ? draft.rankInputs[column.key] === true
      : row.rankInputs[column.key] === true;
    if (!isActive) {
      return (
        <div
          role="cell"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.55rem 0.4rem',
            color: liveChecked ? 'var(--good)' : 'var(--text-faint)',
            fontSize: '0.95rem',
          }}
        >
          {liveChecked ? '✓' : '—'}
        </div>
      );
    }
    return (
      <div
        role="cell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.3rem 0.4rem',
        }}
      >
        <input
          type="checkbox"
          checked={liveChecked}
          onChange={(e) => {
            const next = e.target.checked;
            setDraft((d) => ({
              ...d,
              rankInputs: { ...d.rankInputs, [column.key]: next },
            }));
          }}
          aria-label={column.label}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
        />
      </div>
    );
  }

  // Integer rank-input cell.
  if (column.isRankInput && column.kind === 'integer') {
    const liveValue = isActive
      ? typeof draft.rankInputs[column.key] === 'number'
        ? (draft.rankInputs[column.key] as number)
        : 0
      : typeof row.rankInputs[column.key] === 'number'
        ? (row.rankInputs[column.key] as number)
        : 0;
    if (!isActive) {
      return (
        <DisplayCell
          onClick={anotherRowIsActive ? undefined : onActivate}
          align="right"
        >
          {liveValue > 0 ? String(liveValue) : <Dim>—</Dim>}
        </DisplayCell>
      );
    }
    return (
      <div role="cell" style={{ padding: '0.3rem 0.4rem' }}>
        <input
          type="number"
          min={0}
          value={liveValue === 0 ? '' : liveValue}
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
    return (
      <DisplayCell onClick={anotherRowIsActive ? undefined : onActivate}>
        {displayValue}
      </DisplayCell>
    );
  }

  const inputType =
    column.kind === 'integer' || column.kind === 'currency'
      ? 'number'
      : column.kind === 'url'
        ? 'url'
        : 'text';

  return (
    <div role="cell" style={{ padding: '0.3rem 0.4rem' }}>
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
  onClick,
  align,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <div
      role="cell"
      onClick={onClick}
      style={{
        padding: '0.55rem 0.65rem',
        fontSize: '0.82rem',
        color: 'var(--text)',
        cursor: onClick ? 'pointer' : 'default',
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

/* ── Pencil / check column ───────────────────────────────────────── */

function ActionsCell({
  isActive,
  busy,
  canSave,
  onEdit,
  onSave,
  onCancel,
}: {
  isActive: boolean;
  busy: boolean;
  canSave: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="cell"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.25rem',
        padding: '0.3rem',
      }}
    >
      {isActive ? (
        <>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !canSave}
            aria-label="Save row"
            title="Save"
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
            title="Cancel"
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
      ) : (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit row"
          title="Edit"
          style={{
            width: 24,
            height: 24,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--text-mid)',
            cursor: 'pointer',
            fontSize: '0.74rem',
          }}
        >
          ✎
        </button>
      )}
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
      title={
        row.hasPartialScore
          ? 'Partial — supporting factors fill in on Qualify.'
          : 'No qualifiers filled yet.'
      }
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

/* ── Status pill (locked rows) + Status toggle (active rows + form) ── */

function StatusPill({ value }: { value: SourcingStatus }) {
  const color =
    value === 'pursue' || value === 'qualify'
      ? 'var(--good)'
      : value === 'reject'
        ? 'var(--bad)'
        : 'var(--text-faint)';
  return (
    <span
      style={{
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '0.25rem 0.55rem',
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        color,
        background: `${color}11`,
      }}
    >
      {STATUS_LABEL[value]}
    </span>
  );
}

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
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '0.3rem 0.55rem',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: active ? `${color}22` : 'transparent',
              color: active ? color : 'var(--text-faint)',
              cursor: 'pointer',
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
