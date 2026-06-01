import { describe, it, expect } from 'vitest';
import {
  receivedTotal,
  expectedTotal,
  derivePaymentStatus,
  paidFraction,
  lastReceivedOn,
  nextExpectedOn,
  type PaymentRow,
} from './money';

function row(over: Partial<PaymentRow>): PaymentRow {
  return {
    id: over.id ?? 'p',
    kind: over.kind ?? 'payment',
    amount: over.amount ?? 0,
    status: over.status ?? 'expected',
    dueOn: over.dueOn ?? null,
    receivedOn: over.receivedOn ?? null,
    method: over.method ?? null,
    note: over.note ?? null,
  };
}

describe('totals', () => {
  it('receivedTotal sums received and subtracts refunds', () => {
    const rows = [
      row({ amount: 450, status: 'received', receivedOn: '2026-05-24' }),
      row({ amount: 450, status: 'expected', dueOn: '2026-06-07' }),
      row({ kind: 'refund', amount: 50, status: 'received', receivedOn: '2026-05-25' }),
    ];
    expect(receivedTotal(rows)).toBe(400);
    expect(expectedTotal(rows)).toBe(450);
  });
});

describe('derivePaymentStatus', () => {
  it('is unpaid with nothing received', () => {
    expect(derivePaymentStatus([row({ amount: 900, status: 'expected' })], 900)).toBe('unpaid');
  });
  it('is deposit_paid on a partial against a known value', () => {
    const rows = [row({ amount: 450, status: 'received', receivedOn: '2026-05-24' })];
    expect(derivePaymentStatus(rows, 900)).toBe('deposit_paid');
  });
  it('is paid once collected meets the value', () => {
    const rows = [
      row({ amount: 450, status: 'received', receivedOn: '2026-05-24' }),
      row({ amount: 450, status: 'received', receivedOn: '2026-06-07' }),
    ];
    expect(derivePaymentStatus(rows, 900)).toBe('paid');
  });
  it('treats an exact-to-the-cent total as paid, a penny short as still owed', () => {
    const exact = [
      row({ amount: 450.5, status: 'received', receivedOn: '2026-05-24' }),
      row({ amount: 449.5, status: 'received', receivedOn: '2026-06-07' }),
    ];
    expect(derivePaymentStatus(exact, 900)).toBe('paid');
    const pennyShort = [row({ amount: 899.99, status: 'received', receivedOn: '2026-06-07' })];
    expect(derivePaymentStatus(pennyShort, 900)).toBe('deposit_paid');
  });
  it('with no value, is paid once nothing is still expected', () => {
    const inFull = [row({ amount: 300, status: 'received', receivedOn: '2026-05-24' })];
    expect(derivePaymentStatus(inFull, null)).toBe('paid');
    const partial = [
      row({ amount: 300, status: 'received', receivedOn: '2026-05-24' }),
      row({ amount: 300, status: 'expected', dueOn: '2026-06-07' }),
    ];
    expect(derivePaymentStatus(partial, null)).toBe('deposit_paid');
  });
});

describe('paidFraction', () => {
  it('is collected over value', () => {
    const rows = [row({ amount: 450, status: 'received', receivedOn: '2026-05-24' })];
    expect(paidFraction(rows, 900)).toBeCloseTo(0.5, 5);
  });
  it('falls back to total scheduled when no value', () => {
    const rows = [
      row({ amount: 300, status: 'received', receivedOn: '2026-05-24' }),
      row({ amount: 100, status: 'expected', dueOn: '2026-06-07' }),
    ];
    expect(paidFraction(rows, null)).toBeCloseTo(0.75, 5);
  });
  it('clamps to [0,1]', () => {
    const over = [row({ amount: 1200, status: 'received', receivedOn: '2026-05-24' })];
    expect(paidFraction(over, 900)).toBe(1);
    expect(paidFraction([], 900)).toBe(0);
  });
});

describe('heartbeat dates', () => {
  const rows = [
    row({ amount: 450, status: 'received', receivedOn: '2026-05-24' }),
    row({ amount: 200, status: 'received', receivedOn: '2026-05-10' }),
    row({ amount: 450, status: 'expected', dueOn: '2026-06-07' }),
    row({ amount: 100, status: 'expected', dueOn: '2026-06-20' }),
  ];
  it('lastReceivedOn picks the most recent received', () => {
    expect(lastReceivedOn(rows)).toBe('2026-05-24');
  });
  it('nextExpectedOn picks the soonest upcoming', () => {
    expect(nextExpectedOn(rows)).toBe('2026-06-07');
  });
  it('are null when absent', () => {
    expect(lastReceivedOn([])).toBeNull();
    expect(nextExpectedOn([])).toBeNull();
  });
});
