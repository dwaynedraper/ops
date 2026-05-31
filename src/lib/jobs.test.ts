import { describe, it, expect } from 'vitest';
import {
  JOB_STAGE_FLOW,
  JOB_STAGE_NEXT,
  JOB_STAGE_LABEL,
  isJobClosed,
  jobStageIndex,
  jobStageActionLabel,
  needsShootDate,
  type JobStage,
} from './jobs';

describe('job lifecycle invariants', () => {
  it('every stage in the flow has a label', () => {
    for (const s of JOB_STAGE_FLOW) {
      expect(JOB_STAGE_LABEL[s]).toBeTruthy();
    }
  });

  it('every NEXT target is a real stage', () => {
    const all = Object.keys(JOB_STAGE_LABEL) as JobStage[];
    for (const targets of Object.values(JOB_STAGE_NEXT)) {
      for (const t of targets) expect(all).toContain(t);
    }
  });

  it('each live stage can advance and can cancel', () => {
    for (const s of JOB_STAGE_FLOW) {
      expect(JOB_STAGE_NEXT[s].length).toBeGreaterThan(0);
      expect(JOB_STAGE_NEXT[s]).toContain('cancelled');
    }
  });

  it('terminal stages can only reopen to booked', () => {
    expect(JOB_STAGE_NEXT.complete).toEqual(['booked']);
    expect(JOB_STAGE_NEXT.cancelled).toEqual(['booked']);
  });
});

describe('isJobClosed', () => {
  it('is true only for complete + cancelled', () => {
    expect(isJobClosed('complete')).toBe(true);
    expect(isJobClosed('cancelled')).toBe(true);
    expect(isJobClosed('booked')).toBe(false);
    expect(isJobClosed('deliver')).toBe(false);
  });
});

describe('jobStageIndex', () => {
  it('is 1-based along the flow', () => {
    expect(jobStageIndex('booked')).toBe(1);
    expect(jobStageIndex('shoot')).toBe(3);
    expect(jobStageIndex('review')).toBe(8);
  });
  it('is 0 for terminal stages', () => {
    expect(jobStageIndex('complete')).toBe(0);
    expect(jobStageIndex('cancelled')).toBe(0);
  });
});

describe('jobStageActionLabel', () => {
  it('special-cases the terminal + reopen moves', () => {
    expect(jobStageActionLabel('complete')).toMatch(/complete/i);
    expect(jobStageActionLabel('cancelled')).toMatch(/cancel/i);
    expect(jobStageActionLabel('booked')).toMatch(/reopen/i);
  });
  it('reads "Move to X" otherwise', () => {
    expect(jobStageActionLabel('edit')).toBe('Move to Edit');
  });
});

describe('needsShootDate', () => {
  it('flags booked/prep with no date', () => {
    expect(needsShootDate('booked', null)).toBe(true);
    expect(needsShootDate('prep', null)).toBe(true);
  });
  it('is false once a date is set or past prep', () => {
    expect(needsShootDate('booked', '2026-06-10')).toBe(false);
    expect(needsShootDate('shoot', null)).toBe(false);
  });
});
