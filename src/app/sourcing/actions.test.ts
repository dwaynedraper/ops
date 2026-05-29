import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `upsertSourcingRow` server action — create + update + override
 * validation + D-057 duplicate-check.
 *
 * Strategy: mock every external dependency the action touches —
 * `@/auth`, `@/lib/db`, `@/lib/prospect-access`,
 * `@/lib/action-error`, and `next/cache`. The action's own logic
 * (band classification, override carve-out, stage transitions,
 * note clearing) runs against the real lib code, so tests pin the
 * full server contract end to end without a real DB.
 *
 * Each test pre-loads the mocks with synthetic rows and asserts on
 * the result shape — ok / error / duplicates / row.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({
  sql: vi.fn(),
  sqlOne: vi.fn(),
}));
vi.mock('@/lib/action-error', () => ({
  actionError: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('@/lib/prospect-access', () => ({
  loadOwnedProspect: vi.fn(),
}));

import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { loadOwnedProspect } from '@/lib/prospect-access';
import { upsertSourcingRow } from './actions';

const mockAuth = vi.mocked(auth);
const mockSql = vi.mocked(sql);
const mockSqlOne = vi.mocked(sqlOne);
const mockLoadOwnedProspect = vi.mocked(loadOwnedProspect);

// ─── Fixture builders ────────────────────────────────────────────────

const USER_ID = 'user-1';

function signedIn() {
  mockAuth.mockResolvedValue({ user: { id: USER_ID } } as never);
}

const RE_FACTORS = [
  { key: 'has_target_listing', label: 'Has target listing', help_text: null, kind: 'bool', weight: '1', max_input: null, is_gate: true, sort_order: 1 },
  { key: 'has_photo_need', label: 'Photo need', help_text: null, kind: 'bool', weight: '1', max_input: null, is_gate: true, sort_order: 2 },
  { key: 'annual_volume', label: 'Listings per year', help_text: null, kind: 'number', weight: '3', max_input: '30', is_gate: false, sort_order: 10 },
];

const BAND_ROWS = [
  { key: 'qualified_min', value: '8' },
  { key: 'borderline_min', value: '6' },
  { key: 'qualified_target_count', value: '10' },
];

const INSERTED_ROW = {
  id: 'prospect-new',
  workflow_key: 'real_estate',
  contact_name: 'Jordan Avery',
  org_name: null,
  market_area: null,
  sides_count: null,
  gross_volume: null,
  source_url: null,
  sourcing_status: 'pursue',
  sourcing_note: null,
  rank_inputs: {},
  rank_score: '0',
  stage: 'researching',
  created_at: '2026-05-28T10:00:00Z',
};

/** Most happy paths for `createRow` hit four query slots in this order:
 *    1. sqlOne   — workflow check (returns { name } or null)
 *    2. sql      — duplicate-check (returns [] when none; skipped if ack)
 *    3. sql      — loadWorkflowFactors (returns rank_factor rows)
 *    3'. sql     — loadWorkflowBands (returns rank_config rows)
 *    4. sqlOne   — INSERT … RETURNING (returns inserted row)
 */
function setupCreateMocks(opts: {
  workflowExists?: boolean;
  duplicates?: unknown[];
  insertedRow?: unknown;
  /** When the caller will pass `acknowledgeDuplicates: true`, the
   * action skips the dupe-check query and goes straight to factors +
   * bands. Set `ack: true` so the mock queue lines up with the
   * actual call sequence. */
  ack?: boolean;
} = {}) {
  mockSqlOne.mockReset();
  mockSql.mockReset();

  // 1. workflow check
  mockSqlOne.mockResolvedValueOnce(
    (opts.workflowExists === false ? null : { name: 'Real Estate Media' }) as never,
  );

  // 2. duplicate-check (only enqueued when the caller WON'T ack)
  if (!opts.ack) {
    mockSql.mockResolvedValueOnce((opts.duplicates ?? []) as never);
  }

  // 3 + 3'. factor + band rows (Promise.all order is factors first)
  mockSql.mockResolvedValueOnce(RE_FACTORS as never);
  mockSql.mockResolvedValueOnce(BAND_ROWS as never);

  // 4. INSERT
  mockSqlOne.mockResolvedValueOnce((opts.insertedRow ?? INSERTED_ROW) as never);
}

beforeEach(() => {
  mockAuth.mockReset();
  mockSql.mockReset();
  mockSqlOne.mockReset();
  mockLoadOwnedProspect.mockReset();
});

// ─── Auth / session ──────────────────────────────────────────────────

describe('upsertSourcingRow — auth + basic guards', () => {
  it('returns ok=false when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/session/i);
  });

  it('rejects a create without a workflowKey', async () => {
    signedIn();
    const res = await upsertSourcingRow({ contactName: 'Jordan' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/workflow/i);
  });

  it('rejects a create without a contactName', async () => {
    signedIn();
    const res = await upsertSourcingRow({ workflowKey: 'real_estate' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/name/i);
  });

  it('rejects a create when the workflow is no longer active', async () => {
    signedIn();
    setupCreateMocks({ workflowExists: false, ack: true });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      acknowledgeDuplicates: true, // skip the dupe check for this test
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/workflow/i);
  });
});

// ─── Create happy path ──────────────────────────────────────────────

describe('upsertSourcingRow — create happy path', () => {
  it('inserts and returns the new row', async () => {
    signedIn();
    setupCreateMocks({ ack: true });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      sourcingStatus: 'pursue',
      acknowledgeDuplicates: true,
    });
    expect(res.ok).toBe(true);
    expect(res.row?.contactName).toBe('Jordan Avery');
    expect(res.row?.sourcingStatus).toBe('pursue');
  });

  it('defaults sourcing_status to undecided when omitted', async () => {
    signedIn();
    setupCreateMocks({
      insertedRow: { ...INSERTED_ROW, sourcing_status: 'undecided' },
      ack: true,
    });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      acknowledgeDuplicates: true,
    });
    expect(res.ok).toBe(true);
    expect(res.row?.sourcingStatus).toBe('undecided');
  });
});

