import { describe, it, expect } from 'vitest';
import {
  computeCycle,
  extractPlaceholders,
  fillTemplate,
  nextScript,
  splitPlaceholders,
  type ContactScript,
  type CycleContact,
  type HandoffLink,
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

describe('splitPlaceholders — human vs config (handoff links)', () => {
  const LINKS: HandoffLink[] = [
    { linkKey: 'booking_link', label: 'Connection-call booking', url: 'https://book.example/x' },
  ];

  it('a token matching a handoff link is a config placeholder', () => {
    const { human, config } = splitPlaceholders(['first_name', 'booking_link'], LINKS);
    expect(human).toEqual(['first_name']);
    expect(config.map((l) => l.linkKey)).toEqual(['booking_link']);
  });

  it('with no links every placeholder stays human', () => {
    const { human, config } = splitPlaceholders(['first_name', 'booking_link'], []);
    expect(human).toEqual(['first_name', 'booking_link']);
    expect(config).toEqual([]);
  });

  it('a config placeholder resolves to its live URL in the composed message', () => {
    const body = 'Book here: {{booking_link}} — thanks, {{rep_name}}';
    const placeholders = extractPlaceholders(body);
    const { config } = splitPlaceholders(placeholders, LINKS);
    const values = Object.fromEntries(LINKS.map((l) => [l.linkKey, l.url]));
    values.rep_name = 'Dean';
    expect(config).toHaveLength(1);
    expect(fillTemplate(body, values)).toBe('Book here: https://book.example/x — thanks, Dean');
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

// ─── D-051 urgency — Contact card status dot ─────────────────────────

/**
 * The urgency field came in with F5 / D-051. Locks the four buckets:
 *   now      — needs action right now (replied / ready / due ≤ 24h)
 *   soon     — due within 24h (waiting, dueInDays === 1)
 *   overdue  — > 24h past due
 *   idle     — waiting > 1 day or cycle done
 */
describe('computeCycle — D-051 urgency', () => {
  const DAY1_T1 = new Date('2026-04-01T10:00:00Z'); // a fixed sent date

  it('replied → urgency=now (green)', () => {
    const cycle = computeCycle(SCRIPTS, [], 'responded', DAY1_T1);
    expect(cycle.urgency).toBe('now');
  });

  it('ready (qualified, no touch yet) → urgency=now', () => {
    const cycle = computeCycle(SCRIPTS, [], 'qualified', DAY1_T1);
    expect(cycle.status).toBe('ready');
    expect(cycle.urgency).toBe('now');
  });

  it('waiting with dueInDays > 1 → urgency=idle', () => {
    // Sent today; follow-up due in 3 days. Look at "now + 1 hour" — still 3 days out.
    const cycle = computeCycle(
      SCRIPTS,
      [{ stepKey: 'first_touch', sentAt: DAY1_T1, responseReceived: false }],
      'contacting',
      new Date(DAY1_T1.getTime() + 60 * 60 * 1000),
    );
    expect(cycle.status).toBe('waiting');
    expect(cycle.dueInDays).toBeGreaterThan(1);
    expect(cycle.urgency).toBe('idle');
  });

  it('waiting with dueInDays === 1 → urgency=soon (yellow)', () => {
    // Follow-up after 3 days; check 2 days + 1 hour after send — 1 day left.
    const checkAt = new Date(DAY1_T1.getTime() + (2 * 24 + 1) * 60 * 60 * 1000);
    const cycle = computeCycle(
      SCRIPTS,
      [{ stepKey: 'first_touch', sentAt: DAY1_T1, responseReceived: false }],
      'contacting',
      checkAt,
    );
    expect(cycle.status).toBe('waiting');
    expect(cycle.dueInDays).toBe(1);
    expect(cycle.urgency).toBe('soon');
  });

  it('due, within 24h of becoming due → urgency=now (green)', () => {
    // Follow-up after 3 days; check at exactly day 3 (just became due).
    const checkAt = new Date(DAY1_T1.getTime() + 3 * 24 * 60 * 60 * 1000);
    const cycle = computeCycle(
      SCRIPTS,
      [{ stepKey: 'first_touch', sentAt: DAY1_T1, responseReceived: false }],
      'contacting',
      checkAt,
    );
    expect(cycle.status).toBe('due');
    expect(cycle.urgency).toBe('now');
  });

  it('due, more than 24h past due → urgency=overdue (red)', () => {
    // Day 5 (2 days past the 3-day follow-up window).
    const checkAt = new Date(DAY1_T1.getTime() + 5 * 24 * 60 * 60 * 1000);
    const cycle = computeCycle(
      SCRIPTS,
      [{ stepKey: 'first_touch', sentAt: DAY1_T1, responseReceived: false }],
      'contacting',
      checkAt,
    );
    expect(cycle.status).toBe('due');
    expect(cycle.urgency).toBe('overdue');
  });

  it('cycle_done → urgency=idle (no dot color)', () => {
    // Send final touch (0-day follow-up); cycle exhausts.
    const final = {
      stepKey: 'final',
      sentAt: DAY1_T1,
      responseReceived: false,
    };
    const cycle = computeCycle(SCRIPTS, [final], 'contacting', DAY1_T1);
    expect(cycle.status).toBe('cycle_done');
    expect(cycle.urgency).toBe('idle');
  });

  it('the 24h boundary between now and overdue is exactly day + 1', () => {
    // Window: 3 days. Just under 24h overdue → now. Just over → overdue.
    const justUnder = new Date(DAY1_T1.getTime() + (3 * 24 + 23) * 60 * 60 * 1000);
    const justOver = new Date(DAY1_T1.getTime() + (4 * 24 + 1) * 60 * 60 * 1000);
    const contacts = [
      { stepKey: 'first_touch', sentAt: DAY1_T1, responseReceived: false },
    ];
    expect(computeCycle(SCRIPTS, contacts, 'contacting', justUnder).urgency).toBe('now');
    expect(computeCycle(SCRIPTS, contacts, 'contacting', justOver).urgency).toBe('overdue');
  });
});
