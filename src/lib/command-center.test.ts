import { describe, it, expect } from 'vitest';
import {
  daysUntil,
  daysSince,
  evaluateJob,
  topSignal,
  buildCommandSections,
  type EvalJob,
} from './command-center';
import type { JobStage, PaymentStatus } from './jobs';

const NOW = new Date('2026-06-01T12:00:00Z'); // a Monday

function job(over: Partial<EvalJob> = {}): EvalJob {
  return {
    id: over.id ?? 'j1',
    clientName: 'Sarah Chen',
    title: 'Fall family',
    stage: (over.stage ?? 'booked') as JobStage,
    workflowName: 'Story Portraits',
    workflowAccent: '#38bdf8',
    shootDate: null,
    deliveryDue: null,
    balanceDue: null,
    depositDue: null,
    paymentStatus: (over.paymentStatus ?? 'unpaid') as PaymentStatus,
    valuePrice: over.valuePrice ?? null,
    deliveredAt: null,
    reviewRequestedAt: null,
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

describe('date helpers', () => {
  it('daysUntil is signed, day-granular, null-safe', () => {
    expect(daysUntil('2026-06-01', NOW)).toBe(0);
    expect(daysUntil('2026-06-03', NOW)).toBe(2);
    expect(daysUntil('2026-05-30', NOW)).toBe(-2);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('garbage', NOW)).toBeNull();
  });
  it('daysSince floors elapsed days', () => {
    expect(daysSince('2026-05-25T12:00:00Z', NOW)).toBe(7);
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('evaluateJob — deadline signals', () => {
  it('flags a shoot today', () => {
    const s = evaluateJob(job({ shootDate: '2026-06-01', stage: 'booked' }), NOW);
    expect(s.some((x) => x.kind === 'shoot_today')).toBe(true);
  });
  it('flags a shoot within the soon window as prep', () => {
    const s = evaluateJob(job({ shootDate: '2026-06-02', stage: 'booked' }), NOW);
    expect(s.some((x) => x.kind === 'shoot_soon')).toBe(true);
  });
  it('does NOT flag a shoot once the job is past the shoot stage', () => {
    const s = evaluateJob(job({ shootDate: '2026-06-01', stage: 'edit' }), NOW);
    expect(s.some((x) => x.kind.startsWith('shoot'))).toBe(false);
  });
  it('flags an overdue delivery, scaled by lateness', () => {
    const near = topSignal(evaluateJob(job({ deliveryDue: '2026-05-30', stage: 'edit' }), NOW))!;
    const far = topSignal(evaluateJob(job({ deliveryDue: '2026-05-10', stage: 'edit' }), NOW))!;
    expect(near.kind).toBe('delivery_overdue');
    expect(far.score).toBeGreaterThan(near.score); // later = more urgent
  });
  it('stops flagging delivery once delivered (stage past edit)', () => {
    const s = evaluateJob(job({ deliveryDue: '2026-05-20', stage: 'deliver' }), NOW);
    expect(s.some((x) => x.kind.startsWith('delivery'))).toBe(false);
  });
});

describe('evaluateJob — money signals', () => {
  it('flags an overdue balance when not paid', () => {
    const s = evaluateJob(job({ balanceDue: '2026-05-28', paymentStatus: 'deposit_paid' }), NOW);
    expect(s.some((x) => x.kind === 'balance_overdue')).toBe(true);
  });
  it('never flags money once paid in full', () => {
    const s = evaluateJob(
      job({ balanceDue: '2026-05-01', depositDue: '2026-05-01', paymentStatus: 'paid' }),
      NOW,
    );
    expect(s.some((x) => x.section === 'money')).toBe(false);
  });
  it('deposit due only fires while fully unpaid', () => {
    expect(
      evaluateJob(job({ depositDue: '2026-05-30', paymentStatus: 'unpaid' }), NOW).some(
        (x) => x.kind === 'deposit_due',
      ),
    ).toBe(true);
    expect(
      evaluateJob(job({ depositDue: '2026-05-30', paymentStatus: 'deposit_paid' }), NOW).some(
        (x) => x.kind === 'deposit_due',
      ),
    ).toBe(false);
  });
});

describe('evaluateJob — review + cold + closed', () => {
  it('flags a ripe review ask after delivery', () => {
    const s = evaluateJob(
      job({ stage: 'deliver', deliveredAt: '2026-05-27T12:00:00Z' }),
      NOW,
    );
    expect(s.some((x) => x.kind === 'review_ready')).toBe(true);
  });
  it('does not re-ask once the review was requested', () => {
    const s = evaluateJob(
      job({
        stage: 'deliver',
        deliveredAt: '2026-05-27T12:00:00Z',
        reviewRequestedAt: '2026-05-28T12:00:00Z',
      }),
      NOW,
    );
    expect(s.some((x) => x.kind === 'review_ready')).toBe(false);
  });
  it('flags a cold job only when no sharper signal exists', () => {
    const cold = evaluateJob(job({ stage: 'prep', updatedAt: '2026-05-10T12:00:00Z' }), NOW);
    expect(cold.some((x) => x.kind === 'stalled')).toBe(true);
    // A cold job that also has a shoot tomorrow shows the shoot, not stalled.
    const both = evaluateJob(
      job({ stage: 'prep', updatedAt: '2026-05-10T12:00:00Z', shootDate: '2026-06-02' }),
      NOW,
    );
    expect(both.some((x) => x.kind === 'stalled')).toBe(false);
    expect(both.some((x) => x.kind === 'shoot_soon')).toBe(true);
  });
  it('a closed job fires nothing', () => {
    expect(evaluateJob(job({ stage: 'complete', deliveryDue: '2026-01-01' }), NOW)).toHaveLength(0);
    expect(evaluateJob(job({ stage: 'cancelled', shootDate: '2026-06-01' }), NOW)).toHaveLength(0);
  });
});

describe('buildCommandSections', () => {
  it('partitions into the four lenses and sums only unpaid-in-full money', () => {
    const data = buildCommandSections(
      [
        job({ id: 'shoot', stage: 'booked', shootDate: '2026-06-02', valuePrice: 900, paymentStatus: 'unpaid' }),
        job({ id: 'late', stage: 'edit', deliveryDue: '2026-05-20', valuePrice: 1700, paymentStatus: 'deposit_paid' }),
        job({ id: 'handoff', stage: 'deliver', valuePrice: 400, paymentStatus: 'paid' }),
        job({ id: 'done', stage: 'complete', valuePrice: 5000, paymentStatus: 'unpaid' }),
      ],
      NOW,
    );

    // 'shoot' (soon) + 'late' (overdue delivery) are needs-now; 'handoff' is not.
    expect(data.needsNow.map((r) => r.id).sort()).toEqual(['late', 'shoot']);
    // soonest shoot in the this-week lens
    expect(data.thisWeek.map((r) => r.id)).toEqual(['shoot']);
    // deliver lens: the 'handoff' job in deliver stage
    expect(data.toDeliver.map((r) => r.id)).toEqual(['handoff']);
    // money: shoot (unpaid 900) + late (deposit_paid, flagged but not summed).
    // 'handoff' is paid → excluded; 'done' is closed → excluded.
    expect(data.money.lines.map((r) => r.id).sort()).toEqual(['late', 'shoot']);
    expect(data.money.outstanding).toBe(900);
  });

  it('needs-now is sorted highest priority first', () => {
    const data = buildCommandSections(
      [
        job({ id: 'soon', stage: 'booked', shootDate: '2026-06-02' }),
        job({ id: 'veryLate', stage: 'edit', deliveryDue: '2026-05-01' }),
      ],
      NOW,
    );
    expect(data.needsNow[0].id).toBe('veryLate'); // overdue delivery outranks a prep
  });

  it('allClear when nothing is live', () => {
    const data = buildCommandSections([job({ stage: 'complete' })], NOW);
    expect(data.allClear).toBe(true);
    expect(data.counts.needsNow).toBe(0);
  });
});