// ─── Override rule on create (D-028 + D-045) ─────────────────────────

describe('upsertSourcingRow — override validation (D-028 + D-045)', () => {
  it('rejects an empty reason when overriding a reject-band positive call (filled qualifiers)', async () => {
    signedIn();
    // Score will be 0 unless we patch inputs — flip one gate via the
    // rankInputPatches so the carve-out doesn't fire.
    setupCreateMocks({ ack: true });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      sourcingStatus: 'pursue', // positive on a band='reject' score
      rankInputPatches: { has_target_listing: true },
      sourcingNote: null,
      acknowledgeDuplicates: true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reason/i);
  });

  it('D-045: an empty-qualifier row does NOT demand a reason', async () => {
    signedIn();
    setupCreateMocks({ ack: true });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      sourcingStatus: 'pursue', // positive — would normally require a reason
      rankInputPatches: {}, // every qualifier empty
      sourcingNote: null,
      acknowledgeDuplicates: true,
    });
    expect(res.ok).toBe(true);
  });

  it('accepts the override when the reason is long enough (≥20 chars)', async () => {
    signedIn();
    setupCreateMocks({ ack: true });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      sourcingStatus: 'pursue',
      rankInputPatches: { has_target_listing: true },
      sourcingNote: 'I have an in via the office manager — pursue.',
      acknowledgeDuplicates: true,
    });
    expect(res.ok).toBe(true);
  });
});

// ─── D-057 duplicate-check ───────────────────────────────────────────

