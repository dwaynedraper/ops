import { describe, it, expect } from 'vitest';
import {
  buildColumnConfig,
  hasAnyHardQualifierFilled,
  needsOverride,
  stageForSourcingStatus,
  EMPTY_SOURCING_ROW,
  type SourcingStatus,
} from './sourcing';
import type { RankFactor, ProspectStage } from './prospects';

/**
 * Sourcing-lib tests — the rules that decide:
 *   • when an override-with-reason is required (D-028 + D-045 carve-out)
 *   • what lifecycle stage a status toggle sets (D-024 + D-034)
 *   • whether a row has any hard-qualifier signal (the partial badge)
 *   • which columns Sourcing renders per workflow (D-027)
 *
 * All pure — no dates, no DB, no React. These are the small contracts
 * a lot of the V2 UI rests on; they fail fast if the rules drift.
 */

// ─── needsOverride — the band-disagreement rule + the D-045 carve-out ──

describe('needsOverride — band disagreement', () => {
  it('undecided is never an override', () => {
    expect(needsOverride('undecided', 'qualified')).toBe(false);
    expect(needsOverride('undecided', 'borderline')).toBe(false);
    expect(needsOverride('undecided', 'reject')).toBe(false);
  });

  it('borderline band makes no recommendation — no override', () => {
    expect(needsOverride('pursue', 'borderline')).toBe(false);
    expect(needsOverride('qualify', 'borderline')).toBe(false);
    expect(needsOverride('reject', 'borderline')).toBe(false);
  });

  it('rejecting a qualified-band agent IS an override', () => {
    expect(needsOverride('reject', 'qualified')).toBe(true);
  });

  it('marking a reject-band agent positive IS an override', () => {
    expect(needsOverride('pursue', 'reject')).toBe(true);
    expect(needsOverride('qualify', 'reject')).toBe(true);
  });

  it('rejecting a reject-band agent is not an override (they agree)', () => {
    expect(needsOverride('reject', 'reject')).toBe(false);
  });

  it('marking a qualified-band agent positive is not an override (they agree)', () => {
    expect(needsOverride('pursue', 'qualified')).toBe(false);
    expect(needsOverride('qualify', 'qualified')).toBe(false);
  });
});

describe('needsOverride — D-045 skip-when-empty carve-out', () => {
  // The carve-out only engages when caller supplies the rank-input
  // snapshot. The bare two-arg form keeps the V1 behavior unchanged.
  const FACTOR_KEYS = ['has_target_listing', 'has_photo_need', 'annual_volume'];

  it('without options, the bare rule still fires (unchanged)', () => {
    // band='reject' + status='pursue' is normally an override case.
    expect(needsOverride('pursue', 'reject')).toBe(true);
  });

  it('with options + every factor empty, the rule yields false', () => {
    expect(
      needsOverride('pursue', 'reject', {
        rankInputs: {},
        factorKeys: FACTOR_KEYS,
      }),
    ).toBe(false);
  });

  it('with options + every factor explicitly false / 0, the rule yields false', () => {
    expect(
      needsOverride('pursue', 'reject', {
        rankInputs: { has_target_listing: false, has_photo_need: false, annual_volume: 0 },
        factorKeys: FACTOR_KEYS,
      }),
    ).toBe(false);
  });

  it('the moment any qualifier is set, the rule re-engages', () => {
    // One bool gate flipped → override required.
    expect(
      needsOverride('pursue', 'reject', {
        rankInputs: { has_target_listing: true, has_photo_need: false, annual_volume: 0 },
        factorKeys: FACTOR_KEYS,
      }),
    ).toBe(true);

    // One integer factor non-zero → override required.
    expect(
      needsOverride('pursue', 'reject', {
        rankInputs: { has_target_listing: false, has_photo_need: false, annual_volume: 5 },
        factorKeys: FACTOR_KEYS,
      }),
    ).toBe(true);
  });

  it('factorKeys missing from rankInputs are treated as unfilled', () => {
    // Pass a factorKeys list with no entries in rankInputs at all.
    expect(
      needsOverride('reject', 'qualified', {
        rankInputs: {},
        factorKeys: FACTOR_KEYS,
      }),
    ).toBe(false);
  });

  it('a stray non-factor key in rankInputs does not trigger the rule', () => {
    // Only `factorKeys` count, not arbitrary entries on rankInputs.
    expect(
      needsOverride('pursue', 'reject', {
        rankInputs: { unrelated_key: true },
        factorKeys: FACTOR_KEYS,
      }),
    ).toBe(false);
  });
});

