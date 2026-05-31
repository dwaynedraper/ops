/**
 * Owner-scoped client loader — the access gate shared by every client
 * page server action. Mirrors lib/prospect-access.ts (D-019): a partner
 * may only touch clients they own; a super_admin may touch any. Returns
 * the client + the viewer's identity, or an { error } the action
 * surfaces verbatim.
 */

import { auth } from '@/auth';
import { sqlOne, isUuid } from '@/lib/db';
import type { ClientStatus } from '@/lib/clients';

interface OwnedClient {
  userId: string;
  isAdmin: boolean;
  client: {
    id: string;
    ownerId: string;
    status: ClientStatus;
  };
}

export async function loadOwnedClient(
  clientId: string,
): Promise<OwnedClient | { error: string }> {
  if (!isUuid(clientId)) return { error: 'That client does not exist.' };

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Your session has expired — sign in again.' };
  const isAdmin = session.user?.role === 'super_admin';

  const row = await sqlOne<{ owner_id: string; status: ClientStatus }>`
    SELECT owner_id, status FROM clients WHERE id = ${clientId}`;
  if (!row) return { error: 'That client does not exist.' };

  if (row.owner_id !== userId && !isAdmin) {
    return { error: 'That client is not yours to edit.' };
  }

  return {
    userId,
    isAdmin,
    client: { id: clientId, ownerId: row.owner_id, status: row.status },
  };
}
