/**
 * Owner-scoped job loader — the access gate shared by every job server
 * action. Mirrors lib/prospect-access.ts + lib/client-access.ts (D-019):
 * a partner may only touch jobs they own; a super_admin may touch any.
 */

import { auth } from '@/auth';
import { sqlOne, isUuid } from '@/lib/db';
import type { JobStage } from '@/lib/jobs';

interface OwnedJob {
  userId: string;
  isAdmin: boolean;
  job: {
    id: string;
    ownerId: string;
    clientId: string;
    stage: JobStage;
  };
}

export async function loadOwnedJob(jobId: string): Promise<OwnedJob | { error: string }> {
  if (!isUuid(jobId)) return { error: 'That job does not exist.' };

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Your session has expired — sign in again.' };
  const isAdmin = session.user?.role === 'super_admin';

  const row = await sqlOne<{ owner_id: string; client_id: string; stage: JobStage }>`
    SELECT owner_id, client_id, stage FROM jobs WHERE id = ${jobId}`;
  if (!row) return { error: 'That job does not exist.' };

  if (row.owner_id !== userId && !isAdmin) {
    return { error: 'That job is not yours to edit.' };
  }

  return {
    userId,
    isAdmin,
    job: { id: jobId, ownerId: row.owner_id, clientId: row.client_id, stage: row.stage },
  };
}
