/**
 * Wave CSV export (Phase 5D of MONEY-AND-LEDGER-PLAN.md).
 *
 * Wave's transaction import recognizes three columns — Date, Description,
 * Amount — and maps them at upload, so column order is flexible. We emit a
 * header row anyway for legibility. Verified against Wave Help Center
 * (2026-05): date MM/DD/YYYY; Amount positive = money in, negative = money
 * out; and the special characters # & $ * cause import trouble, so we strip
 * them from descriptions here.
 *
 * Pure + unit-tested. The download routes call toWaveCsv with rows the
 * Books page assembled; no DB in this module.
 */

export interface WaveRow {
  /** ISO 'YYYY-MM-DD'. Converted to MM/DD/YYYY on output. */
  date: string;
  description: string;
  /** Positive = money in; negative = money out. */
  amount: number;
}

/** ISO 'YYYY-MM-DD' → 'MM/DD/YYYY' (Wave's expected date format). */
export function toWaveDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * Clean a description for Wave: strip the characters Wave flags (# & $ *),
 * collapse whitespace, and trim. A blank result becomes "Transaction" so
 * the description column is never empty (Wave rejects number-only / empty
 * descriptions).
 */
export function cleanDescription(s: string): string {
  const cleaned = s.replace(/[#&$*]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'Transaction';
}

/** CSV-escape one field: wrap in quotes if it has a comma, quote, or newline. */
function csvField(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Format a dollar amount for the CSV: 2 dp, leading minus for outflow. */
export function waveAmount(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Build a Wave-ready CSV string from rows. Header is Date,Description,Amount.
 * Rows are emitted in the order given (the Books page sorts by date).
 */
export function toWaveCsv(rows: WaveRow[]): string {
  const lines = ['Date,Description,Amount'];
  for (const r of rows) {
    lines.push(
      [
        csvField(toWaveDate(r.date)),
        csvField(cleanDescription(r.description)),
        csvField(waveAmount(r.amount)),
      ].join(','),
    );
  }
  // Trailing newline — friendlier to spreadsheet tools.
  return lines.join('\r\n') + '\r\n';
}
