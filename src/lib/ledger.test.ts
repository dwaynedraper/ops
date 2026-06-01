import { describe, it, expect } from 'vitest';
import { mileageAmount, jobProfit, isExpenseCategory } from './ledger';

describe('mileageAmount', () => {
  it('is miles times rate, rounded to cents', () => {
    expect(mileageAmount(40, 0.725)).toBe(29);
    expect(mileageAmount(13.3, 0.725)).toBe(9.64); // 9.6425 → 9.64
  });
  it('is zero for non-positive or junk input', () => {
    expect(mileageAmount(0, 0.725)).toBe(0);
    expect(mileageAmount(-5, 0.725)).toBe(0);
    expect(mileageAmount(NaN, 0.725)).toBe(0);
    expect(mileageAmount(40, 0)).toBe(0);
  });
});

describe('jobProfit', () => {
  it('is value minus expenses minus mileage', () => {
    const p = jobProfit(900, 120, 29);
    expect(p.net).toBe(751);
  });
  it('treats a null value as zero for the math but keeps it visible', () => {
    const p = jobProfit(null, 50, 10);
    expect(p.value).toBeNull();
    expect(p.net).toBe(-60);
  });
  it('rounds to cents', () => {
    expect(jobProfit(100, 33.333, 0).net).toBe(66.67);
  });
});

describe('isExpenseCategory', () => {
  it('accepts known categories and rejects others', () => {
    expect(isExpenseCategory('gear')).toBe(true);
    expect(isExpenseCategory('general')).toBe(true);
    expect(isExpenseCategory('nonsense')).toBe(false);
  });
});
