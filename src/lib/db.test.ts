import { describe, expect, it } from 'vitest';
import { isTransientConnError, isUuid } from './db';

describe('isTransientConnError', () => {
  it('flags the pool acquire timeout (the prospect-page symptom)', () => {
    expect(isTransientConnError(new Error('timeout exceeded when trying to connect'))).toBe(true);
  });

  it('flags socket / reconnection failures', () => {
    for (const msg of [
      'Connection terminated unexpectedly',
      'read ECONNRESET',
      'connect ETIMEDOUT 10.0.0.1:5432',
      'connection refused',
      'terminating connection due to administrator command', // Neon scale-to-zero
    ]) {
      expect(isTransientConnError(new Error(msg)), msg).toBe(true);
    }
  });

  it('does NOT retry real query errors (would mask bugs / double-apply writes)', () => {
    for (const msg of [
      'duplicate key value violates unique constraint "prospects_pkey"',
      'null value in column "contact_name" violates not-null constraint',
      'syntax error at or near "SELCT"',
      'relation "packages" does not exist',
    ]) {
      expect(isTransientConnError(new Error(msg)), msg).toBe(false);
    }
  });

  it('handles non-Error throwables without crashing', () => {
    expect(isTransientConnError('timeout exceeded when trying to connect')).toBe(true);
    expect(isTransientConnError(null)).toBe(false);
    expect(isTransientConnError(undefined)).toBe(false);
  });
});

describe('isUuid (unchanged guard, regression check)', () => {
  it('accepts a canonical uuid', () => {
    expect(isUuid('36bea67a-0925-4152-a8a2-b7fa8344daec')).toBe(true);
  });
  it('rejects junk', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
