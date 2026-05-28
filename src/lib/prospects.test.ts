import { describe, it, expect } from 'vitest';
import {
  scoreProspect,
  classifyBand,
  stageForBand,
  gatesPassed,
  STAGE_NEXT,
  DEFAULT_BANDS,
  type RankFactor,
  type RankInputs,
} from './prospects';

/**
 * Prospect scoring + lifecycle-progression tests. All pure — no dates,
 * no database.
 *
 * Reflects D-032: gates now contribute weight; annual_volume runs on a
 * piecewise curve (10 → 2.0, 30 → 3.0); branded_email dropped;
 * active_social halved to 1.
 */

// The seven seeded real_estate rank factors (mirrors scripts/db-seed.mjs).
// Weights sum to 10.
const FACTORS: RankFactor[] = [
  { key: 'has_target_listing', label: 'Has target listing', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: true, sortOrder: 1 },
  { key: 'has_photo_need', label: 'Photo need', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: true, sortOrder: 2 },
  { key: 'annual_volume', label: 'Listings per year', helpText: null, kind: 'number', weight: 3, maxInput: 30, isGate: false, sortOrder: 10 },
  { key: 'weak_current_photos', label: 'Weak current photos', helpText: null, kind: 'bool', weight: 2, maxInput: null, isGate: false, sortOrder: 20 },
  { key: 'active_social', label: 'Active on social', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: false, sortOrder: 30 },
  { key: 'pro_website', label: 'Has a real website', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: false, sortOrder: 40 },
  { key: 'uses_video', label: 'Uses video', helpText: null, kind: 'bool', weight: 1, maxInput: null, isGate: false, sortOrder: 50 },
];

const BOTH_GATES: RankInputs = {
  has_target_listing: true,
  has_photo_need: true,
};

describe('scoreProspect — the 0–10 rank', () => {
  it('an empty answer set scores 0', () => {
    expect(scoreProspect(FACTORS, {}).score).toBe(0);
  });

  it('every factor maxed scores a clean 10', () => {
    const inputs: RankInputs = {
      ...BOTH_GATES,
      annual_volume: 30,
      weak_current_photos: true,
      active_social: true,
      pro_website: true,
      uses_video: true,
    };
    expect(scoreProspect(FACTORS, inputs).score).toBe(10);
  });

  it('gates alone — without any other factor — score 2.0', () => {
    // Each gate contributes 1.0 now (D-032).
    expect(scoreProspect(FACTORS, BOTH_GATES).score).toBe(2);
  });

  it('gates + 10 listings = 4.0 (Dean target)', () => {
    expect(
      scoreProspect(FACTORS, { ...BOTH_GATES, annual_volume: 10 }).score,
    ).toBe(4);
  });

  it('gates + 30 listings = 5.0 (Dean target)', () => {
    expect(
      scoreProspect(FACTORS, { ...BOTH_GATES, annual_volume: 30 }).score,
    ).toBe(5);
  });

  it('annual_volume runs on the piecewise curve', () => {
    // 5 listings = 5/10 × 2.0 = 1.0
    expect(scoreProspect(FACTORS, { annual_volume: 5 }).score).toBe(1);
    // 10 listings = 2.0 exactly (knee)
    expect(scoreProspect(FACTORS, { annual_volume: 10 }).score).toBe(2);
    // 20 listings = 2 + (20-10)/20 = 2.5
    expect(scoreProspect(FACTORS, { annual_volume: 20 }).score).toBe(2.5);
    // 30 listings = 3.0 (cap)
    expect(scoreProspect(FACTORS, { annual_volume: 30 }).score).toBe(3);
    // 100 listings still caps at 3
    expect(scoreProspect(FACTORS, { annual_volume: 100 }).score).toBe(3);
  });
});

describe('gatesPassed — entry gate', () => {
  it('passes when every gate is true', () => {
    expect(gatesPassed(FACTORS, BOTH_GATES)).toBe(true);
  });

  it('fails if any gate is missing or false', () => {
    expect(gatesPassed(FACTORS, { has_target_listing: true })).toBe(false);
    expect(gatesPassed(FACTORS, { ...BOTH_GATES, has_photo_need: false })).toBe(false);
    expect(gatesPassed(FACTORS, {})).toBe(false);
  });
});

describe('classifyBand — qualified / borderline / reject', () => {
  it('8 and up is qualified', () => {
    expect(classifyBand(8, DEFAULT_BANDS)).toBe('qualified');
    expect(classifyBand(10, DEFAULT_BANDS)).toBe('qualified');
  });

  it('6 up to just under 8 is borderline', () => {
    expect(classifyBand(6, DEFAULT_BANDS)).toBe('borderline');
    expect(classifyBand(7.9, DEFAULT_BANDS)).toBe('borderline');
  });

  it('under 6 is reject — do not message', () => {
    expect(classifyBand(5.9, DEFAULT_BANDS)).toBe('reject');
    expect(classifyBand(0, DEFAULT_BANDS)).toBe('reject');
  });
});

describe('stageForBand — qualify outcome to lifecycle stage', () => {
  it('qualified prospects enter the pipeline as qualified', () => {
    expect(stageForBand('qualified')).toBe('qualified');
  });

  it('borderline prospects park in researching', () => {
    expect(stageForBand('borderline')).toBe('researching');
  });

  it('rejects are logged as rejected', () => {
    expect(stageForBand('reject')).toBe('rejected');
  });
});

describe('STAGE_NEXT — allowed lifecycle moves', () => {
  it('a responded prospect can be marked signed', () => {
    expect(STAGE_NEXT.responded).toContain('signed');
  });

  it('a signed prospect becomes an active client', () => {
    expect(STAGE_NEXT.signed).toContain('client');
  });

  it('client is a terminal stage', () => {
    expect(STAGE_NEXT.client).toEqual([]);
  });

  it('a rejected prospect can be reopened as qualified', () => {
    expect(STAGE_NEXT.rejected).toContain('qualified');
  });
});
