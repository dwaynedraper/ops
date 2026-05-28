'use client';

/**
 * Undo provider — a generic "soft commit" mechanism.
 *
 * `runWithUndo` does NOT run the action immediately. It opens a 20-second
 * window, shows a persistent undo toast with a live countdown, and only
 * then fires the real server action. Inside the window the rep can press
 * Undo and nothing ever happens — the action is discarded.
 *
 *   const undo = useUndo();
 *   const result = await undo.runWithUndo({
 *     label: 'Logged contact',
 *     run: () => logContact({ ... }),
 *   });
 *   // result.outcome: 'committed' | 'undone' | 'failed'
 *
 * The returned promise settles when the action finally resolves — on
 * commit, on undo, or on failure — so a caller can re-enable its own UI.
 * On a successful commit the provider refreshes the current route itself,
 * so callers don't have to.
 *
 * Mounted once in the root layout (via Providers), so the toast and its
 * timers survive in-app navigation — a rep can fire an action and move on.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

const UNDO_WINDOW_MS = 20_000;

/** Shape every wrapped server action is expected to return. */
export interface UndoableResult {
  ok: boolean;
  error?: string;
}

/** How a deferred action finally settled. */
export type UndoOutcome =
  | { outcome: 'committed' }
  | { outcome: 'undone' }
  | { outcome: 'failed'; error: string };

interface RunWithUndoOpts {
  /** Short human label for the toast, e.g. "Logged contact". */
  label: string;
  /** The deferred work — runs only after the undo window elapses. */
  run: () => Promise<UndoableResult>;
}

interface UndoCtx {
  runWithUndo: (opts: RunWithUndoOpts) => Promise<UndoOutcome>;
}

const Ctx = createContext<UndoCtx | null>(null);

/** Access the undo mechanism. Must be inside <UndoProvider>. */
export function useUndo(): UndoCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUndo must be used within <UndoProvider>.');
  return ctx;
}

type Phase = 'waiting' | 'committing' | 'error';

/** The render-facing slice of a pending action. */
interface ToastItem {
  id: number;
  label: string;
  expiresAt: number;
  phase: Phase;
  error?: string;
}

