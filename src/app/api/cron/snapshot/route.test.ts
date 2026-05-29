import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Phase R · /api/cron/snapshot route tests.
 *
 * Covers the auth gate (CRON_SECRET present + correct header/query),
 * happy-path response shape, and the partial-failure → non-2xx
 * contract. The rollup + upsert are mocked so this test pins the
 * route's wiring without hitting the DB.
 */

const { mockComputeSnapshot, mockUpsertSnapshot } = vi.hoisted(() => ({
  mockComputeSnapshot: vi.fn(),
  mockUpsertSnapshot: vi.fn(),
}));

vi.mock('@/lib/reports/rollup', () => ({
  computeSnapshot: mockComputeSnapshot,
}));
vi.mock('@/lib/reports/upsert', () => ({
  upsertSnapshot: mockUpsertSnapshot,
}));

import { GET } from './route';
import type { NextRequest } from 'next/server';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function makeReq(opts: { auth?: string; querySecret?: string } = {}): NextRequest {
  const url = new URL(
    `http://localhost/api/cron/snapshot${opts.querySecret ? `?secret=${opts.querySecret}` : ''}`,
  );
  const headers = new Headers();
  if (opts.auth) headers.set('authorization', opts.auth);
  // Cast through unknown — we only use the fields the route reads.
  return {
    headers,
    nextUrl: url,
  } as unknown as NextRequest;
}

describe('GET /api/cron/snapshot', () => {
  beforeEach(() => {
    mockComputeSnapshot.mockReset();
    mockUpsertSnapshot.mockReset();
    process.env.CRON_SECRET = 'test-secret-abc';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it('returns 503 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/CRON_SECRET/);
  });

  it('returns 401 when no auth is provided', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns 401 when the auth header has the wrong value', async () => {
    const res = await GET(makeReq({ auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the ?secret= query param has the wrong value', async () => {
    const res = await GET(makeReq({ querySecret: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('accepts the correct Authorization header', async () => {
    mockComputeSnapshot.mockResolvedValueOnce([
      { snapshotDate: '2026-05-27', repId: 'r1', workflowKey: 'real_estate', stage: 'qualified', prospectsInStage: 1, enteredStageToday: 0, exitedStageToday: 0, contactsSentToday: 0, responsesToday: 0, sumRankScore: 0, revenueClosedToday: 0, quotesAcceptedToday: 0, avgCycleDaysIntoStage: null },
    ]);
    mockUpsertSnapshot.mockResolvedValueOnce({ deleted: 0, inserted: 1, tookMs: 12 });

    const res = await GET(makeReq({ auth: 'Bearer test-secret-abc' }));
    expect(res.status).toBe(200);
  });

  it('accepts the correct ?secret= query param', async () => {
    mockComputeSnapshot.mockResolvedValueOnce([]);
    mockUpsertSnapshot.mockResolvedValueOnce({ deleted: 0, inserted: 0, tookMs: 2 });

    const res = await GET(makeReq({ querySecret: 'test-secret-abc' }));
    expect(res.status).toBe(200);
  });

  it('returns the rollup + upsert counts in a 200 response', async () => {
    mockComputeSnapshot.mockResolvedValueOnce([
      { snapshotDate: '2026-05-27', repId: 'r1', workflowKey: 'real_estate', stage: 'qualified', prospectsInStage: 4, enteredStageToday: 1, exitedStageToday: 0, contactsSentToday: 0, responsesToday: 0, sumRankScore: 28, revenueClosedToday: 0, quotesAcceptedToday: 0, avgCycleDaysIntoStage: null },
      { snapshotDate: '2026-05-27', repId: 'r1', workflowKey: 'real_estate', stage: 'contacting', prospectsInStage: 2, enteredStageToday: 0, exitedStageToday: 1, contactsSentToday: 3, responsesToday: 1, sumRankScore: 15, revenueClosedToday: 0, quotesAcceptedToday: 0, avgCycleDaysIntoStage: 4.2 },
    ]);
    mockUpsertSnapshot.mockResolvedValueOnce({ deleted: 2, inserted: 2, tookMs: 18 });

    const res = await GET(makeReq({ auth: 'Bearer test-secret-abc' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rows).toBe(2);
    expect(body.deleted).toBe(2);
    expect(body.inserted).toBe(2);
    expect(body.snapshotDate).toBe('2026-05-27');
  });

  it('returns 500 when the rollup throws', async () => {
    mockComputeSnapshot.mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await GET(makeReq({ auth: 'Bearer test-secret-abc' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/DB connection lost/);
  });

  it('returns 500 when the upsert throws', async () => {
    mockComputeSnapshot.mockResolvedValueOnce([]);
    mockUpsertSnapshot.mockRejectedValueOnce(new Error('constraint violation'));

    const res = await GET(makeReq({ auth: 'Bearer test-secret-abc' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/constraint violation/);
  });

  it('computes a CT-anchored window even when the rollup returns no rows', async () => {
    mockComputeSnapshot.mockResolvedValueOnce([]);
    mockUpsertSnapshot.mockResolvedValueOnce({ deleted: 0, inserted: 0, tookMs: 1 });

    const res = await GET(makeReq({ auth: 'Bearer test-secret-abc' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.dayStartUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00/);
  });
});
