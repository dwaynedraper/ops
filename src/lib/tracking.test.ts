import { describe, it, expect } from 'vitest';
import {
  computeCycle,
  nextScript,
  type ContactScript,
  type CycleContact,
} from './tracking';

/**
 * Contact-cycle progression tests.
 *
 * The cycle is time-driven, but `computeCycle` takes `now` as an explicit
 * argument — so every trigger is checked against synthetic dates. No real
 * days need to pass.
 */

// The four seeded contact scripts (mirrors scripts/db-seed.mjs).
const SCRIPTS: ContactScript[] = [
  { id: 's1', stageKey: 'first_touch', label: 'First touch', channel: 'email', stepOrder: 10, followupAfterDays: 3, subject: 's', body: 'b' },
  { id: 's2', stageKey: 'followup_1', label: 'Follow-up 1', channel: 'email', stepOrder: 20, followupAfterDays: 4, subject: 's', body: 'b' },
  { id: 's3', stageKey: 'followup_2', label: 'Follow-up 2', channel: 'email', stepOrder: 30, followupAfterDays: 5, subject: 's', body: 'b' },
  { id: 's4', stageKey: 'final', label: 'Final touch', channel: 'email', stepOrder: 40, followupAfterDays: 0, subject: 's', body: 'b' },
];

const NOW = new Date('2026-05-21T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);
const hoursAgo = (n: number): Date => new Date(NOW.getTime() - n * 3_600_000);

function contact(stepKey: string, sentAt: Date): CycleContact {
  return { stepKey, sentAt, responseReceived: false };
}

describe('computeCycle — contact-cycle progression', () => {
  it('a qualified prospect with no touch sent is ready for the first touch', () => {
    const r = computeCycle(SCRIPTS, [], 'qualified', NOW);
    expect(r.status).toBe('ready');
    expect(r.nextScript?.stageKey).toBe('first_touch');
    expect(r.dueInDays).toBeNull();
  });

  it('a responded prospect leaves the cycle — the rep takes over', () => {
    const r = computeCycle(SCRIPTS, [contact('first_touch', daysAgo(2))], 'responded', NOW);
    expect(r.status).toBe('replied');
    expect(r.nextScript).toBeNull();
  });

  it('inside the follow-up window the next touch is waiting', () => {
    const r = computeCycle(SCRIPTS, [contact('first_touch', daysAgo(1))], 'contacting', NOW);
    expect(r.status).toBe('waiting');
    expect(r.dueInDays).toBe(2); // first_touch interval is 3 days; 3 − 1 = 2
    expect(r.nextScript?.stageKey).toBe('followup_1');
  });

  it('the follow-up fires exactly on day 3', () => {
    const r = computeCycle(SCRIPTS, [contact('first_touch', daysAgo(3))], 'contacting', NOW);
    expect(r.status).toBe('due');
    expect(r.nextScript?.stageKey).toBe('followup_1');
  });

  it('one hour before day 3 it is still waiting', () => {
    const r = computeCycle(SCRIPTS, [contact('first_touch', hoursAgo(3 * 24 - 1))], 'contacting', NOW);
    expect(r.status).toBe('waiting');
    expect(r.dueInDays).toBe(1);
  });

  it('an overdue follow-up still reads as due', () => {
    const r = computeCycle(SCRIPTS, [contact('first_touch', daysAgo(40))], 'contacting', NOW);
    expect(r.status).toBe('due');
    expect(r.nextScript?.stageKey).toBe('followup_1');
  });

  it('each step uses its own follow-up interval', () => {
    // followup_1's interval is 4 days. Sent 2 days ago → still waiting.
    const waiting = computeCycle(
      SCRIPTS,
      [contact('first_touch', daysAgo(6)), contact('followup_1', daysAgo(2))],
      'contacting',
      NOW,
    );
    expect(waiting.status).toBe('waiting');
    expect(waiting.dueInDays).toBe(2);
    expect(waiting.nextScript?.stageKey).toBe('followup_2');

    // Sent 4 days ago → due.
    const due = computeCycle(
      SCRIPTS,
      [contact('first_touch', daysAgo(8)), contact('followup_1', daysAgo(4))],
      'contacting',
      NOW,
    );
    expect(due.status).toBe('due');
    expect(due.nextScript?.stageKey).toBe('followup_2');
  });

  it('after the final touch the cycle is done — nothing left to send', () => {
    const r = computeCycle(
      SCRIPTS,
      [
        contact('first_touch', daysAgo(20)),
        contact('followup_1', daysAgo(16)),
        contact('followup_2', daysAgo(11)),
        contact('final', daysAgo(6)),
      ],
      'contacting',
      NOW,
    );
    expect(r.status).toBe('cycle_done');
    expect(r.nextScript).toBeNull();
  });

  it('the 0-day final never schedules another follow-up', () => {
    const r = computeCycle(
      SCRIPTS,
      [
        contact('first_touch', daysAgo(14)),
        contact('followup_1', daysAgo(10)),
        contact('followup_2', daysAgo(5)),
        contact('final', daysAgo(0)),
      ],
      'contacting',
      NOW,
    );
    expect(r.status).toBe('cycle_done');
  });
});

describe('nextScript — step ordering', () => {
  it('no touches sent → the first script', () => {
    expect(nextScript(SCRIPTS, new Set())?.stageKey).toBe('first_touch');
  });

  it('first touch done → follow-up 1', () => {
    expect(nextScript(SCRIPTS, new Set(['first_touch']))?.stageKey).toBe('followup_1');
  });

  it('three steps done → the final', () => {
    expect(
      nextScript(SCRIPTS, new Set(['first_touch', 'followup_1', 'followup_2']))?.stageKey,
    ).toBe('final');
  });

  it('all steps done → null', () => {
    expect(
      nextScript(SCRIPTS, new Set(['first_touch', 'followup_1', 'followup_2', 'final'])),
    ).toBeNull();
  });
});
