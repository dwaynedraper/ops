'use client';

/**
 * Bulk paste importer — get a whole list into Sourcing in one pass.
 *
 * Flow: paste (TSV from a spreadsheet, CSV, headered or not) → PARSE
 * (pure, instant, client-side via parseSourcingPaste) → review the
 * preview grid (include/exclude per row; intra-paste duplicates start
 * excluded) → IMPORT (one transaction server-side). Rows whose name the
 * rep already owns come back as duplicates with a per-row "Add anyway"
 * that goes through the normal D-057 acknowledge path.
 *
 * Messy non-tabular pastes are out of scope by design: clean the soup
 * with Claude into TSV, then paste here. The parser is deterministic on
 * purpose — predictable beats clever where data enters the system.
 */

import { useState } from 'react';
import {
  parseSourcingPaste,
  type ImportParseResult,
  type ImportDraftRow,
} from '@/lib/sourcing-import';
import {
  bulkImportSourcingRows,
  upsertSourcingRow,
  type BulkRowOutcome,
  type DuplicateProspect,
} from './actions';
import type { SourcingRow } from '@/lib/sourcing';

const PLACEHOLDER = [
  'Paste a list — tab- or comma-separated, one prospect per line.',
  '',
  'With a header row (column order then doesn’t matter):',
  'Agent\tBrokerage\tMarket\tSales/12mo\tZillow\tNotes',
  '',
  'Or headerless, in this order:',
  'name\tbrokerage\tmarket\tsales\turl\tnotes',
].join('\n');

interface RowState {
  draft: ImportDraftRow;
  included: boolean;
  /** Set after import. */
  outcome?: BulkRowOutcome;
  addingAnyway?: boolean;
}