// ─── stageForSourcingStatus — toggle → lifecycle stage ────────────────

describe('stageForSourcingStatus — D-024 + D-034 mapping', () => {
  it('Sourcing pursue keeps stage at researching (does NOT qualify — D-034)', () => {
    expect(stageForSourcingStatus('pursue', 'researching')).toBe('researching');
  });

  it('Qualify mode (status=qualify) advances stage to qualified', () => {
    expect(stageForSourcingStatus('qualify', 'researching')).toBe('qualified');
  });

  it('reject moves stage to rejected', () => {
    expect(stageForSourcingStatus('reject', 'researching')).toBe('rejected');
  });

  it('undecided parks at researching', () => {
    expect(stageForSourcingStatus('undecided', 'researching')).toBe('researching');
  });

  it('later stages do NOT reverse from a status edit', () => {
    // A prospect in contacting / responded / signed / client / dormant
    // has moved past Sourcing's reach. Even a reject doesn't reverse them.
    const downstream: ProspectStage[] = ['contacting', 'responded', 'signed', 'client', 'dormant'];
    const statuses: SourcingStatus[] = ['undecided', 'pursue', 'qualify', 'reject'];
    for (const stage of downstream) {
      for (const status of statuses) {
        expect(stageForSourcingStatus(status, stage)).toBe(stage);
      }
    }
  });

  it('rejected can be reopened (it IS in the reversible set)', () => {
    // The reversible set is researching / qualified / rejected. So a
    // sourcing edit on a rejected row can flip it back.
    expect(stageForSourcingStatus('pursue', 'rejected')).toBe('researching');
    expect(stageForSourcingStatus('qualify', 'rejected')).toBe('qualified');
  });

  it('qualified can be re-rejected (the reversible set)', () => {
    expect(stageForSourcingStatus('reject', 'qualified')).toBe('rejected');
  });
});

// ─── hasAnyHardQualifierFilled — the partial badge indicator ──────────

describe('hasAnyHardQualifierFilled', () => {
  const KEYS = ['has_target_listing', 'has_photo_need', 'annual_volume'];

  it('an empty rankInputs has no qualifiers', () => {
    expect(hasAnyHardQualifierFilled({}, KEYS)).toBe(false);
  });

  it('every explicit false / 0 is still "none filled"', () => {
    expect(
      hasAnyHardQualifierFilled(
        { has_target_listing: false, has_photo_need: false, annual_volume: 0 },
        KEYS,
      ),
    ).toBe(false);
  });

  it('one bool gate flipped → true', () => {
    expect(hasAnyHardQualifierFilled({ has_target_listing: true }, KEYS)).toBe(true);
  });

  it('one integer factor > 0 → true', () => {
    expect(hasAnyHardQualifierFilled({ annual_volume: 1 }, KEYS)).toBe(true);
  });

  it('keys NOT in the hard-qualifier list are ignored', () => {
    expect(hasAnyHardQualifierFilled({ active_social: true }, KEYS)).toBe(false);
  });
});

// ─── buildColumnConfig — what Sourcing renders per workflow ───────────

const RE_FACTORS: RankFactor[] = [
  { key: 'has_target_listing', label: 'Has target listing', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: true, sortOrder: 1 },
  { key: 'has_photo_need', label: 'Photo need', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: true, sortOrder: 2 },
  { key: 'annual_volume', label: 'Listings per year', helpText: null, kind: 'number', weight: 3, maxInput: 30, isGate: false, sortOrder: 10 },
  { key: 'active_social', label: 'Active on social', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: false, sortOrder: 20 },
  // weight: 1 means NOT a hard qualifier (gates + weight ≥ 3 only).
];

