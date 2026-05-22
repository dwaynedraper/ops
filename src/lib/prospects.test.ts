import { describe, it, expect } from 'vitest';
import {
  scoreProspect,
  classifyBand,
  stageForBand,
  STAGE_NEXT,
  DEFAULT_BANDS,
  type RankFactor,
  type RankInputs,
} from './prospects';

/**
 * Prospect scoring + lifecycle-progression tests. All pure — no dates,
 * no database.
 */

// The six seeded rank factors (mirrors scripts/db-seed.mjs). Weights sum to 10.
const FACTORS: RankFactor[] = [
  { key: 'annual_volume', label: 'Listings per year', helpText: null, kind: 'number', weight: 3, maxInput: 24, sortOrder: 10 },
  { key: 'active_social', label: 'Active on social', helpText: null, kind: 'bool', weight: 2, maxInput: null, sortOrder: 20 },
  { key: 'weak_current_photos', label: 'Weak current photos', helpText: null, kind: 'bool', weight: 2, maxInput: null, sortOrder: 30 },
  { key: 'pro_website', label: 'Has a real website', helpText: null, kind: 'bool', weight: 1, maxInput: null, sortOrder: 40 },
  { key: 'branded_email', label: 'Branded email', helpText: null, kind: 'bool', weight: 1, maxInput: null, sortOrder: 50 },
  { key: 'uses_video', label: 'Uses video', helpText: null, kind: 'bool', weight: 1, maxInput: null, sortOrder: 60 },
];

describe('scoreProspect — the 0–10 rank', () => {
  it('an empty answer set scores 0', () => {
    expect(scoreProspect(FACTORS, {}).score).toBe(0);
  });

  it('every factor maxed scores a clean 10', () => {
    const inputs: RankInputs = {
      annual_volume: 24,
      active_social: true,
      weak_current_photos: true,
      pro_website: true,
      branded_email: true,
      uses_video: true,
    };
    expect(scoreProspect(FACTORS, inputs).score).toBe(10);
  });

  it('a number factor scales linearly toward its max', () => {
    // 12 of 24 listings = half of weight 3 = 1.5 earned of 10 → score 1.5
    expect(scoreProspect(FACTORS, { annual_volume: 12 }).score).toBe(1.5);
  });

  it('a number factor clamps at its max', () => {
    // 100 listings still earns only the full weight 3 → score 3.0
    expect(scoreProspect(FACTORS, { annual_volume: 100 }).score).toBe(3);
  });

  it('a realistic mix lands in the borderline band', () => {
    const r = scoreProspect(FACTORS, {
      annual_volume: 24, // 3
      active_social: true, // 2
      weak_current_photos: true, // 2
    });
    expect(r.score).toBe(7);
    expect(classifyBand(r.score, DEFAULT_BANDS)).toBe('borderline');
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

describe('stageForBand — research outcome to lifecycle stage', () => {
  it('qualified prospects enter the pipeline as qualified', () => {
    expect(stageForBand('qualified')).toBe('qualified');
  });

  it('borderline prospects park in researching', () => {
    expect(stageForBand('borderline')).toBe('researching');
  });

  it('rejects are logged as passed', () => {
    expect(stageForBand('reject')).toBe('passed');
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

  it('a passed prospect can be reopened as qualified', () => {
    expect(STAGE_NEXT.passed).toContain('qualified');
  });
});
