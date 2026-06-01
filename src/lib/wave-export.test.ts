import { describe, it, expect } from 'vitest';
import { toWaveDate, cleanDescription, waveAmount, toWaveCsv } from './wave-export';

describe('toWaveDate', () => {
  it('converts ISO to MM/DD/YYYY', () => {
    expect(toWaveDate('2026-05-24')).toBe('05/24/2026');
  });
  it('passes through anything not ISO-shaped', () => {
    expect(toWaveDate('whenever')).toBe('whenever');
  });
});

describe('cleanDescription', () => {
  it('strips the characters Wave flags (# & $ *) and collapses the gaps', () => {
    expect(cleanDescription('Sarah #2 & $400 *rush*')).toBe('Sarah 2 400 rush');
  });
  it('collapses whitespace and trims', () => {
    expect(cleanDescription('  a   b  ')).toBe('a b');
  });
  it('never returns empty', () => {
    expect(cleanDescription('###')).toBe('Transaction');
    expect(cleanDescription('   ')).toBe('Transaction');
  });
});

describe('waveAmount', () => {
  it('is 2dp', () => {
    expect(waveAmount(450)).toBe('450.00');
    expect(waveAmount(9.645)).toBe('9.65');
  });
  it('keeps the minus for outflow', () => {
    expect(waveAmount(-120.5)).toBe('-120.50');
  });
});

describe('toWaveCsv', () => {
  it('emits a header and one line per row, CRLF', () => {
    const csv = toWaveCsv([
      { date: '2026-05-24', description: 'Sarah Chen — Fall family (check)', amount: 450 },
      { date: '2026-05-10', description: 'B&H — gear', amount: -120 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Description,Amount');
    // em-dash kept; & stripped; amounts formatted; out is negative.
    expect(lines[1]).toBe('05/24/2026,Sarah Chen — Fall family (check),450.00');
    expect(lines[2]).toBe('05/10/2026,BH — gear,-120.00');
  });

  it('quotes a description containing a comma', () => {
    const csv = toWaveCsv([{ date: '2026-06-01', description: 'Deposit, balance', amount: 100 }]);
    expect(csv.split('\r\n')[1]).toBe('06/01/2026,"Deposit, balance",100.00');
  });

  it('escapes embedded quotes', () => {
    const csv = toWaveCsv([{ date: '2026-06-01', description: 'The "Saga" job', amount: 100 }]);
    expect(csv.split('\r\n')[1]).toBe('06/01/2026,"The ""Saga"" job",100.00');
  });
});