export function BulkPaste({
  workflowKey,
  accent,
  onCreated,
}: {
  workflowKey: string;
  accent: string;
  onCreated: (rows: SourcingRow[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [rowStates, setRowStates] = useState<RowState[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState<number | null>(null);

  function handleParse() {
    const res = parseSourcingPaste(text);
    setParsed(res);
    setRowStates(
      res.rows.map((draft) => ({
        draft,
        // No name → can't import. Repeat of an earlier row → off by
        // default (the Sturges-in-two-markets case).
        included: draft.contactName.length > 0 && draft.duplicateOfIndex === null,
      })),
    );
    setImportError(null);
    setCreatedCount(null);
  }

  async function handleImport() {
    if (!parsed) return;
    const included = rowStates
      .map((rs, index) => ({ rs, index }))
      .filter(({ rs }) => rs.included && !rs.outcome);
    if (included.length === 0) return;

    setImporting(true);
    setImportError(null);
    const res = await bulkImportSourcingRows(
      workflowKey,
      included.map(({ rs }) => ({
        contactName: rs.draft.contactName,
        orgName: rs.draft.orgName,
        marketArea: rs.draft.marketArea,
        sidesCount: rs.draft.sidesCount,
        grossVolume: rs.draft.grossVolume,
        sourceUrl: rs.draft.sourceUrl,
        note: rs.draft.note,
      })),
    );
    setImporting(false);

    if (!res.ok || !res.outcomes) {
      setImportError(res.error ?? 'Could not import that list.');
      return;
    }

    const next = [...rowStates];
    const createdRows: SourcingRow[] = [];
    res.outcomes.forEach((outcome, i) => {
      const { index } = included[i];
      next[index] = { ...next[index], outcome };
      if (outcome.outcome === 'created') createdRows.push(outcome.row);
    });
    setRowStates(next);
    setCreatedCount(res.created ?? createdRows.length);
    if (createdRows.length > 0) onCreated(createdRows);
  }

  /** D-057 per-row escape hatch: import a flagged duplicate anyway via
   * the normal single upsert with acknowledgeDuplicates. */
  async function addAnyway(index: number) {
    const rs = rowStates[index];
    if (!rs || rs.addingAnyway) return;
    setRowStates((prev) => prev.map((p, i) => (i === index ? { ...p, addingAnyway: true } : p)));
    const res = await upsertSourcingRow({
      workflowKey,
      contactName: rs.draft.contactName,
      orgName: rs.draft.orgName,
      marketArea: rs.draft.marketArea,
      sidesCount: rs.draft.sidesCount,
      grossVolume: rs.draft.grossVolume,
      sourceUrl: rs.draft.sourceUrl,
      acknowledgeDuplicates: true,
    });
    setRowStates((prev) =>
      prev.map((p, i) =>
        i === index
          ? {
              ...p,
              addingAnyway: false,
              outcome:
                res.ok && res.row
                  ? { outcome: 'created', row: res.row }
                  : { outcome: 'invalid', error: res.error ?? 'Could not add.' },
            }
          : p,
      ),
    );
    if (res.ok && res.row) onCreated([res.row]);
  }

  function reset() {
    setText('');
    setParsed(null);
    setRowStates([]);
    setImportError(null);
    setCreatedCount(null);
  }

  if (!open) {
    return (
      <button className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        ⇪ Paste a list (bulk import)
      </button>
    );
  }

  const includedCount = rowStates.filter((rs) => rs.included && !rs.outcome).length;

  return (
    <section className="surface-tool" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <div className="eyebrow">Paste a list</div>
        <button
          className="btn-ghost"
          style={{ padding: '0.2rem 0' }}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Close ✕
        </button>
      </header>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={6}
        spellCheck={false}
        style={{
          width: '100%',
          resize: 'vertical',
          background: 'rgba(0, 0, 0, 0.25)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.7rem 0.8rem',
          fontSize: '0.8rem',
          fontFamily: 'var(--font-mono, monospace)',
          lineHeight: 1.5,
        }}
      />

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={handleParse} disabled={text.trim().length === 0}>
          Parse
        </button>
        {parsed && (
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Read as {parsed.delimiter === 'tab' ? 'tab-separated' : 'comma-separated'} ·{' '}
            {parsed.headerRecognized ? 'header recognized' : 'no header — default column order'} ·{' '}
            columns: {parsed.columnOrder.filter((c) => c !== 'skip').join(' · ')}
          </span>
        )}
      </div>

      {parsed?.problems.map((p) => (
        <p key={p} style={{ fontSize: '0.78rem', color: 'var(--warn)', margin: 0 }}>
          {p}
        </p>
      ))}

      {/* ── Preview grid ─────────────────────────────────────────── */}
      {rowStates.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-faint)' }}>
                <th style={{ padding: '0.3rem 0.5rem' }} />
                <th style={{ padding: '0.3rem 0.5rem' }}>Name</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Brokerage</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Market</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Sales</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Link</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Note</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rowStates.map((rs, i) => {
                const d = rs.draft;
                const done = rs.outcome?.outcome === 'created';
                return (
                  <tr
                    key={i}
                    style={{
                      borderTop: '1px solid var(--border)',
                      opacity: rs.included || rs.outcome ? 1 : 0.45,
                    }}
                  >
                    <td style={{ padding: '0.35rem 0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={rs.included}
                        disabled={!!rs.outcome || d.contactName.length === 0}
                        onChange={(e) =>
                          setRowStates((prev) =>
                            prev.map((p, j) => (j === i ? { ...p, included: e.target.checked } : p)),
                          )
                        }
                      />
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600, color: 'var(--text)' }}>
                      {d.contactName || <em style={{ color: 'var(--text-faint)' }}>(no name)</em>}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem' }}>{d.orgName}</td>
                    <td style={{ padding: '0.35rem 0.5rem' }}>{d.marketArea}</td>
                    <td style={{ padding: '0.35rem 0.5rem' }} className="money">
                      {d.sidesCount ?? ''}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.sourceUrl}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem', maxWidth: 220 }}>
                      {d.note}
                      {d.problems.length > 0 && (
                        <span style={{ display: 'block', color: 'var(--warn)', fontSize: '0.72rem' }}>
                          {d.problems.join(' ')}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>
                      {done && <span style={{ color: 'var(--good)', fontWeight: 600 }}>✓ added</span>}
                      {rs.outcome?.outcome === 'invalid' && (
                        <span style={{ color: 'var(--warn)' }}>{rs.outcome.error}</span>
                      )}
                      {rs.outcome?.outcome === 'duplicate' && (
                        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ color: 'var(--warn)' }}>
                            already have {describeDuplicates(rs.outcome.duplicates)}
                          </span>
                          <button
                            className="btn-ghost"
                            style={{ padding: '0.1rem 0.3rem', color: accent }}
                            disabled={rs.addingAnyway}
                            onClick={() => addAnyway(i)}
                          >
                            {rs.addingAnyway ? 'Adding…' : 'Add anyway'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Import bar ───────────────────────────────────────────── */}
      {rowStates.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={handleImport}
            disabled={importing || includedCount === 0}
          >
            {importing
              ? 'Importing…'
              : `Import ${includedCount} ${includedCount === 1 ? 'row' : 'rows'}`}
          </button>
          {createdCount !== null && (
            <span style={{ fontSize: '0.8rem', color: 'var(--good)', fontWeight: 600 }}>
              ✓ {createdCount} added to the pipeline
            </span>
          )}
          {importError && (
            <span style={{ fontSize: '0.8rem', color: 'var(--bad)' }}>{importError}</span>
          )}
        </div>
      )}
    </section>
  );
}

function describeDuplicates(dups: DuplicateProspect[]): string {
  if (dups.length === 0) return 'this name';
  const d = dups[0];
  const more = dups.length > 1 ? ` (+${dups.length - 1} more)` : '';
  return `${d.contactName} — ${d.workflowName}, ${d.stage}${more}`;
}
