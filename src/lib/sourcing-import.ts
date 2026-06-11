/**
 * Sourcing bulk-paste parser (pure core, no DB).
 *
 * Turns a pasted list — TSV from a spreadsheet, CSV, with or without a
 * header row — into typed draft rows for the bulk importer. Deliberately
 * DETERMINISTIC: it reads clean-ish tabular text. Mangled soup (PDF copy
 * with glued columns) is out of scope — that's what pasting the soup to
 * Claude first is for; it comes back as TSV this parser eats happily.
 *
 * Shape rules:
 *   • Delimiter: tab if any line has a tab, else comma (quoted CSV ok).
 *   • Header row: recognized by alias match (Name/Agent, Brokerage/Org,
 *     Market/City, Sales/Sides, Volume, Zillow/URL, Notes/Price range).
 *     Unrecognized header cells become 'skip' columns.
 *   • No header? Columns are assumed in the default order:
 *     name · brokerage · market · sales · zillow · notes
 *   • Values get cleaned: "12 (team)" → sides 12 + "(team)" into notes;
 *     "$1.8M"/"$453K" money parses; non-URL text in the URL column folds
 *     into notes instead of polluting source_url.
 *   • Intra-paste duplicates (same name, case-insensitive) are flagged so
 *     the UI can exclude the repeat by default (e.g. the same team listed
 *     under two markets).
 */

export type ImportColumnKey =
  | 'name'
  | 'org'
  | 'market'
  | 'sides'
  | 'volume'
  | 'url'
  | 'note'
  | 'skip';

export interface ImportDraftRow {
  contactName: string;
  orgName: string | null;
  marketArea: string | null;
  sidesCount: number | null;
  grossVolume: number | null;
  sourceUrl: string | null;
  note: string | null;
  /** Row-level warnings, human-readable. */
  problems: string[];
  /** Index of the earlier row this one duplicates (same name), if any. */
  duplicateOfIndex: number | null;
}

export interface ImportParseResult {
  rows: ImportDraftRow[];
  delimiter: 'tab' | 'comma';
  headerRecognized: boolean;
  columnOrder: ImportColumnKey[];
  /** Input-level problems (e.g. nothing parseable at all). */
  problems: string[];
}

/* ── Header recognition ───────────────────────────────────────────── */

const HEADER_ALIASES: Record<ImportColumnKey, string[]> = {
  name: ['name', 'agent', 'contact', 'contact name', 'agent name', 'who'],
  org: ['org', 'org name', 'organization', 'brokerage', 'brokerage/team', 'company', 'team', 'firm'],
  market: ['market', 'market area', 'city', 'area', 'location', 'territory'],
  sides: ['sides', 'sales', 'sales/12mo', 'sales last 12 mo', 'sales/last 12 mo', 'sides/12mo', 'transactions', 'deals', 'count', 'sales (12mo)'],
  volume: ['volume', 'gross volume', 'gross', '$ volume', 'dollar volume', 'gmv'],
  url: ['url', 'link', 'zillow', 'zillow profile', 'profile', 'source', 'source url', 'website'],
  note: ['note', 'notes', 'price range', 'range', 'comment', 'comments', 'misc'],
  skip: [],
};

const DEFAULT_ORDER: ImportColumnKey[] = ['name', 'org', 'market', 'sides', 'url', 'note'];

