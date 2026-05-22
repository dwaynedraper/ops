'use client';

/**
 * The team roster — invite, activate, suspend, disable.
 *
 * super_admin only (the page gates before rendering this). Two parts:
 * an invite form + pending-invite list, and the team itself. Reps are
 * never deleted; their status changes. Every action round-trips a
 * server action and refreshes.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  inviteRep,
  resendInvite,
  cancelInvite,
  setRepStatus,
  setRepRole,
  type ActionResult,
} from './actions';
import type { RepStatus } from '@/lib/rep-access';

export type Role = 'super_admin' | 'partner';

export interface RepRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: RepStatus;
  lastSeenLabel: string;
  joinedLabel: string;
}

export interface InviteRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  invitedLabel: string;
}

const STATUS_META: Record<RepStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--good)' },
  invited: { label: 'Awaiting activation', color: 'var(--accent)' },
  suspended: { label: 'Suspended', color: 'var(--warn)' },
  disabled: { label: 'Disabled', color: 'var(--text-faint)' },
};

const STATUS_ORDER: RepStatus[] = ['invited', 'active', 'suspended', 'disabled'];

export function TeamRosterView({
  reps,
  invites,
  currentUserId,
}: {
  reps: RepRow[];
  invites: InviteRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Invite form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('partner');

  async function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await action();
      if (res.ok) {
        if (res.warning) setWarning(res.warning);
        onOk?.();
        router.refresh();
      } else {
        setError(res.error ?? 'Something went wrong.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const sortedReps = [...reps].sort((a, b) => {
    const r = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    return r !== 0 ? r : a.name.localeCompare(b.name);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {(error || warning) && (
        <div
          className="surface-tool"
          style={{
            borderColor: error ? 'var(--bad)' : 'var(--warn)',
            fontSize: '0.82rem',
            color: error ? 'var(--bad)' : 'var(--warn)',
          }}
        >
          {error ?? warning}
        </div>
      )}

      {/* ─── Invite a rep ───────────────────────────────────────────── */}
      <section className="surface-card">
        <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>
          Invite a rep
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
          They&apos;ll get an email with a sign-in link. After they sign in, their
          account stays locked until you activate it — your window to square
          away the I-9 and onboarding paperwork.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.7rem',
            alignItems: 'end',
          }}
        >
          <label style={{ display: 'block' }}>
            <span className="label">Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Reyes"
            />
          </label>
          <label style={{ display: 'block' }}>
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@example.com"
            />
          </label>
          <label style={{ display: 'block' }}>
            <span className="label">Role</span>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="partner">Sales rep</option>
              <option value="super_admin">Administrator</option>
            </select>
          </label>
          <button
            className="btn-primary"
            disabled={busy || !email.trim()}
            onClick={() =>
              run(
                () => inviteRep({ name, email, role }),
                () => {
                  setName('');
                  setEmail('');
                  setRole('partner');
                },
              )
            }
          >
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </section>

      {/* ─── Pending invites ────────────────────────────────────────── */}
      {invites.length > 0 && (
        <section>
          <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
            Pending invites
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="surface-tool"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.7rem 0.9rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600 }}>
                    {inv.name || inv.email}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {inv.name ? `${inv.email} · ` : ''}
                    {inv.role === 'super_admin' ? 'Administrator' : 'Sales rep'} · invited{' '}
                    {inv.invitedLabel}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => run(() => resendInvite({ inviteId: inv.id }))}
                  >
                    Resend
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    style={{ color: 'var(--bad)' }}
                    onClick={() => run(() => cancelInvite({ inviteId: inv.id }))}
                  >
                    Cancel
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── The team ───────────────────────────────────────────────── */}
      <section>
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          The team
        </div>
        {sortedReps.length === 0 ? (
          <div className="surface-card">
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              No one has signed in yet. Invited reps appear here once they do.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sortedReps.map((rep) => (
              <RepCard
                key={rep.userId}
                rep={rep}
                isSelf={rep.userId === currentUserId}
                busy={busy}
                run={run}
              />
            ))}
          </div>
        )}
      </section>

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', maxWidth: '64ch' }}>
        Reps are never deleted — disabling ends access but keeps every prospect,
        contact, and quote attributable. Suspending is the reversible version.
      </p>
    </div>
  );
}

// ─── One rep ──────────────────────────────────────────────────────────

function RepCard({
  rep,
  isSelf,
  busy,
  run,
}: {
  rep: RepRow;
  isSelf: boolean;
  busy: boolean;
  run: (action: () => Promise<ActionResult>) => Promise<void>;
}) {
  const meta = STATUS_META[rep.status];

  // Status transitions offered for this rep's current state.
  const actions: { label: string; status: RepStatus; danger?: boolean; confirm?: string }[] =
    rep.status === 'invited'
      ? [{ label: 'Activate', status: 'active' }]
      : rep.status === 'active'
        ? [
            { label: 'Suspend', status: 'suspended' },
            {
              label: 'Disable',
              status: 'disabled',
              danger: true,
              confirm: `Disable ${rep.name}? Access ends; their records are kept.`,
            },
          ]
        : rep.status === 'suspended'
          ? [
              { label: 'Reactivate', status: 'active' },
              {
                label: 'Disable',
                status: 'disabled',
                danger: true,
                confirm: `Disable ${rep.name}? Access ends; their records are kept.`,
              },
            ]
          : [{ label: 'Reinstate', status: 'active' }];

  return (
    <div
      className="surface-tool"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        padding: '0.75rem 0.9rem',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          {rep.name}
          {isSelf && (
            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · you</span>
          )}
        </span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          {rep.email} · {rep.role === 'super_admin' ? 'Administrator' : 'Sales rep'}
          {' · '}last seen {rep.lastSeenLabel}
        </span>
      </span>

      <span
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: meta.color,
          border: `1px solid ${meta.color}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0.2rem 0.5rem',
          whiteSpace: 'nowrap',
        }}
      >
        {meta.label}
      </span>

      {isSelf ? (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
          Your own access can&apos;t be changed here.
        </span>
      ) : (
        <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <button
              key={a.status}
              className="btn-ghost"
              disabled={busy}
              style={a.danger ? { color: 'var(--bad)' } : undefined}
              onClick={() => {
                if (a.confirm && !window.confirm(a.confirm)) return;
                run(() => setRepStatus({ userId: rep.userId, status: a.status }));
              }}
            >
              {a.label}
            </button>
          ))}
          <button
            className="btn-ghost"
            disabled={busy}
            style={{ color: 'var(--text-faint)' }}
            onClick={() =>
              run(() =>
                setRepRole({
                  userId: rep.userId,
                  role: rep.role === 'super_admin' ? 'partner' : 'super_admin',
                }),
              )
            }
          >
            {rep.role === 'super_admin' ? 'Make rep' : 'Make admin'}
          </button>
        </span>
      )}
    </div>
  );
}