describe('buildColumnConfig — column composition (D-027)', () => {
  it('puts contactName / orgName / marketArea up front for every workflow', () => {
    const cols = buildColumnConfig('story_portraits', []);
    expect(cols[0].key).toBe('contactName');
    expect(cols[1].key).toBe('orgName');
    expect(cols[2].key).toBe('marketArea');
  });

  it('marks contactName as the primary column', () => {
    const cols = buildColumnConfig('story_portraits', []);
    expect(cols[0].isPrimary).toBe(true);
  });

  it('real_estate gets the grossVolume intake column', () => {
    const cols = buildColumnConfig('real_estate', []);
    const gross = cols.find((c) => c.key === 'grossVolume');
    expect(gross).toBeDefined();
    expect(gross?.kind).toBe('currency');
    expect(gross?.group).toBe('intake');
  });

  it('non-real-estate workflows do NOT get grossVolume', () => {
    for (const wf of ['corporate', 'story_portraits', 'saga', 'ten_percent']) {
      const cols = buildColumnConfig(wf, []);
      expect(cols.find((c) => c.key === 'grossVolume')).toBeUndefined();
    }
  });

  it('hard qualifiers (gates + weight ≥ 3) surface as columns', () => {
    const cols = buildColumnConfig('real_estate', RE_FACTORS);
    expect(cols.find((c) => c.key === 'has_target_listing')).toBeDefined(); // gate
    expect(cols.find((c) => c.key === 'has_photo_need')).toBeDefined(); // gate
    expect(cols.find((c) => c.key === 'annual_volume')).toBeDefined(); // weight 3
  });

  it('supporting factors (weight < 3, not gates) do NOT surface as columns', () => {
    const cols = buildColumnConfig('real_estate', RE_FACTORS);
    // active_social: weight 1, not a gate.
    expect(cols.find((c) => c.key === 'active_social')).toBeUndefined();
  });

  it('hard qualifiers are sorted by sort_order', () => {
    const factors: RankFactor[] = [
      // Out-of-order on purpose.
      { key: 'b', label: 'B', helpText: null, kind: 'bool', weight: 3, maxInput: null, isGate: false, sortOrder: 30 },
      { key: 'a', label: 'A', helpText: null, kind: 'bool', weight: 3, maxInput: null, isGate: false, sortOrder: 10 },
      { key: 'c', label: 'C', helpText: null, kind: 'bool', weight: 3, maxInput: null, isGate: false, sortOrder: 20 },
    ];
    const cols = buildColumnConfig('real_estate', factors).filter(
      (c) => c.group === 'qualifier',
    );
    expect(cols.map((c) => c.key)).toEqual(['a', 'c', 'b']);
  });

  it('the sourcingStatus column lands at the end', () => {
    const cols = buildColumnConfig('real_estate', RE_FACTORS);
    expect(cols[cols.length - 1].key).toBe('sourcingStatus');
  });

  it('the sourceUrl column lands between qualifiers and status', () => {
    const cols = buildColumnConfig('real_estate', RE_FACTORS);
    const sourceIdx = cols.findIndex((c) => c.key === 'sourceUrl');
    const statusIdx = cols.findIndex((c) => c.key === 'sourcingStatus');
    expect(sourceIdx).toBeGreaterThan(0);
    expect(statusIdx).toBeGreaterThan(sourceIdx);
  });

  it('bool qualifiers render as the bool column kind', () => {
    const cols = buildColumnConfig('real_estate', RE_FACTORS);
    const gate = cols.find((c) => c.key === 'has_target_listing');
    expect(gate?.kind).toBe('bool');
  });

  it('number qualifiers render as the integer column kind', () => {
    const cols = buildColumnConfig('real_estate', RE_FACTORS);
    const vol = cols.find((c) => c.key === 'annual_volume');
    expect(vol?.kind).toBe('integer');
  });
});

// ─── EMPTY_SOURCING_ROW — the add-form starting point ─────────────────

describe('EMPTY_SOURCING_ROW', () => {
  it('starts undecided with score 0 and no qualifiers filled', () => {
    expect(EMPTY_SOURCING_ROW.sourcingStatus).toBe('undecided');
    expect(EMPTY_SOURCING_ROW.rankScore).toBe(0);
    expect(EMPTY_SOURCING_ROW.hasPartialScore).toBe(false);
    expect(EMPTY_SOURCING_ROW.rankInputs).toEqual({});
  });

  it('starts in the researching stage', () => {
    expect(EMPTY_SOURCING_ROW.stage).toBe('researching');
  });

  it('omits the server-assigned fields (id, workflowKey, createdAt)', () => {
    // The Omit on EMPTY_SOURCING_ROW guarantees these three never end
    // up on a fresh-row template. If anyone adds them back, this test
    // breaks first.
    type Keys = keyof typeof EMPTY_SOURCING_ROW;
    const presentKeys: Set<string> = new Set(Object.keys(EMPTY_SOURCING_ROW) as Keys[]);
    expect(presentKeys.has('id')).toBe(false);
    expect(presentKeys.has('workflowKey')).toBe(false);
    expect(presentKeys.has('createdAt')).toBe(false);
  });
});
