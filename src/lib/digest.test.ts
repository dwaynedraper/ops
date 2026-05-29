import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Digest-partitioning tests (D-020 + F12 / D-063).
 *
 * `computeDigest` queries the DB via the `sql` tagged template, then
 * partitions the rep's mid-cycle prospects into five buckets:
 *
 *   • replies        — agent wrote back, rep takes it from here
 *   • dueNow         — first touches ready or follow-ups overdue
 *   • closeOuts      — cycle exhausted, no reply
 *   • waiting        — mid-window, not actionable today
 *   • allClear       — true when nothing needs the rep
 *
 * The pure cycle logic that powers each item lives in
 * `lib/tracking.ts` (computeCycle) — covered by tracking.test.ts.
 * These tests pin the partitioning + sort + soonestWait math.
 *
 * Strategy: mock the `@/lib/db` `sql` tagged template. The function
 * runs three queries in parallel (workflows, scripts, prospects),
 * then optionally one more (contacts) if any prospects matched.
 * Each test pre-loads the mock with synthetic rows and asserts on
 * the returned buckets.
 */

vi.mock('@/lib/db', () => ({
  sql: vi.fn(),
}));

import { sql } from '@/lib/db';
import { computeDigest } from './digest';

const mockSql = vi.mocked(sql);

// ─── Fixture builders ────────────────────────────────────────────────

const NOW = new Date('2026-05-01T10:00:00Z');

const REAL_ESTATE = {
  workflow_key: 'real_estate',
  name: 'Real Estate Media',
  accent: '#c9922a',
};

const SCRIPTS_RE = [
  { workflow_key: 'real_estate', stage_key: 'first_touch', label: 'First touch', channel: 'email', step_order: 10, followup_after_days: 3, subject: null, body: '' },
  { workflow_key: 'real_estate', stage_key: 'followup_1', label: 'Follow-up 1', channel: 'email', step_order: 20, followup_after_days: 4, subject: null, body: '' },
  { workflow_key: 'real_estate', stage_key: 'followup_2', label: 'Follow-up 2', channel: 'email', step_order: 30, followup_after_days: 5, subject: null, body: '' },
  { workflow_key: 'real_estate', stage_key: 'final', label: 'Final touch', channel: 'email', step_order: 40, followup_after_days: 0, subject: null, body: '' },
];

function prospect(
  id: string,
  stage: 'qualified' | 'contacting' | 'responded',
  rankScore = 7.5,
) {
  return {
    id,
    workflow_key: 'real_estate',
    contact_name: id,
    org_name: null,
    stage,
    rank_score: String(rankScore),
  };
}

function contact(prospectId: string, stepKey: string, sentDaysAgo: number, replied = false) {
  return {
    prospect_id: prospectId,
    step_key: stepKey,
    sent_at: new Date(NOW.getTime() - sentDaysAgo * 24 * 60 * 60 * 1000),
    response_received: replied,
  };
}

/**
 * Set up the mock call queue. The function issues:
 *   1. SELECT workflows
 *   2. SELECT scripts
 *   3. SELECT prospects
 *   4. (only if prospects matched) SELECT contacts
 */
function setupMock(prospects: ReturnType<typeof prospect>[], contacts: ReturnType<typeof contact>[]) {
  mockSql.mockReset();
  mockSql
    .mockResolvedValueOnce([REAL_ESTATE] as never)
    .mockResolvedValueOnce(SCRIPTS_RE as never)
    .mockResolvedValueOnce(prospects as never);
  if (prospects.length > 0) {
    mockSql.mockResolvedValueOnce(contacts as never);
  }
}

beforeEach(() => {
  mockSql.mockReset();
});

// ─── Partitioning ────────────────────────────────────────────────────

