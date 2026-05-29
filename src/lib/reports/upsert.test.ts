import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase R · upsert.ts tests.
 *
 * The upsert is a thin wrapper around (1) a DELETE for the target
 * date, (2) a bulk INSERT of the new rows. These tests cover:
 *
 *   • The guardrail — throws when a row's date doesn't match the
 *     batch's snapshot date (catches a programming error before the
 *     DELETE).
 *   • Empty rows — still issues the DELETE (idempotency: an empty
 *     re-run clears yesterday's stale data).
 *   • Happy path — counts match what the mocked SQL returned.
 *
 * Strategy mirrors `digest.test.ts`: mock `@/lib/db` so both the
 * `sql` tagged template and `getPool` return mock-controlled values.
 */

// Use vi.hoisted so the mock factory can reference these — vi.mock is
// hoisted to the top of the file, ahead of normal variable initializers.
const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  sql: vi.fn(),
  getPool: () => ({ query: mockPoolQuery }),
}));

import { sql } from '@/lib/db';
import { upsertSnapshot } from './upsert';
import type { SnapshotRow } from './types';

const mockSql = vi.mocked(sql);

const DATE = '2026-05-28';
const REP_A = '11111111-1111-1111-1111-111111111111';

function makeRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    snapshotDate: DATE,
    repId: REP_A,
    workflowKey: 'real_estate',
    stage: 'qualified',
    prospectsInStage: 4,
    enteredStageToday: 1,
    exitedStageToday: 0,
    contactsSentToday: 2,
    responsesToday: 0,
    sumRankScore: 24,
    revenueClosedToday: 0,
    quotesAcceptedToday: 0,
    avgCycleDaysIntoStage: 3.4,
    ...overrides,
  };
}

describe('upsertSnapshot', () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockPoolQuery.mockReset();
  });

  it('throws when any row has a different snapshotDate', async () => {
    const rows = [makeRow(), makeRow({ snapshotDate: '2026-05-27' })];
    await expect(upsertSnapshot(DATE, rows)).rejects.toThrow(
      /does not match snapshotDate/,
    );
    // The throw should happen BEFORE any DB call.
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('still issues the DELETE when given an empty row batch', async () => {
    mockSql.mockResolvedValueOnce([{ count: 5 }]);

    const result = await upsertSnapshot(DATE, []);

    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(result.deleted).toBe(5);
    expect(result.inserted).toBe(0);
  });

  it('returns the deleted + inserted counts on the happy path', async () => {
    mockSql.mockResolvedValueOnce([{ count: 3 }]);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 4 });

    const rows = [
      makeRow({ stage: 'researching' }),
      makeRow({ stage: 'qualified' }),
      makeRow({ stage: 'contacting' }),
      makeRow({ stage: 'client', revenueClosedToday: 800, quotesAcceptedToday: 1 }),
    ];
    const result = await upsertSnapshot(DATE, rows);

    expect(result.deleted).toBe(3);
    expect(result.inserted).toBe(4);
    expect(typeof result.tookMs).toBe('number');
  });

  it('passes all row values positionally to the INSERT', async () => {
    mockSql.mockResolvedValueOnce([{ count: 0 }]);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

    const row = makeRow({
      stage: 'client',
      prospectsInStage: 1,
      revenueClosedToday: 950,
      quotesAcceptedToday: 1,
      avgCycleDaysIntoStage: null,
    });
    await upsertSnapshot(DATE, [row]);

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [text, values] = mockPoolQuery.mock.calls[0];

    expect(text).toMatch(/INSERT INTO daily_metric_snapshot/);
    expect(text).toMatch(/VALUES \(\$1::date,/);

    // 13 params per row × 1 row = 13 values.
    expect(values).toHaveLength(13);
    // Spot-check critical positions.
    expect(values[0]).toBe(DATE);
    expect(values[1]).toBe(REP_A);
    expect(values[3]).toBe('client');
    expect(values[10]).toBe(950);                  // revenue_closed_today
    expect(values[11]).toBe(1);                    // quotes_accepted_today
    expect(values[12]).toBe(null);                 // avg_cycle_days_into_stage
  });

  it('builds one VALUES tuple per row in the bulk insert', async () => {
    mockSql.mockResolvedValueOnce([{ count: 0 }]);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 3 });

    const rows = [
      makeRow({ stage: 'researching' }),
      makeRow({ stage: 'qualified' }),
      makeRow({ stage: 'contacting' }),
    ];
    await upsertSnapshot(DATE, rows);

    const [, values] = mockPoolQuery.mock.calls[0];
    // 13 params per row × 3 rows = 39 values.
    expect(values).toHaveLength(39);
  });

  it('handles the case where DELETE returns no rows (fresh date)', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 2 });

    const result = await upsertSnapshot(DATE, [makeRow(), makeRow({ stage: 'qualified' })]);
    expect(result.deleted).toBe(0);
    expect(result.inserted).toBe(2);
  });
});
