import { describe, it, expect } from 'vitest';
import { buildSnapshotRows } from './rollup';
import type { SnapshotInput } from './types';

/**
 * Phase R · rollup.ts unit tests.
 *
 * These tests cover the pure `buildSnapshotRows` function — it takes
 * the five query result arrays as input and assembles one row per
 * (rep × workflow × stage) tuple. The DB orchestrator
 * (`computeSnapshot`) is integration-tested separately via the cron
 * route test in `src/app/api/cron/snapshot/route.test.ts`.
 */

const DATE = '2026-05-28';
const REP_A = '11111111-1111-1111-1111-111111111111';
const REP_B = '22222222-2222-2222-2222-222222222222';
const RE = 'real_estate';
const CHS = 'corporate';

// Minimal empty input — the union of all five arrays empty. Each test
// spreads this then overrides only the slices it cares about.
const EMPTY_INPUT: SnapshotInput = {
  state: [],
  entered: [],
  exited: [],
  contacts: [],
  revenue: [],
  cycle: [],
};

describe('buildSnapshotRows', () => {
  it('returns one row per (rep × workflow × stage) tuple', () => {
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        { rep_id: REP_A, workflow_key: RE, stage: 'qualified', prospects_in_stage: 5, sum_rank_score: 38 },
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', prospects_in_stage: 3, sum_rank_score: 21 },
        { rep_id: REP_B, workflow_key: CHS, stage: 'qualified', prospects_in_stage: 2, sum_rank_score: 16 },
      ],
    });

    expect(rows).toHaveLength(3);
    const keys = rows.map(r => `${r.repId}|${r.workflowKey}|${r.stage}`);
    expect(keys).toContain(`${REP_A}|${RE}|qualified`);
    expect(keys).toContain(`${REP_A}|${RE}|contacting`);
    expect(keys).toContain(`${REP_B}|${CHS}|qualified`);
  });

  it('stamps every row with the same snapshot date', () => {
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        { rep_id: REP_A, workflow_key: RE, stage: 'qualified', prospects_in_stage: 1, sum_rank_score: 7 },
      ],
    });
    expect(rows[0].snapshotDate).toBe(DATE);
  });

  it('balances entered and exited counts across same-day transitions', () => {
    // Three transitions today: qualified→contacting (twice) and contacting→responded.
    // entered: contacting=2, responded=1
    // exited:  qualified=2, contacting=1
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      entered: [
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', count: 2 },
        { rep_id: REP_A, workflow_key: RE, stage: 'responded', count: 1 },
      ],
      exited: [
        { rep_id: REP_A, workflow_key: RE, stage: 'qualified', count: 2 },
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', count: 1 },
      ],
    });

    const enteredTotal = rows.reduce((sum, r) => sum + r.enteredStageToday, 0);
    const exitedTotal = rows.reduce((sum, r) => sum + r.exitedStageToday, 0);
    expect(enteredTotal).toBe(3);
    expect(exitedTotal).toBe(3);

    // Per-stage assertions
    const find = (stage: string) =>
      rows.find(r => r.stage === stage && r.repId === REP_A && r.workflowKey === RE);
    expect(find('qualified')?.exitedStageToday).toBe(2);
    expect(find('contacting')?.enteredStageToday).toBe(2);
    expect(find('contacting')?.exitedStageToday).toBe(1);
    expect(find('responded')?.enteredStageToday).toBe(1);
  });

  it('maps contact activity to the right (rep × workflow × stage) slice', () => {
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      contacts: [
        {
          rep_id: REP_A,
          workflow_key: RE,
          stage: 'contacting',
          contacts_sent_today: 6,
          responses_today: 2,
        },
        {
          rep_id: REP_B,
          workflow_key: RE,
          stage: 'contacting',
          contacts_sent_today: 3,
          responses_today: 1,
        },
      ],
    });

    expect(rows).toHaveLength(2);
    const a = rows.find(r => r.repId === REP_A);
    const b = rows.find(r => r.repId === REP_B);
    expect(a?.contactsSentToday).toBe(6);
    expect(a?.responsesToday).toBe(2);
    expect(b?.contactsSentToday).toBe(3);
    expect(b?.responsesToday).toBe(1);
  });

  it('attributes revenue to the `client` stage row for the (rep × workflow)', () => {
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      revenue: [
        {
          rep_id: REP_A,
          workflow_key: RE,
          revenue_closed_today: 1200,
          quotes_accepted_today: 3,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe('client');
    expect(rows[0].revenueClosedToday).toBe(1200);
    expect(rows[0].quotesAcceptedToday).toBe(3);
  });

  it('annotates avg_cycle_days_into_stage on matching workflow/stage rows', () => {
    // 4-day average for real-estate transitions into `contacting`.
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', prospects_in_stage: 5, sum_rank_score: 30 },
        { rep_id: REP_B, workflow_key: RE, stage: 'contacting', prospects_in_stage: 2, sum_rank_score: 14 },
      ],
      cycle: [
        { workflow_key: RE, to_stage: 'contacting', avg_days: 4 },
      ],
    });

    // Both rows get the same cycle annotation — it's workflow-level.
    expect(rows.every(r => r.avgCycleDaysIntoStage === 4)).toBe(true);
  });

  it('leaves avg_cycle_days_into_stage null when no transitions happened today', () => {
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        { rep_id: REP_A, workflow_key: RE, stage: 'qualified', prospects_in_stage: 5, sum_rank_score: 30 },
      ],
      cycle: [], // no transitions
    });

    expect(rows[0].avgCycleDaysIntoStage).toBeNull();
  });

  it('returns an empty array when every input is empty', () => {
    const rows = buildSnapshotRows(DATE, EMPTY_INPUT);
    expect(rows).toEqual([]);
  });

  it('merges multiple input arrays touching the same key', () => {
    // Same (rep × workflow × stage) tuple appears in state, entered,
    // and contacts — they should fold into one row.
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', prospects_in_stage: 4, sum_rank_score: 28 },
      ],
      entered: [
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', count: 2 },
      ],
      contacts: [
        {
          rep_id: REP_A,
          workflow_key: RE,
          stage: 'contacting',
          contacts_sent_today: 3,
          responses_today: 1,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      prospectsInStage: 4,
      sumRankScore: 28,
      enteredStageToday: 2,
      contactsSentToday: 3,
      responsesToday: 1,
    });
  });

  it('coerces numeric strings (Postgres NUMERIC) into Number', () => {
    // pg returns NUMERIC as string. The rollup must coerce.
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        // sum_rank_score arrives as a string from pg
        // We type it as `number` in the query row but in reality it's a
        // string; the assembler must defensively coerce.
        { rep_id: REP_A, workflow_key: RE, stage: 'qualified', prospects_in_stage: 5, sum_rank_score: '38.5' as unknown as number },
      ],
      revenue: [
        { rep_id: REP_A, workflow_key: RE, revenue_closed_today: '1234.56' as unknown as number, quotes_accepted_today: 2 },
      ],
    });

    const qualified = rows.find(r => r.stage === 'qualified');
    const client = rows.find(r => r.stage === 'client');
    expect(qualified?.sumRankScore).toBe(38.5);
    expect(client?.revenueClosedToday).toBe(1234.56);
  });

  it('sorts rows deterministically (rep → workflow → stage order)', () => {
    const rows = buildSnapshotRows(DATE, {
      ...EMPTY_INPUT,
      state: [
        { rep_id: REP_B, workflow_key: RE, stage: 'qualified', prospects_in_stage: 1, sum_rank_score: 7 },
        { rep_id: REP_A, workflow_key: CHS, stage: 'researching', prospects_in_stage: 1, sum_rank_score: 5 },
        { rep_id: REP_A, workflow_key: RE, stage: 'contacting', prospects_in_stage: 2, sum_rank_score: 12 },
        { rep_id: REP_A, workflow_key: RE, stage: 'qualified', prospects_in_stage: 4, sum_rank_score: 28 },
      ],
    });

    // REP_A first (alphabetically). Within REP_A: corporate < real_estate.
    // Within real_estate: researching < qualified < contacting (stage rank).
    expect(rows.map(r => `${r.repId.slice(0, 1)}|${r.workflowKey}|${r.stage}`)).toEqual([
      '1|corporate|researching',
      '1|real_estate|qualified',
      '1|real_estate|contacting',
      '2|real_estate|qualified',
    ]);
  });
});
