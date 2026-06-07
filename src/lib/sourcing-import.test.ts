import { describe, expect, it } from 'vitest';
import {
  parseSourcingPaste,
  parseSides,
  parseMoney,
  MAX_IMPORT_ROWS,
} from './sourcing-import';

describe('parseSides', () => {
  it('reads a bare integer', () => {
    expect(parseSides('8')).toEqual({ n: 8, extra: null });
  });
  it('reads "12 (team)" → 12 + extra', () => {
    expect(parseSides('12 (team)')).toEqual({ n: 12, extra: '(team)' });
  });
  it('reads thousands separators', () => {
    expect(parseSides('1,204')).toEqual({ n: 1204, extra: null });
  });
  it('null for empty', () => {
    expect(parseSides(null)).toEqual({ n: null, extra: null });
  });
  it('keeps unparseable text as extra', () => {
    expect(parseSides('a few')).toEqual({ n: null, extra: 'a few' });
  });
});

describe('parseMoney', () => {
  it('parses $453K', () => {
    expect(parseMoney('$453K')).toBe(453_000);
  });
  it('parses $1.8M', () => {
    expect(parseMoney('$1.8M')).toBe(1_800_000);
  });
  it('parses plain 1,234,567', () => {
    expect(parseMoney('1,234,567')).toBe(1_234_567);
  });
  it('rejects ranges', () => {
    expect(parseMoney('$453K – $1.8M')).toBeNull();
  });
  it('null for empty', () => {
    expect(parseMoney(null)).toBeNull();
  });
});

describe('parseSourcingPaste — TSV with headers', () => {
  const tsv = [
    'Agent\tBrokerage\tMarket\tSales/12mo\tZillow\tPrice range',
    'Thomas & Sharon Michael\tDFW Elite Realty\tSouthlake\t8\tzillow.com/profile/ThomasandSharonMichael\t$453K – $1.8M',
    'DeWayne Smart\tSmart Realty\tColleyville\t47 (team)\tSearch "DeWayne Smart" on Zillow\t$171K – $3M',
  ].join('\n');

  it('recognizes the header and maps aliased columns', () => {
    const res = parseSourcingPaste(tsv);
    expect(res.delimiter).toBe('tab');
    expect(res.headerRecognized).toBe(true);
    expect(res.columnOrder).toEqual(['name', 'org', 'market', 'sides', 'url', 'note']);
    expect(res.rows).toHaveLength(2);
  });

  it('cleans values: bare domain → https, team count split, range → note', () => {
    const res = parseSourcingPaste(tsv);
    const [michael, smart] = res.rows;
    expect(michael.contactName).toBe('Thomas & Sharon Michael');
    expect(michael.sidesCount).toBe(8);
    expect(michael.sourceUrl).toBe('https://zillow.com/profile/ThomasandSharonMichael');
    expect(michael.note).toBe('$453K – $1.8M');
    expect(smart.sidesCount).toBe(47);
    // "(team)" + the non-URL search hint both fold into the note
    expect(smart.sourceUrl).toBeNull();
    expect(smart.note).toBe('$171K – $3M · (team) · Search "DeWayne Smart" on Zillow');
  });
});

describe('parseSourcingPaste — headerless, default order', () => {
  it('assumes name · org · market · sides · url · note', () => {
    const res = parseSourcingPaste('Jane Doe\tAcme Realty\tPlano\t12\t\tnice person');
    expect(res.headerRecognized).toBe(false);
    expect(res.rows[0]).toMatchObject({
      contactName: 'Jane Doe',
      orgName: 'Acme Realty',
      marketArea: 'Plano',
      sidesCount: 12,
      sourceUrl: null,
      note: 'nice person',
    });
  });
});

describe('parseSourcingPaste — CSV', () => {
  it('parses quoted commas', () => {
    const res = parseSourcingPaste(
      'name,brokerage,market\n"Doe, Jane","Acme, LLC",Frisco',
    );
    expect(res.delimiter).toBe('comma');
    expect(res.headerRecognized).toBe(true);
    expect(res.rows[0].contactName).toBe('Doe, Jane');
    expect(res.rows[0].orgName).toBe('Acme, LLC');
    expect(res.rows[0].marketArea).toBe('Frisco');
  });
});

describe('parseSourcingPaste — edge cases', () => {
  it('flags intra-paste duplicates by name (case-insensitive)', () => {
    const res = parseSourcingPaste(
      'John & Mysti Sturges\tKW\tGrapevine\t21\t\t\njohn & mysti sturges\tKW\tColleyville\t21\t\t',
    );
    expect(res.rows[0].duplicateOfIndex).toBeNull();
    expect(res.rows[1].duplicateOfIndex).toBe(0);
    expect(res.rows[1].problems.join(' ')).toMatch(/appears earlier/);
  });

  it('rows without a name carry a problem', () => {
    const res = parseSourcingPaste('\tAcme\tPlano\t3\t\t');
    expect(res.rows[0].contactName).toBe('');
    expect(res.rows[0].problems[0]).toMatch(/No name/);
  });

  it('empty input is an input-level problem', () => {
    const res = parseSourcingPaste('  \n  ');
    expect(res.rows).toHaveLength(0);
    expect(res.problems[0]).toMatch(/Nothing to parse/);
  });

  it('unreadable sales counts are row problems, not crashes', () => {
    const res = parseSourcingPaste('Jane\tAcme\tPlano\tlots\t\t');
    expect(res.rows[0].sidesCount).toBeNull();
    expect(res.rows[0].problems.join(' ')).toMatch(/sales count/);
  });

  it(`caps at ${MAX_IMPORT_ROWS} rows`, () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 10 }, (_, i) => `P${i}\tOrg\tCity\t1\t\t`);
    const res = parseSourcingPaste(lines.join('\n'));
    expect(res.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(res.problems.join(' ')).toMatch(/up to 200/);
  });

  it('skips unrecognized header columns (the # column)', () => {
    const res = parseSourcingPaste('#\tAgent\tBrokerage\n1\tJane Doe\tAcme');
    expect(res.headerRecognized).toBe(true);
    expect(res.columnOrder).toEqual(['skip', 'name', 'org']);
    expect(res.rows[0].contactName).toBe('Jane Doe');
    expect(res.rows[0].orgName).toBe('Acme');
  });
});
