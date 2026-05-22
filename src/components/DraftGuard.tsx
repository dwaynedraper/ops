'use client';

/**
 * DraftGuard — the draft-until-Publish safety net (decision D-012).
 *
 * Super-admin editor pages (Rates, the package worksheet, Corporate) hold
 * their edits in local state. Nothing reaches the database — and so
 * nothing reaches the calculator or sales partners — until Publish. This
 * component stops a dirty draft from being lost on the way out:
 *
 *   - a `beforeunload` guard for tab close / refresh, and
 *   - a capture-phase click interceptor for in-app link navigation, which
 *     raises the Stay / Reset / Publish modal.
 *
 * The page owns the draft; it passes `dirty`, plus `onReset` (revert to
 * the DB state) and `onPublish` (commit — returns true on success).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function DraftGuard({
  dirty,
  onReset,
  onPublish,
  what = 'unpublished changes',
}: {
  dirty: boolean;
  onReset: () => void;
  onPublish: () => Promise<boolean>;
  /** Names the pending edits in the modal copy, e.g. "rate changes". */
  what?: string;
}) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // ── Tab close / refresh ──────────────────────────────────────────────
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── In-app navigation (anchor clicks) ────────────────────────────────
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        anchor.target === '_blank' ||
        /^[a-z]+:\/\//i.test(href) // external (http://, https://, …)
      ) {
        return;
      }
      e.preventDefault();
      setPendingHref(href);
    };
    document.addEventListener('click', onClick, true); // capture phase
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  if (!pendingHref) return null;

  const go = (href: string) => {
    setPendingHref(null);
    router.push(href);
  };

  function stay() {
    setPendingHref(null);
  }

  function reset() {
    const href = pendingHref;
    onReset();
    if (href) go(href);
  }

  async function publish() {
    const href = pendingHref;
    setWorking(true);
    const ok = await onPublish();
    setWorking(false);
    if (ok && href) {
      go(href);
    } else {
      // Publish failed — drop the modal so the error on the page is visible.
      setPendingHref(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          padding: '1.5rem',
          maxWidth: 420,
          width: '100%',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
          Unpublished
        </div>
        <h2
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontSize: '1.3rem',
            fontWeight: 400,
            margin: '0 0 0.5rem',
          }}
        >
          You have {what}.
        </h2>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-mid)', lineHeight: 1.55, marginBottom: '1.25rem' }}>
          Nothing has reached the calculator or your partners yet. Publish to
          commit, or reset to discard and revert to the saved state.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            className="btn-primary"
            style={{ justifyContent: 'center' }}
            disabled={working}
            onClick={publish}
          >
            {working ? 'Publishing…' : 'Publish, then leave'}
          </button>
          <button
            className="btn-outline"
            style={{ justifyContent: 'center' }}
            disabled={working}
            onClick={reset}
          >
            Discard changes and leave
          </button>
          <button
            className="btn-ghost"
            style={{ justifyContent: 'center' }}
            disabled={working}
            onClick={stay}
          >
            Stay on this page
          </button>
        </div>
      </div>
    </div>
  );
}
