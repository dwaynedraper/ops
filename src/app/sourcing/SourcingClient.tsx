'use client';

/**
 * Sourcing client — the spreadsheet-style triage surface.
 *
 * A rep picks a workflow, then enters rows into a grid: identity, the
 * workflow's intake fields (RealTrends-style sides/volume on
 * real-estate), the hard qualifiers (gates + ≥3pt scoring factors),
 * the source URL, the Qualify / Pass / Undecided status toggle, and a
 * one-line note. Every cell autosaves on blur (D-024). The pre-score
 * badge is advisory (D-028) — the toggle is the rep's call.
 *
 * State model:
 *   - `rows` is the saved-state cache from the server, keyed by id.
 *   - Each DataRow holds its own local draft state for its inputs and
 *     dispatches `onSave(id, patch)` on cell blur if the draft diverged.
 *   - The bottom DraftRow has no id; first save creates the prospect
 *     and the new row prepends to `rows`.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
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

/** What the pre-score band recommends — null = no recommendation
 * (borderline). Mirrors the server's `recommendedStatus`. */
function recommendedStatus(band: ScoreBand): SourcingStatus | null {
  if (band === 'qualified') return 'qualify';
  if (band === 'reject') return 'pass';
  return null;
}

/** True when the chosen status contradicts the band's recommendation.
 * `undecided` is parking — never counts. */
function needsOverride(status: SourcingStatus, band: ScoreBand): boolean {
  const rec = recommendedStatus(band);
  if (rec === null) return false;
  if (status === 'undecided') return false;
  return status !== rec;
}

/** Format a number as USD with no decimal places — used for the locked
 * gross-volume cell. */
function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Strip scheme and trailing slash for a tidy locked URL display. */
function prettyUrl(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/\/$/, '');
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

const STATUS_LABEL: Record<SourcingStatus, string> = {
  qualify: 'Qualify',
  pass: 'Pass',
  undecided: '—',
};

/* ── Draft state ─────────────────────────────────────────────────── */

