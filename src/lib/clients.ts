/**
 * Client domain types + pure helpers — the durable-identity layer.
 *
 * No database, no server imports (mirrors lib/prospects.ts), so this file
 * is safe to pull into client components. The owner-scoped data loader
 * lives in lib/client-access.ts; the server actions live under
 * app/clients. See CLIENTS-AND-JOBS-PLAN.md.
 */

export type ClientKind = 'person' | 'org';
export type ClientStatus = 'active' | 'archived';
export type ClientBranch = 'portraits' | 'realestate' | 'corporate';

export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  person: 'Person',
  org: 'Business',
};

export const CLIENT_BRANCH_LABEL: Record<ClientBranch, string> = {
  portraits: 'Portraits',
  realestate: 'Real estate',
  corporate: 'Corporate',
};

/** Up-to-two-letter monogram for the avatar chip. Pure + deterministic. */
export function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Case/space-insensitive match for the search-first add flow and the
 * roster filter. Searches name + email + market area. An empty query
 * matches everything.
 */
export function clientMatches(
  query: string,
  fields: { displayName: string; email?: string | null; marketArea?: string | null },
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [fields.displayName, fields.email ?? '', fields.marketArea ?? '']
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** One-line subtitle for a client row / header. */
export function clientSubtitle(fields: {
  relationship?: string | null;
  marketArea?: string | null;
  email?: string | null;
}): string {
  return (
    [fields.relationship, fields.marketArea, fields.email]
      .filter(Boolean)
      .join(' · ') || 'No details yet'
  );
}

/** A client row as the roster renders it (server pre-formats updatedAt). */
export interface ClientListItem {
  id: string;
  kind: ClientKind;
  displayName: string;
  email: string | null;
  phone: string | null;
  marketArea: string | null;
  relationship: string | null;
  status: ClientStatus;
  ownerName: string | null;
  updatedAtLabel: string;
}
