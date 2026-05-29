import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Contact (was /tracking) server actions — logContact, markResponded,
 * closeOut. App-driven lifecycle: the rep never edits stage directly;
 * the actions move it.
 *
 *   qualified  → contacting  (first logContact)
 *   contacting → responded   (markResponded)
 *   contacting → dormant     (closeOut)
 *
 * Each test mocks `@/auth`, `@/lib/db`, `@/lib/prospect-access`, and
 * `@/lib/action-error`, then asserts on the result + the calls that
 * went out. The UPDATE statements themselves are SQL strings the
 * mock can't introspect, so tests assert on call counts and result
 * shape — enough to catch regressions on which action moves which
 * stage.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db', () => ({
  sql: vi.fn(),
  sqlOne: vi.fn(),
}));
vi.mock('@/lib/action-error', () => ({
  actionError: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('@/lib/prospect-access', () => ({
  loadOwnedProspect: vi.fn(),
}));

import { sql, sqlOne } from '@/lib/db';
import { loadOwnedProspect } from '@/lib/prospect-access';
import { logContact, markResponded, closeOut } from './actions';

const mockSql = vi.mocked(sql);
const mockSqlOne = vi.mocked(sqlOne);
const mockLoadOwnedProspect = vi.mocked(loadOwnedProspect);

const USER_ID = 'user-1';

beforeEach(() => {
  mockSql.mockReset();
  mockSqlOne.mockReset();
  mockLoadOwnedProspect.mockReset();
});

function ownsProspect(stage: 'qualified' | 'contacting' | 'responded' = 'qualified') {
  mockLoadOwnedProspect.mockResolvedValue({
    prospect: {
      id: 'p-1',
      workflowKey: 'real_estate',
      contactName: 'Jordan',
      orgName: null,
      ownerId: USER_ID,
      stage,
    },
    userId: USER_ID,
  } as never);
}

// ─── logContact ──────────────────────────────────────────────────────

describe('logContact', () => {
  it('refuses when the rep does not own the prospect', async () => {
    mockLoadOwnedProspect.mockResolvedValue({ error: 'Not yours.' } as never);
    const res = await logContact({
      prospectId: 'p-1',
      stepKey: 'first_touch',
      filledSubject: 's',
      filledBody: 'b',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Not yours/i);
  });

  it('refuses when the step is not an active script', async () => {
    ownsProspect();
    mockSqlOne.mockResolvedValueOnce(null as never); // SELECT contact_scripts → no row
    const res = await logContact({
      prospectId: 'p-1',
      stepKey: 'never_existed',
      filledSubject: 's',
      filledBody: 'b',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/step/i);
  });

  it('refuses an empty body', async () => {
    ownsProspect();
    mockSqlOne.mockResolvedValueOnce({ id: 'script-1', channel: 'email' } as never);
    const res = await logContact({
      prospectId: 'p-1',
      stepKey: 'first_touch',
      filledSubject: 's',
      filledBody: '   ', // whitespace only
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/i);
  });

  it('a qualified prospect on first touch advances to contacting', async () => {
    ownsProspect('qualified');
    mockSqlOne.mockResolvedValueOnce({ id: 'script-1', channel: 'email' } as never);
    mockSql.mockResolvedValueOnce(undefined as never); // INSERT prospect_contacts
    mockSql.mockResolvedValueOnce(undefined as never); // UPDATE prospects SET stage='contacting'
    const res = await logContact({
      prospectId: 'p-1',
      stepKey: 'first_touch',
      filledSubject: 'Subject',
      filledBody: 'Body of the message',
    });
    expect(res.ok).toBe(true);
    // INSERT + stage UPDATE = 2 sql calls
    expect(mockSql.mock.calls.length).toBe(2);
  });

  it('a contacting prospect on a follow-up does NOT change stage', async () => {
    ownsProspect('contacting');
    mockSqlOne.mockResolvedValueOnce({ id: 'script-2', channel: 'email' } as never);
    mockSql.mockResolvedValueOnce(undefined as never); // INSERT only
    const res = await logContact({
      prospectId: 'p-1',
      stepKey: 'followup_1',
      filledSubject: 'Re:',
      filledBody: 'Following up.',
    });
    expect(res.ok).toBe(true);
    // Only the INSERT — no stage UPDATE this time.
    expect(mockSql.mock.calls.length).toBe(1);
  });
});

// ─── markResponded ───────────────────────────────────────────────────

describe('markResponded', () => {
  it('refuses when the rep does not own the prospect', async () => {
    mockLoadOwnedProspect.mockResolvedValue({ error: 'Not yours.' } as never);
    const res = await markResponded({ prospectId: 'p-1', contactId: 'c-1' });
    expect(res.ok).toBe(false);
  });

  it('updates the contact row + advances stage to responded', async () => {
    ownsProspect('contacting');
    mockSql.mockResolvedValueOnce(undefined as never); // UPDATE prospect_contacts
    mockSql.mockResolvedValueOnce(undefined as never); // UPDATE prospects stage
    const res = await markResponded({ prospectId: 'p-1', contactId: 'c-1' });
    expect(res.ok).toBe(true);
    expect(mockSql.mock.calls.length).toBe(2);
  });
});

// ─── closeOut ────────────────────────────────────────────────────────

describe('closeOut', () => {
  it('refuses when the rep does not own the prospect', async () => {
    mockLoadOwnedProspect.mockResolvedValue({ error: 'Not yours.' } as never);
    const res = await closeOut({ prospectId: 'p-1' });
    expect(res.ok).toBe(false);
  });

  it('moves a contacting prospect to dormant', async () => {
    ownsProspect('contacting');
    mockSql.mockResolvedValueOnce(undefined as never); // UPDATE prospects stage='dormant'
    const res = await closeOut({ prospectId: 'p-1' });
    expect(res.ok).toBe(true);
    expect(mockSql.mock.calls.length).toBe(1);
  });
});
