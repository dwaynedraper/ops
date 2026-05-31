'use server';

/**
 * Client roster actions — create a durable client, and the search-first
 * typeahead the add flow uses to avoid duplicates. Owner-scoped: a partner
 * only creates within / searches their own book; a super_admin sees all
 * (D-019). See CLIENTS-AND-JOBS-PLAN.md.
 */

import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import type { ClientKind, ClientBranch } from '@/lib/clients';

export interface CreateClientResult {
  ok: boolean;
  id?: string;
  error?: string;
}

function orNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

export async function createClient(input: {
  kind: ClientKind;
  displayName: string;
  email?: string;
  phone?: string;
  marketArea?: string;
  relationship?: string;
  referralSource?: string;
  branchAffinity?: ClientBranch | '';
}): Promise<CreateClientResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Your session has expired — sign in again.' };

  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: 'A client needs a name.' };

  const kind: ClientKind = input.kind === 'org' ? 'org' : 'person';
  const branch = input.branchAffinity ? input.branchAffinity : null;

  try {
    const row = await sqlOne<{ id: string }>`
      INSERT INTO clients
        (kind, display_name, email, phone, market_area, relationship,
         referral_source, branch_affinity, owner_id)
      VALUES (${kind}, ${displayName}, ${orNull(input.email)}, ${orNull(input.phone)},
              ${orNull(input.marketArea)}, ${orNull(input.relationship)},
              ${orNull(input.referralSource)}, ${branch}, ${userId})
      RETURNING id`;
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not create the client.') };
  }
}

export interface ClientSearchHit {
  id: string;
  displayName: string;
  kind: ClientKind;
  email: string | null;
  marketArea: string | null;
  relationship: string | null;
  status: 'active' | 'archived';
}

interface SearchRow {
  id: string;
  display_name: string;
  kind: ClientKind;
  email: string | null;
  market_area: string | null;
  relationship: string | null;
  status: 'active' | 'archived';
}

/** Typeahead for the add flow + duplicate guard. Max 8 hits. */
export async function searchClients(query: string): Promise<ClientSearchHit[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];
  const isAdmin = session.user?.role === 'super_admin';

  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const like = `%${q}%`;

  const rows = isAdmin
    ? await sql<SearchRow>`
        SELECT id, display_name, kind, email, market_area, relationship, status
        FROM clients
        WHERE lower(display_name) LIKE ${like}
           OR lower(coalesce(email, '')) LIKE ${like}
           OR lower(coalesce(market_area, '')) LIKE ${like}
        ORDER BY (status = 'archived'), display_name
        LIMIT 8`
    : await sql<SearchRow>`
        SELECT id, display_name, kind, email, market_area, relationship, status
        FROM clients
        WHERE owner_id = ${userId}
          AND ( lower(display_name) LIKE ${like}
             OR lower(coalesce(email, '')) LIKE ${like}
             OR lower(coalesce(market_area, '')) LIKE ${like} )
        ORDER BY (status = 'archived'), display_name
        LIMIT 8`;

  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    kind: r.kind,
    email: r.email,
    marketArea: r.market_area,
    relationship: r.relationship,
    status: r.status,
  }));
}