/** Local draft of a row's cells. Mirrors SourcingRow but every column
 * may be staged before it hits the server. */
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
  const [errors, setErrors] = useState<Record<string, string>>({});

  const wf = workflows.find((w) => w.key === selectedKey) ?? workflows[0] ?? null;

  // Helpers usable by row components — wrapped in useCallback so the
  // child DataRows aren't fighting referential equality.
  const handleSave = useCallback(
    async (
      id: string | null,
      patch: UpsertSourcingRowInput,
    ): Promise<SourcingRow | null> => {
      const res = await upsertSourcingRow(patch);
      if (res.ok && res.row) {
        // Update / insert into local cache.
        setRows((prev) => {
          const idx = prev.findIndex((r) => r.id === res.row!.id);
          if (idx === -1) return [res.row!, ...prev];
          const next = [...prev];
          next[idx] = res.row!;
          return next;
        });
        // Clear any row-level error.
        if (id) {
          setErrors((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
        return res.row;
      }
      if (id) {
        setErrors((prev) => ({ ...prev, [id]: res.error ?? 'Could not save.' }));
      } else {
        setErrors((prev) => ({ ...prev, __draft__: res.error ?? 'Could not save.' }));
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

  const visibleRows = rows.filter((r) => r.workflowKey === wf.key);
  const draftError = errors.__draft__;

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

      {/* ─── The grid ─────────────────────────────────────────────── */}
      <SourcingGrid
        workflow={wf}
        rows={visibleRows}
        rowErrors={errors}
        draftError={draftError}
        onSave={handleSave}
      />
    </div>
  );
}

/* ── Grid ─────────────────────────────────────────────────────────── */

const SCORE_COL_WIDTH = 80;

function SourcingGrid({
  workflow,
  rows,
  rowErrors,
  draftError,
  onSave,
}: {
  workflow: SourcingWorkflow;
  rows: SourcingRow[];
  rowErrors: Record<string, string>;
  draftError: string | undefined;
  onSave: (
    id: string | null,
    patch: UpsertSourcingRowInput,
  ) => Promise<SourcingRow | null>;
}) {
  const cols = workflow.columns;

  // Build the CSS grid template — score + each column's width.
  // P4.6 removed the dedicated "open" column; locked cells become the
  // row-level click target instead.
  const template = useMemo(() => {
    const parts: string[] = [`${SCORE_COL_WIDTH}px`];
    for (const c of cols) parts.push(`${c.width}px`);
    return parts.join(' ');
  }, [cols]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <div className="surface-tool" style={{ padding: '0.5rem', overflowX: 'auto' }}>
        <div
          role="table"
          aria-label={`${workflow.name} sourcing`}
          style={{ minWidth: 'min-content' }}
        >
          <HeaderRow template={template} columns={cols} />
          {rows.length === 0 ? (
            <div
              role="row"
              style={{
                padding: '1rem 0.75rem',
                fontSize: '0.82rem',
                color: 'var(--text-muted)',
              }}
            >
              No prospects sourced yet. Type a name into the empty row to start.
            </div>
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                workflow={workflow}
                row={row}
                template={template}
                onSave={onSave}
                error={rowErrors[row.id]}
              />
            ))
          )}
          <DraftRow
            key={workflow.key}
            workflow={workflow}
            template={template}
            onSave={onSave}
            error={draftError}
          />
        </div>
      </div>
    </div>
  );
}

function HeaderRow({
  template,
  columns,
}: {
  template: string;
  columns: SourcingColumn[];
}) {
  const cellStyle: React.CSSProperties = {
    fontSize: '0.62rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 700,
    color: 'var(--text-faint)',
    padding: '0.55rem 0.65rem',
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
      <div role="columnheader" style={{ ...cellStyle, textAlign: 'center' }}>
        Score
      </div>
      {columns.map((c) => (
        <div
          role="columnheader"
          key={c.key}
          style={{
            ...cellStyle,
            color: c.group === 'qualifier' ? 'var(--accent)' : 'var(--text-faint)',
          }}
          title={c.help ?? undefined}
        >
          {c.label}
          {c.maxInput != null && (
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
              · ≤{c.maxInput}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── DataRow — an existing prospect ─────────────────────────────────── */

function DataRow({
  workflow,
  row,
  template,
  onSave,
  error,
}: {
  workflow: SourcingWorkflow;
  row: SourcingRow;
  template: string;
  onSave: (
    id: string | null,
    patch: UpsertSourcingRowInput,
  ) => Promise<SourcingRow | null>;
  error?: string;
}) {
  // Local draft of every cell. Initialized from the server-known
  // row on mount; we deliberately don't sync back when `row` changes
  // (the rep's in-progress input wins). The displayed score / band
  // are read straight from `row`, not from the draft, so they stay
  // fresh after a save.
  const [draft, setDraft] = useState<RowDraft>(() => draftFromRow(row));

  // Pending override — when the rep clicks a status that disagrees
  // with the band, we hold the change here until they fill in a reason.
  // Cancel reverts; Save commits both at once.
  const [pendingOverride, setPendingOverride] = useState<{
    status: SourcingStatus;
    reason: string;
  } | null>(null);

  const band = classifyBand(row.rankScore, workflow.bands);

  const submitPatch = useCallback(
    async (patch: UpsertSourcingRowInput) => {
      const merged: UpsertSourcingRowInput = { ...patch, id: row.id };
      await onSave(row.id, merged);
    },
    [onSave, row.id],
  );

  // Status changes route through this so we can intercept disagreements
  // with the band and surface the override expansion.
  const onStatusChange = useCallback(
    (next: SourcingStatus) => {
      if (next === row.sourcingStatus) return;
      if (needsOverride(next, band)) {
        setPendingOverride({ status: next, reason: row.sourcingNote ?? '' });
        return;
      }
      // Otherwise: optimistic local toggle + save.
      setDraft((d) => ({ ...d, sourcingStatus: next }));
      submitPatch({ sourcingStatus: next, sourcingNote: null });
    },
    [band, row.sourcingNote, row.sourcingStatus, submitPatch],
  );

  const commitOverride = useCallback(async () => {
    if (!pendingOverride) return;
    if (pendingOverride.reason.trim().length < OVERRIDE_MIN_CHARS) return;
    setDraft((d) => ({
      ...d,
      sourcingStatus: pendingOverride.status,
      sourcingNote: pendingOverride.reason.trim(),
    }));
    await submitPatch({
      sourcingStatus: pendingOverride.status,
      sourcingNote: pendingOverride.reason.trim(),
    });
    setPendingOverride(null);
  }, [pendingOverride, submitPatch]);

  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: template,
        alignItems: 'stretch',
        borderBottom: '1px solid var(--border)',
        opacity: row.sourcingStatus === 'pass' ? 0.55 : 1,
      }}
    >
      <ScoreCell row={row} bands={workflow.bands} />
      {workflow.columns.map((col) => (
        <Cell
          key={col.key}
          column={col}
          factor={
            col.isRankInput ? workflow.factors.find((f) => f.key === col.key) : undefined
          }
          draft={draft}
          setDraft={setDraft}
          row={row}
          prospectId={row.id}
          submit={submitPatch}
          onStatusChange={onStatusChange}
        />
      ))}
      {pendingOverride && (
        <OverrideExpansion
          pending={pendingOverride}
          band={band}
          setReason={(r) =>
            setPendingOverride((prev) => (prev ? { ...prev, reason: r } : prev))
          }
          onCommit={commitOverride}
          onCancel={() => setPendingOverride(null)}
        />
      )}
      {error && (
        <div
          role="alert"
          style={{
            gridColumn: '1 / -1',
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

/* ── DraftRow — the empty bottom row ────────────────────────────────── */

function DraftRow({
  workflow,
  template,
  onSave,
  error,
}: {
  workflow: SourcingWorkflow;
  template: string;
  onSave: (
    id: string | null,
    patch: UpsertSourcingRowInput,
  ) => Promise<SourcingRow | null>;
  error?: string;
}) {
  // A fresh empty draft each time the workflow changes — the row is
  // workflow-bound. The parent passes `key={workflow.key}` so we get
  // a clean mount per workflow switch, avoiding the "sync state from
  // props" anti-pattern.
  const [draft, setDraft] = useState<RowDraft>(() => emptyDraft());
  const [creating, setCreating] = useState(false);

  const submit = useCallback(
    async (patch: UpsertSourcingRowInput) => {
      // Only save once a name's been typed. Other cells before name
      // are stored locally and submitted as part of the create.
      const haveName =
        (patch.contactName ?? draft.contactName).trim().length > 0;
      if (!haveName) return;

      setCreating(true);
      try {
        // Build a full payload from the current draft (server treats
        // undefined as "no change," so we send everything as a create).
        const fullPatch: UpsertSourcingRowInput = {
          workflowKey: workflow.key,
          contactName: patch.contactName ?? draft.contactName,
          orgName: patch.orgName !== undefined ? patch.orgName : draft.orgName,
          marketArea:
            patch.marketArea !== undefined ? patch.marketArea : draft.marketArea,
          sidesCount:
            patch.sidesCount !== undefined ? patch.sidesCount : parseIntOrNull(draft.sidesCount),
          grossVolume:
            patch.grossVolume !== undefined
              ? patch.grossVolume
              : parseFloatOrNull(draft.grossVolume),
          sourceUrl:
            patch.sourceUrl !== undefined ? patch.sourceUrl : draft.sourceUrl,
          sourcingStatus:
            patch.sourcingStatus !== undefined
              ? patch.sourcingStatus
              : draft.sourcingStatus,
          sourcingNote:
            patch.sourcingNote !== undefined ? patch.sourcingNote : draft.sourcingNote,
          rankInputPatches: { ...draft.rankInputs, ...(patch.rankInputPatches ?? {}) },
        };
        const created = await onSave(null, fullPatch);
        if (created) setDraft(emptyDraft());
      } finally {
        setCreating(false);
      }
    },
    [draft, onSave, workflow.key],
  );

  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: template,
        alignItems: 'stretch',
        background: 'var(--steel-dim)',
        borderTop: '1px dashed var(--border)',
      }}
    >
      {/* Score column — empty placeholder */}
      <div
        role="cell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.7rem',
          color: 'var(--text-faint)',
        }}
      >
        {creating ? 'saving…' : 'new'}
      </div>
      {workflow.columns.map((col) => (
        <Cell
          key={col.key}
          column={col}
          factor={
            col.isRankInput ? workflow.factors.find((f) => f.key === col.key) : undefined
          }
          draft={draft}
          setDraft={setDraft}
          row={null}
          prospectId={null}
          submit={submit}
        />
      ))}
      {error && (
        <div
          role="alert"
          style={{
            gridColumn: '1 / -1',
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

/* ── Cell — dispatch on column kind, with lock-after-blur for text/
   number/url cells. Boolean rank-inputs (gates) and the Status toggle
   stay always-interactive (no lock makes sense for a checkbox). ── */

function Cell({
  column,
  factor,
  draft,
  setDraft,
  row,
  prospectId,
  submit,
  onStatusChange,
}: {
  column: SourcingColumn;
  factor: RankFactor | undefined;
  draft: RowDraft;
  setDraft: React.Dispatch<React.SetStateAction<RowDraft>>;
  row: SourcingRow | null;
  prospectId: string | null;
  submit: (patch: UpsertSourcingRowInput) => void | Promise<void>;
  onStatusChange?: (next: SourcingStatus) => void;
}) {
  // ── Status cell — three-state toggle ──────────────────────────
  if (column.key === 'sourcingStatus') {
    return (
      <div
        role="cell"
        style={{ display: 'flex', alignItems: 'center', padding: '0.3rem 0.4rem' }}
      >
        <StatusToggle
          value={draft.sourcingStatus}
          onChange={(s) => {
            if (onStatusChange) {
              // Existing row — DataRow handles override flow.
              onStatusChange(s);
              return;
            }
            // Draft row — local-only until create.
            setDraft((d) => ({ ...d, sourcingStatus: s }));
            submit({ sourcingStatus: s });
          }}
        />
      </div>
    );
  }

  // ── Bool (rank input) — always interactive, no lock ───────────
  if (column.isRankInput && column.kind === 'bool') {
    const checked = draft.rankInputs[column.key] === true;
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
          checked={checked}
          onChange={(e) => {
            const next = e.target.checked;
            setDraft((d) => ({
              ...d,
              rankInputs: { ...d.rankInputs, [column.key]: next },
            }));
            submit({ rankInputPatches: { [column.key]: next } });
          }}
          aria-label={column.label}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
        />
      </div>
    );
  }

  // ── Integer (rank input) cell — lock-after-blur ──────────────
  if (column.isRankInput && column.kind === 'integer') {
    const value =
      typeof draft.rankInputs[column.key] === 'number'
        ? (draft.rankInputs[column.key] as number)
        : 0;
    const displayValue = value > 0 ? String(value) : '';
    return (
      <LockableCell
        column={column}
        prospectId={prospectId}
        rowExists={row !== null}
        rawValue={displayValue}
        renderDisplay={() => value > 0 ? String(value) : <DimDash />}
        renderEdit={(focus, onBlur) => (
          <input
            ref={focus}
            type="number"
            min={0}
            value={value === 0 ? '' : value}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              const clean = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
              setDraft((d) => ({
                ...d,
                rankInputs: { ...d.rankInputs, [column.key]: clean },
              }));
            }}
            onBlur={() => {
              const v = draft.rankInputs[column.key];
              const num = typeof v === 'number' ? v : 0;
              const wasSaved =
                row && (row.rankInputs[column.key] as number | undefined) === num;
              if (!row || !wasSaved) {
                submit({ rankInputPatches: { [column.key]: num } });
              }
              onBlur();
            }}
            className="input"
            aria-label={column.label}
            placeholder={factor?.maxInput != null ? `≤${factor.maxInput}` : '0'}
            style={cellInputStyle}
          />
        )}
      />
    );
  }

  // ── First-class text / number / currency / url cell — lock-after-blur ───
  const fieldKey = column.key as keyof RowDraft;
  const currentDraft = String(draft[fieldKey] ?? '');

  const onCommit = (next: string) => {
    const trimmed = next.trim();
    const patch: UpsertSourcingRowInput = {};
    switch (column.key) {
      case 'contactName':
        patch.contactName = trimmed;
        break;
      case 'orgName':
        patch.orgName = trimmed === '' ? null : trimmed;
        break;
      case 'marketArea':
        patch.marketArea = trimmed === '' ? null : trimmed;
        break;
      case 'sourceUrl':
        patch.sourceUrl = trimmed === '' ? null : trimmed;
        break;
      case 'sourcingNote':
        patch.sourcingNote = trimmed === '' ? null : trimmed;
        break;
      case 'sidesCount':
        patch.sidesCount = parseIntOrNull(trimmed);
        break;
      case 'grossVolume':
        patch.grossVolume = parseFloatOrNull(trimmed);
        break;
      default:
        return;
    }
    if (!shouldCommit(column, row, trimmed)) return;
    submit(patch);
  };

  const inputType =
    column.kind === 'integer' || column.kind === 'currency'
      ? 'number'
      : column.kind === 'url'
        ? 'url'
        : 'text';

  const renderLockedDisplay = (): React.ReactNode => {
    if (currentDraft.trim() === '') return <DimDash />;
    if (column.kind === 'currency') {
      const n = parseFloatOrNull(currentDraft);
      return n === null ? currentDraft : formatMoney(n);
    }
    if (column.kind === 'url') return prettyUrl(currentDraft);
    return currentDraft;
  };

  return (
    <LockableCell
      column={column}
      prospectId={prospectId}
      rowExists={row !== null}
      rawValue={currentDraft}
      renderDisplay={renderLockedDisplay}
      renderEdit={(focus, onBlur) => (
        <input
          ref={focus}
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
          value={currentDraft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft((d) => ({ ...d, [fieldKey]: v } as RowDraft));
          }}
          onBlur={(e) => {
            onCommit(e.target.value);
            onBlur();
          }}
          placeholder={column.isPrimary ? 'Jordan Avery' : undefined}
          aria-label={column.label}
          className="input"
          style={cellInputStyle}
        />
      )}
    />
  );
}

function CellWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div role="cell" style={{ padding: '0.3rem 0.4rem' }}>
      {children}
    </div>
  );
}

/* ── LockableCell — wraps a value with edit/display modes.
   On display: clickable area that opens /qualify/[id] (if row exists)
   + a tiny pencil to unlock. On edit: the actual input rendered by
   `renderEdit`. ── */

function LockableCell({
  column,
  prospectId,
  rowExists,
  rawValue,
  renderDisplay,
  renderEdit,
}: {
  column: SourcingColumn;
  prospectId: string | null;
  rowExists: boolean;
  rawValue: string;
  renderDisplay: () => React.ReactNode;
  renderEdit: (
    focus: (el: HTMLInputElement | null) => void,
    onBlur: () => void,
  ) => React.ReactNode;
}) {
  // Lock applies only once a row has been saved AND there's a value
  // in the cell. Empty cells stay editable so the rep can type into
  // them; draft (unsaved) rows also stay editable on every cell.
  const lockable = rowExists && rawValue.trim() !== '' && prospectId !== null;
  const [editing, setEditing] = useState(() => !lockable);

  // If the column transitions from lockable to non-lockable (e.g. value
  // is cleared elsewhere), we want to surface the input again.
  // Cheapest check: if the row hasn't been saved or value is empty,
  // force editing back on. This runs on every render — fine, no
  // dependency loop.
  if (editing === false && !lockable) {
    return (
      <CellWrapper>
        {renderEdit(
          (el) => el?.focus(),
          () => {
            /* nothing to lock back into */
          },
        )}
      </CellWrapper>
    );
  }

  if (editing) {
    return (
      <CellWrapper>
        {renderEdit(
          (el) => el?.focus(),
          () => {
            // Only lock if the value will be non-empty and a row id
            // exists. Otherwise stay in edit mode.
            if (lockable) setEditing(false);
          },
        )}
      </CellWrapper>
    );
  }

  // Locked: clickable to navigate, pencil to unlock.
  const href = `/qualify/${prospectId}`;
  return (
    <div role="cell" style={{ padding: 0, position: 'relative' }}>
      <Link
        href={href}
        title={column.label}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.55rem 1.55rem 0.55rem 0.55rem',
          fontSize: '0.82rem',
          color: 'var(--text)',
          textDecoration: 'none',
          minHeight: '2rem',
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--steel-dim)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        {renderDisplay()}
      </Link>
      <button
        type="button"
        aria-label={`Edit ${column.label}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-faint)',
          padding: 0,
          fontSize: '0.7rem',
        }}
      >
        ✎
      </button>
    </div>
  );
}

function DimDash() {
  return <span style={{ color: 'var(--text-faint)' }}>—</span>;
}

const cellInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.35rem 0.45rem',
  fontSize: '0.82rem',
};

/* ── Score cell ───────────────────────────────────────────────────── */

function ScoreCell({
  row,
  bands,
}: {
  row: SourcingRow;
  bands: RankBands;
}) {
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
        padding: '0.3rem',
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
        style={{
          fontSize: '1.05rem',
          color,
          fontWeight: 600,
        }}
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

/* ── Open cell ────────────────────────────────────────────────────── */

/* ── OverrideExpansion — inline reason input when status disagrees
   with the band. Spans the full row width. ── */

function OverrideExpansion({
  pending,
  band,
  setReason,
  onCommit,
  onCancel,
}: {
  pending: { status: SourcingStatus; reason: string };
  band: ScoreBand;
  setReason: (r: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const reasonOk = pending.reason.trim().length >= OVERRIDE_MIN_CHARS;
  const bandLabel =
    band === 'qualified' ? 'Qualified' : band === 'reject' ? 'Below the bar' : 'Borderline';
  const statusLabel = pending.status === 'qualify' ? 'Qualify' : 'Pass';
  return (
    <div
      role="region"
      aria-label="Override reason"
      style={{
        gridColumn: '1 / -1',
        padding: '0.7rem',
        background: 'var(--steel-dim)',
        borderTop: '1px dashed var(--border-accent)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.55rem',
      }}
    >
      <p style={{ fontSize: '0.76rem', color: 'var(--warn)', margin: 0 }}>
        Pre-score band is <strong>{bandLabel}</strong>. You picked <strong>{statusLabel}</strong>.
        Drop a reason — at least {OVERRIDE_MIN_CHARS} characters.
      </p>
      <textarea
        value={pending.reason}
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
        aria-label="Override reason"
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            color: reasonOk ? 'var(--text-faint)' : 'var(--warn)',
          }}
        >
          {pending.reason.trim().length} chars
          {reasonOk
            ? ' · enough'
            : ` · ${OVERRIDE_MIN_CHARS - pending.reason.trim().length} more`}
        </span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.74rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={!reasonOk}
            className={reasonOk ? 'btn-primary' : 'btn-outline'}
            style={{ padding: '0.35rem 0.7rem', fontSize: '0.74rem' }}
          >
            Save override
          </button>
        </div>
      </div>
    </div>
  );
}

// (The old "Open" column was removed in P4.6 — locked cells are the
// click target now.)

/* ── StatusToggle ─────────────────────────────────────────────────── */

function StatusToggle({
  value,
  onChange,
}: {
  value: SourcingStatus;
  onChange: (next: SourcingStatus) => void;
}) {
  const opts: SourcingStatus[] = ['qualify', 'undecided', 'pass'];
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
          opt === 'qualify'
            ? 'var(--good)'
            : opt === 'pass'
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
              padding: '0.3rem 0.5rem',
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

/* ── Pure parsers ──────────────────────────────────────────────────── */

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

/** Avoid firing a save when the blurred cell didn't actually change
 * from the server-known value. */
function shouldCommit(
  column: SourcingColumn,
  row: SourcingRow | null,
  next: string,
): boolean {
  if (!row) return true; // drafts always commit on first save attempt
  const trimmed = next.trim();

  switch (column.key) {
    case 'contactName':
      return trimmed !== row.contactName;
    case 'orgName':
      return trimmed !== (row.orgName ?? '');
    case 'marketArea':
      return trimmed !== (row.marketArea ?? '');
    case 'sourceUrl':
      return trimmed !== (row.sourceUrl ?? '');
    case 'sourcingNote':
      return trimmed !== (row.sourcingNote ?? '');
    case 'sidesCount': {
      const parsed = parseIntOrNull(trimmed);
      return parsed !== row.sidesCount;
    }
    case 'grossVolume': {
      const parsed = parseFloatOrNull(trimmed);
      return parsed !== row.grossVolume;
    }
    default:
      return true;
  }
}