function normalizeHeaderCell(cell: string): string {
  return cell.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map a header cell to a column key, or 'skip' if unrecognized. */
function headerToKey(cell: string): ImportColumnKey {
  const n = normalizeHeaderCell(cell);
  if (!n) return 'skip';
  for (const key of Object.keys(HEADER_ALIASES) as ImportColumnKey[]) {
    if (HEADER_ALIASES[key].includes(n)) return key;
  }
  return 'skip';
}

/* ── Line splitting ───────────────────────────────────────────────── */

/** Minimal CSV line parser with double-quote support. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ── Value cleaning ───────────────────────────────────────────────── */

function trimOrNull(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/** "12 (team)" → { n: 12, extra: '(team)' } · "8" → { n: 8 } */
export function parseSides(raw: string | null): { n: number | null; extra: string | null } {
  if (!raw) return { n: null, extra: null };
  const m = raw.match(/-?\d[\d,]*/);
  if (!m) return { n: null, extra: trimOrNull(raw) };
  const n = parseInt(m[0].replace(/,/g, ''), 10);
  const extra = trimOrNull(raw.replace(m[0], ''));
  return { n: Number.isFinite(n) && n >= 0 ? n : null, extra };
}

/** "$1.8M" → 1800000 · "$453K" → 453000 · "1,234,567" → 1234567 */
export function parseMoney(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw
    .trim()
    .match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'k') n *= 1_000;
  if (suffix === 'm') n *= 1_000_000;
  return n >= 0 ? n : null;
}

/** URL-ish? Accept http(s), www., or bare domain-with-path (no spaces). */
function cleanUrl(raw: string | null): { url: string | null; noteFromUrl: string | null } {
  if (!raw) return { url: null, noteFromUrl: null };
  const t = raw.trim();
  if (!t) return { url: null, noteFromUrl: null };
  if (/^https?:\/\/\S+$/i.test(t)) return { url: t, noteFromUrl: null };
  if (/^(www\.)?[a-z0-9-]+(\.[a-z]{2,})+(\/\S*)?$/i.test(t)) {
    return { url: `https://${t}`, noteFromUrl: null };
  }
  // Not a URL ("Search X on Zillow") — keep the breadcrumb as a note.
  return { url: null, noteFromUrl: t };
}

function joinNotes(parts: Array<string | null>): string | null {
  const joined = parts.filter((p): p is string => !!p && p.trim().length > 0).join(' · ');
  return joined.length > 0 ? joined : null;
}

/* ── The parser ───────────────────────────────────────────────────── */

export const MAX_IMPORT_ROWS = 200;

export function parseSourcingPaste(text: string): ImportParseResult {
  const problems: string[] = [];
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/ /g, ' ')) // NBSP → space
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return {
      rows: [],
      delimiter: 'tab',
      headerRecognized: false,
      columnOrder: DEFAULT_ORDER,
      problems: ['Nothing to parse — paste a tab- or comma-separated list.'],
    };
  }

  const delimiter: 'tab' | 'comma' = lines[0].includes('\t') ? 'tab' : 'comma';
  const split = (line: string): string[] =>
    delimiter === 'tab' ? line.split('\t') : splitCsvLine(line);

  // Header detection: a line is a header when ≥2 cells match known aliases
  // AND one of them is the name column.
  const firstCells = split(lines[0]).map(headerToKey);
  const aliasHits = firstCells.filter((k) => k !== 'skip').length;
  const headerRecognized = aliasHits >= 2 && firstCells.includes('name');

  const columnOrder: ImportColumnKey[] = headerRecognized ? firstCells : DEFAULT_ORDER;
  const dataLines = headerRecognized ? lines.slice(1) : lines;

  if (dataLines.length > MAX_IMPORT_ROWS) {
    problems.push(
      `That's ${dataLines.length} rows — the importer takes up to ${MAX_IMPORT_ROWS} per pass. Split the list.`,
    );
  }

  const rows: ImportDraftRow[] = [];
  const seenNames = new Map<string, number>(); // lower(name) → first row index

  for (const line of dataLines.slice(0, MAX_IMPORT_ROWS)) {
    const cells = split(line);
    const get = (key: ImportColumnKey): string | null => {
      const idx = columnOrder.indexOf(key);
      if (idx === -1) return null;
      return trimOrNull(cells[idx]);
    };

    const rowProblems: string[] = [];
    const contactName = get('name');
    if (!contactName) {
      rows.push({
        contactName: '',
        orgName: get('org'),
        marketArea: get('market'),
        sidesCount: null,
        grossVolume: null,
        sourceUrl: null,
        note: get('note'),
        problems: ['No name — this row can’t be imported.'],
        duplicateOfIndex: null,
      });
      continue;
    }

    const sides = parseSides(get('sides'));
    if (get('sides') && sides.n === null) {
      rowProblems.push(`Couldn’t read a sales count from “${get('sides')}”.`);
    }
    const volume = parseMoney(get('volume'));
    if (get('volume') && volume === null) {
      rowProblems.push(`Couldn’t read a dollar volume from “${get('volume')}”.`);
    }
    const { url, noteFromUrl } = cleanUrl(get('url'));

    const lower = contactName.toLowerCase();
    const dupOf = seenNames.has(lower) ? seenNames.get(lower)! : null;
    if (dupOf === null) seenNames.set(lower, rows.length);
    else rowProblems.push('Same name appears earlier in this paste.');

    rows.push({
      contactName,
      orgName: get('org'),
      marketArea: get('market'),
      sidesCount: sides.n,
      grossVolume: volume,
      sourceUrl: url,
      note: joinNotes([get('note'), sides.extra, noteFromUrl]),
      problems: rowProblems,
      duplicateOfIndex: dupOf,
    });
  }

  if (rows.length === 0) {
    problems.push('No data rows found under the header.');
  }

  return { rows, delimiter, headerRecognized, columnOrder, problems };
}
