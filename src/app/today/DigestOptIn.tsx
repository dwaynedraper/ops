'use client';

/**
 * The morning-digest email opt-in — a small toggle at the foot of the
 * /today page. Off by default; a rep turns it on if they want the brief
 * pushed to their inbox each morning as well as living on this page.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setDigestOptIn } from './actions';

export function DigestOptIn({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !on;
    setBusy(true);
    setError(null);
    setOn(next); // optimistic
    try {
      const res = await setDigestOptIn(next);
      if (res.ok) {
        router.refresh();
      } else {
        setOn(!next);
        setError(res.error ?? 'Could not save your preference.');
      }
    } catch (err) {
      setOn(!next);
      setError(err instanceof Error ? err.message : 'Could not save your preference.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="surface-tool"
      style={{
        marginTop: '2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
          Email me this brief each morning
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
          Optional. The digest always lives here on Today; this also pushes it to
          your inbox first thing.
        </div>
        {error && (
          <div style={{ fontSize: '0.74rem', color: 'var(--bad)', marginTop: '0.3rem' }}>
            {error}
          </div>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={toggle}
        style={{
          flexShrink: 0,
          padding: '0.4rem 0.9rem',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
          background: on ? 'var(--accent-dim)' : 'transparent',
          color: on ? 'var(--text)' : 'var(--text-faint)',
          fontSize: '0.76rem',
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {on ? 'On' : 'Off'}
      </button>
    </div>
  );
}