describe('computeDigest — partitioning', () => {
  it('a responded prospect lands in replies', async () => {
    setupMock([prospect('a', 'responded')], []);
    const digest = await computeDigest('user', NOW);
    expect(digest.replies.length).toBe(1);
    expect(digest.replies[0].id).toBe('a');
    expect(digest.dueNow.length).toBe(0);
    expect(digest.allClear).toBe(false);
  });

  it('a qualified prospect with no touch lands in dueNow as ready', async () => {
    setupMock([prospect('a', 'qualified')], []);
    const digest = await computeDigest('user', NOW);
    expect(digest.dueNow.length).toBe(1);
    expect(digest.dueNow[0].status).toBe('ready');
  });

  it('a contacting prospect inside the follow-up window lands in waiting', async () => {
    // Sent 1 day ago; first-touch follow-up is 3 days → 2 days left.
    setupMock(
      [prospect('a', 'contacting')],
      [contact('a', 'first_touch', 1)],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.waiting.length).toBe(1);
    expect(digest.dueNow.length).toBe(0);
  });

  it('a contacting prospect past the follow-up window lands in dueNow as due', async () => {
    // Sent 5 days ago; first-touch follow-up is 3 days → due.
    setupMock(
      [prospect('a', 'contacting')],
      [contact('a', 'first_touch', 5)],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.dueNow.length).toBe(1);
    expect(digest.dueNow[0].status).toBe('due');
  });

  it('a contacting prospect after the final touch lands in closeOuts', async () => {
    // All four touches sent; the final is a 0-day step → cycle_done.
    setupMock(
      [prospect('a', 'contacting')],
      [
        contact('a', 'first_touch', 20),
        contact('a', 'followup_1', 15),
        contact('a', 'followup_2', 10),
        contact('a', 'final', 5),
      ],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.closeOuts.length).toBe(1);
  });

  it('allClear is true only when replies + dueNow + closeOuts are all empty', async () => {
    // One waiting prospect — not actionable today.
    setupMock(
      [prospect('a', 'contacting')],
      [contact('a', 'first_touch', 1)],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.allClear).toBe(true);
  });

  it('allClear is true when there are no prospects at all', async () => {
    setupMock([], []);
    const digest = await computeDigest('user', NOW);
    expect(digest.allClear).toBe(true);
    expect(digest.total).toBe(0);
  });

  it('total counts replies + dueNow + closeOuts, NOT waiting', async () => {
    // 1 replied + 1 ready + 1 closeout + 1 waiting → total = 3.
    setupMock(
      [
        prospect('rpl', 'responded', 8),
        prospect('rdy', 'qualified', 7),
        prospect('clo', 'contacting', 6),
        prospect('wai', 'contacting', 5),
      ],
      [
        // Closeout: all four touches sent.
        contact('clo', 'first_touch', 20),
        contact('clo', 'followup_1', 15),
        contact('clo', 'followup_2', 10),
        contact('clo', 'final', 5),
        // Waiting: one touch, recent.
        contact('wai', 'first_touch', 1),
      ],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.total).toBe(3);
    expect(digest.replies.length).toBe(1);
    expect(digest.dueNow.length).toBe(1);
    expect(digest.closeOuts.length).toBe(1);
    expect(digest.waiting.length).toBe(1);
  });
});

// ─── Sort + soonestWait ──────────────────────────────────────────────

describe('computeDigest — sort + soonestWait', () => {
  it('dueNow puts due before ready (status rank)', async () => {
    setupMock(
      [
        prospect('ready', 'qualified', 9),
        prospect('due', 'contacting', 9),
      ],
      [contact('due', 'first_touch', 5)], // 5 days, past the 3-day window
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.dueNow.map((i) => i.id)).toEqual(['due', 'ready']);
  });

  it('ties on status break by rankScore desc', async () => {
    setupMock(
      [
        prospect('low', 'qualified', 5.5),
        prospect('high', 'qualified', 9.0),
        prospect('mid', 'qualified', 7.5),
      ],
      [],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.dueNow.map((i) => i.id)).toEqual(['high', 'mid', 'low']);
  });

  it('soonestWait returns the smallest dueInDays from the waiting set', async () => {
    setupMock(
      [
        prospect('a', 'contacting'),
        prospect('b', 'contacting'),
        prospect('c', 'contacting'),
      ],
      [
        contact('a', 'first_touch', 0), // due in 3 days
        contact('b', 'first_touch', 2), // due in 1 day
        contact('c', 'first_touch', 1), // due in 2 days
      ],
    );
    const digest = await computeDigest('user', NOW);
    expect(digest.waiting.length).toBe(3);
    expect(digest.soonestWait).toBe(1);
  });

  it('soonestWait is null when nothing is waiting', async () => {
    setupMock([prospect('a', 'qualified')], []);
    const digest = await computeDigest('user', NOW);
    expect(digest.waiting.length).toBe(0);
    expect(digest.soonestWait).toBeNull();
  });
});

// ─── Item shape ──────────────────────────────────────────────────────

describe('computeDigest — item shape', () => {
  it('every item carries workflow accent + name from the workflow row', async () => {
    setupMock([prospect('a', 'qualified')], []);
    const digest = await computeDigest('user', NOW);
    const item = digest.dueNow[0];
    expect(item.workflowName).toBe('Real Estate Media');
    expect(item.workflowAccent).toBe('#c9922a');
  });

  it('a prospect from a workflow not in the workflow list falls back to defaults', async () => {
    // Setup but make the prospect's workflow_key not match any
    // workflow row (e.g. workflow was deactivated mid-cycle).
    mockSql.mockReset();
    mockSql
      .mockResolvedValueOnce([] as never) // no active workflows
      .mockResolvedValueOnce([] as never) // no scripts
      .mockResolvedValueOnce([prospect('a', 'qualified')] as never)
      .mockResolvedValueOnce([] as never); // contacts
    const digest = await computeDigest('user', NOW);
    const item = digest.dueNow[0];
    expect(item.workflowName).toBe('real_estate'); // falls back to key
    expect(item.workflowAccent).toBeTruthy(); // fallback color set
  });
});