describe('upsertSourcingRow — D-057 duplicate-check', () => {
  it('returns duplicates payload when name matches the rep\'s prospect', async () => {
    signedIn();
    // The dupe-check query is the 2nd `sql` call. Make it return one
    // matched row; the action should short-circuit before any
    // factor/band/insert query runs.
    mockSqlOne.mockResolvedValueOnce({ name: 'Real Estate Media' } as never);
    mockSql.mockResolvedValueOnce([
      {
        id: 'existing-1',
        contact_name: 'Jordan Avery',
        workflow_key: 'real_estate',
        workflow_name: 'Real Estate Media',
        stage: 'qualified',
        sourcing_status: 'qualify',
      },
    ] as never);
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan Avery',
    });
    expect(res.ok).toBe(false);
    expect(res.duplicates).toHaveLength(1);
    expect(res.duplicates?.[0].id).toBe('existing-1');
    expect(res.duplicates?.[0].workflowName).toBe('Real Estate Media');
    expect(res.error).toBeUndefined();
  });

  it('acknowledgeDuplicates=true skips the dupe-check and proceeds', async () => {
    signedIn();
    setupCreateMocks({ ack: true });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan Avery',
      acknowledgeDuplicates: true,
    });
    expect(res.ok).toBe(true);
    expect(res.row?.id).toBe('prospect-new');
  });

  it('proceeds normally when the dupe-check returns no matches', async () => {
    signedIn();
    setupCreateMocks({ duplicates: [] });
    const res = await upsertSourcingRow({
      workflowKey: 'real_estate',
      contactName: 'Jordan Avery',
    });
    expect(res.ok).toBe(true);
    expect(res.duplicates).toBeUndefined();
  });
});

// ─── Update path ────────────────────────────────────────────────────

describe('upsertSourcingRow — update path', () => {
  function setupUpdateMocks(opts: {
    accessOk?: boolean;
    existingRow?: unknown;
    updatedRow?: unknown;
  } = {}) {
    mockSqlOne.mockReset();
    mockSql.mockReset();
    mockLoadOwnedProspect.mockReset();

    if (opts.accessOk === false) {
      mockLoadOwnedProspect.mockResolvedValue({ error: 'Not yours.' } as never);
      return;
    }
    mockLoadOwnedProspect.mockResolvedValue({
      prospect: { id: 'p-1' },
      userId: USER_ID,
    } as never);

    // SELECT existing
    mockSqlOne.mockResolvedValueOnce(
      (opts.existingRow ?? {
        id: 'p-1',
        workflow_key: 'real_estate',
        contact_name: 'Jordan',
        org_name: null,
        market_area: null,
        sides_count: null,
        gross_volume: null,
        source_url: null,
        sourcing_status: 'pursue',
        sourcing_note: null,
        rank_inputs: { has_target_listing: true, has_photo_need: true, annual_volume: 30 },
        rank_score: '10',
        stage: 'researching',
        created_at: '2026-05-28T10:00:00Z',
      }) as never,
    );

    // factor + band rows
    mockSql.mockResolvedValueOnce(RE_FACTORS as never);
    mockSql.mockResolvedValueOnce(BAND_ROWS as never);

    // UPDATE RETURNING
    mockSqlOne.mockResolvedValueOnce(
      (opts.updatedRow ?? {
        id: 'p-1',
        workflow_key: 'real_estate',
        contact_name: 'Jordan',
        org_name: null,
        market_area: null,
        sides_count: null,
        gross_volume: null,
        source_url: null,
        sourcing_status: 'qualify',
        sourcing_note: null,
        rank_inputs: { has_target_listing: true, has_photo_need: true, annual_volume: 30 },
        rank_score: '10',
        stage: 'qualified',
        created_at: '2026-05-28T10:00:00Z',
      }) as never,
    );
  }

  it('refuses to update a prospect the rep does not own', async () => {
    signedIn();
    setupUpdateMocks({ accessOk: false });
    const res = await upsertSourcingRow({
      id: 'p-1',
      sourcingStatus: 'qualify',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Not yours/i);
  });

  it('advances stage to qualified when status flips to qualify', async () => {
    signedIn();
    setupUpdateMocks();
    const res = await upsertSourcingRow({
      id: 'p-1',
      sourcingStatus: 'qualify',
    });
    expect(res.ok).toBe(true);
    expect(res.row?.stage).toBe('qualified');
    expect(res.row?.sourcingStatus).toBe('qualify');
  });

  it('the duplicate check does NOT run on update', async () => {
    signedIn();
    setupUpdateMocks();
    await upsertSourcingRow({
      id: 'p-1',
      contactName: 'Jordan Avery', // name match could collide on create
    });
    // The mock had 2 sql calls (factor + band). A dupe-check would add
    // a third. Verify only the expected two ran.
    const sqlCalls = mockSql.mock.calls.length;
    expect(sqlCalls).toBe(2);
  });
});