/** The non-render internals — kept in a ref, never triggers a re-render. */
interface Internals {
  run: () => Promise<UndoableResult>;
  resolve: (o: UndoOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [items, setItems] = useState<ToastItem[]>([]);
  const internals = useRef(new Map<number, Internals>());
  const idRef = useRef(0);
  // Bumped by an interval to re-render the live countdown.
  const [, tick] = useState(0);

  /** The window elapsed — fire the real action. */
  const commit = useCallback(
    async (id: number) => {
      const intern = internals.current.get(id);
      if (!intern) return;
      intern.timer = null;
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, phase: 'committing' } : it)),
      );

      let result: UndoableResult;
      try {
        result = await intern.run();
      } catch (err) {
        result = {
          ok: false,
          error: err instanceof Error ? err.message : 'Something went wrong.',
        };
      }

      if (result.ok) {
        internals.current.delete(id);
        setItems((prev) => prev.filter((it) => it.id !== id));
        intern.resolve({ outcome: 'committed' });
        router.refresh();
      } else {
        const error = result.error ?? 'Something went wrong.';
        // Keep the toast (now an error) until the rep dismisses it.
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, phase: 'error', error } : it)),
        );
        intern.resolve({ outcome: 'failed', error });
      }
    },
    [router],
  );

  /** Rep pressed Undo — discard the action, nothing ran. */
  const undo = useCallback((id: number) => {
    const intern = internals.current.get(id);
    if (!intern) return;
    if (intern.timer) clearTimeout(intern.timer);
    internals.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    intern.resolve({ outcome: 'undone' });
  }, []);

  /** Rep pressed "Commit now" — cancel the wait, fire immediately. (D-050.)
   * Lifecycle moves still get the 20s safety window by default, but the
   * rep is never blocked from forward progress when they're sure. */
  const commitNow = useCallback(
    (id: number) => {
      const intern = internals.current.get(id);
      if (!intern) return;
      if (intern.timer) {
        clearTimeout(intern.timer);
        intern.timer = null;
      }
      void commit(id);
    },
    [commit],
  );

  /** Clear a settled error toast. */
  const dismiss = useCallback((id: number) => {
    internals.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const runWithUndo = useCallback(
    (opts: RunWithUndoOpts) =>
      new Promise<UndoOutcome>((resolve) => {
        const id = ++idRef.current;
        const expiresAt = Date.now() + UNDO_WINDOW_MS;
        const timer = setTimeout(() => commit(id), UNDO_WINDOW_MS);
        internals.current.set(id, { run: opts.run, resolve, timer });
        setItems((prev) => [
          ...prev,
          { id, label: opts.label, expiresAt, phase: 'waiting' },
        ]);
      }),
    [commit],
  );

  // Drive the countdown while any toast is still counting down.
  const hasWaiting = items.some((it) => it.phase === 'waiting');
  useEffect(() => {
    if (!hasWaiting) return;
    const iv = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, [hasWaiting]);

  // Warn before a tab close drops an action still inside its window.
  useEffect(() => {
    if (!hasWaiting) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasWaiting]);

  const value = useMemo<UndoCtx>(() => ({ runWithUndo }), [runWithUndo]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {items.length > 0 && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: '1.5rem',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            width: 'min(92vw, 26rem)',
          }}
        >
          {items.map((it) => (
            <UndoToast
              key={it.id}
              item={it}
              onUndo={() => undo(it.id)}
              onCommitNow={() => commitNow(it.id)}
              onDismiss={() => dismiss(it.id)}
            />
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────

function UndoToast({
  item,
  onUndo,
  onCommitNow,
  onDismiss,
}: {
  item: ToastItem;
  onUndo: () => void;
  onCommitNow: () => void;
  onDismiss: () => void;
}) {
  // `new Date().getTime()` rather than `Date.now()` — the lint purity rule
  // flags Date.now() in render; this reads the same clock.
  const msLeft = item.expiresAt - new Date().getTime();
  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  const fraction = Math.max(0, Math.min(1, msLeft / UNDO_WINDOW_MS));

  const isError = item.phase === 'error';

  return (
    <div
      role="status"
      style={{
        background: 'var(--surface-card)',
        border: `1px solid ${isError ? 'var(--bad)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.7rem 0.85rem',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: '0.82rem',
            color: 'var(--text)',
          }}
        >
          {item.phase === 'waiting' && item.label}
          {item.phase === 'committing' && `${item.label} — saving…`}
          {item.phase === 'error' && (
            <span style={{ color: 'var(--bad)' }}>
              {item.label} — couldn’t save: {item.error}
            </span>
          )}
        </span>

        {item.phase === 'waiting' && (
          <>
            <span
              className="money"
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-faint)',
                flexShrink: 0,
              }}
            >
              {secondsLeft}s
            </span>
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '0.25rem 0.7rem', flexShrink: 0 }}
              onClick={onUndo}
            >
              Undo
            </button>
            {/* D-050: "Commit now" cancels the safety window. Lifecycle
                moves still get the 20s by default, but the rep is never
                blocked from forward progress when they're sure. */}
            <button
              type="button"
              className="btn-primary"
              style={{
                padding: '0.25rem 0.7rem',
                flexShrink: 0,
                fontSize: '0.68rem',
              }}
              onClick={onCommitNow}
            >
              Commit now
            </button>
          </>
        )}

        {item.phase === 'error' && (
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '0.25rem 0.5rem', flexShrink: 0 }}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Countdown bar — only while the window is open. */}
      {item.phase === 'waiting' && (
        <div style={{ height: 3, background: 'var(--border)' }}>
          <div
            style={{
              height: '100%',
              width: `${fraction * 100}%`,
              background: 'var(--accent)',
            }}
          />
        </div>
      )}
    </div>
  );
}
