'use client';

/**
 * The tracking board — interactive.
 *
 * Left: every prospect in the contact cycle, most urgent first. Right:
 * the selected prospect's cycle — progress, history, and the script
 * composer. The composer fills {{placeholders}}, previews the message
 * live, and copies it; "Mark as sent" logs the touch and lets the app
 * advance the stage.
 *
 * Cycle math is imported from src/lib/tracking.ts so this view and the
 * server read the cycle identically.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  extractPlaceholders,
  fillTemplate,
  type ContactScript,
  type TrackingCard,
  type TrackingStatus,
} from '@/lib/tracking';
import { logContact, markResponded, closeOut } from './actions';

const STATUS_META: Record<TrackingStatus, { label: string; color: string }> = {
  ready: { label: 'Ready', color: 'var(--accent)' },
  due: { label: 'Follow-up due', color: 'var(--warn)' },
  waiting: { label: 'Waiting', color: 'var(--steel)' },
  replied: { label: 'Replied', color: 'var(--good)' },
  cycle_done: { label: 'No reply', color: 'var(--text-faint)' },
};

// Placeholders that carry a sensible default; the rest start blank.
function seedValues(card: TrackingCard, repName: string): Record<string, string> {
  const firstName = card.prospect.agentName.trim().split(/\s+/)[0] ?? '';
  return {
    first_name: firstName,
    agency: card.prospect.agency ?? '',
    rep_name: repName,
  };
}

export function TrackingClient({
  cards,
  scripts,
  repName,
}: {
  cards: TrackingCard[];
  scripts: ContactScript[];
  repName: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    cards[0]?.prospect.id ?? null,
  );
  // Bumped after any action so the detail panel remounts with fresh state.
  const [nonce, setNonce] = useState(0);

  const selected = cards.find((c) => c.prospect.id === selectedId) ?? cards[0] ?? null;

  if (cards.length === 0) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No prospects in the cycle yet — qualify some in Research, then work them here.
        </p>
      </div>
    );
  }

  return (
    <div className="track-layout">
      {/* ─── Board ──────────────────────────────────────────────────────── */}
      <div className="track-list">
        {cards.map((card) => {
          const meta = STATUS_META[card.status];
          const active = card.prospect.id === selected?.prospect.id;
          return (
            <button
              key={card.prospect.id}
              onClick={() => setSelectedId(card.prospect.id)}
              style={{
                textAlign: 'left',
                padding: '0.7rem 0.8rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-dim)' : 'var(--surface-tool-2)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: '0.86rem',
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {card.prospect.agentName}
                </span>
                <span
                  className="money"
                  style={{ fontSize: '0.8rem', color: 'var(--text-faint)', flexShrink: 0 }}
                >
                  {card.prospect.rankScore.toFixed(1)}
                </span>
              </div>
              <span
                style={{
                  fontSize: '0.66rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: meta.color,
                }}
              >
                {meta.label}
                {card.status === 'waiting' && card.dueInDays !== null
                  ? ` · ${card.dueInDays}d`
                  : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── Detail ─────────────────────────────────────────────────────── */}
      <div>
        {selected && (
          <DetailPanel
            key={`${selected.prospect.id}:${nonce}`}
            card={selected}
            scripts={scripts}
            repName={repName}
            onActed={() => setNonce((n) => n + 1)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Detail panel — one prospect's cycle ──────────────────────────────────

function DetailPanel({
  card,
  scripts,
  repName,
  onActed,
}: {
  card: TrackingCard;
  scripts: ContactScript[];
  repName: string;
  onActed: () => void;
}) {
  const router = useRouter();
  const { prospect, contacts, status } = card;

  const nextStep = useMemo(
    () => scripts.find((s) => s.stageKey === card.nextStepKey) ?? null,
    [scripts, card.nextStepKey],
  );

  const placeholders = useMemo(
    () => (nextStep ? extractPlaceholders(nextStep.subject, nextStep.body) : []),
    [nextStep],
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    seedValues(card, repName),
  );
  const [showComposer, setShowComposer] = useState(status === 'ready' || status === 'due');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const filledSubject = nextStep?.subject ? fillTemplate(nextStep.subject, values) : '';
  const filledBody = nextStep ? fillTemplate(nextStep.body, values) : '';
  const allFilled = placeholders.every((k) => (values[k] ?? '').trim() !== '');

  // The most recent touch still awaiting a reply — the reply action target.
  const latestOpen =
    contacts.length > 0 && !contacts[contacts.length - 1].responseReceived
      ? contacts[contacts.length - 1]
      : null;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (res.ok) {
        router.refresh();
        onActed();
      } else {
        setError(res.error ?? 'Something went wrong.');
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  function copy(field: string, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(field);
        setTimeout(() => setCopied((c) => (c === field ? null : c)), 1500);
      },
      () => setError('Could not copy to the clipboard.'),
    );
  }

  const doneKeys = new Set(contacts.map((c) => c.stepKey));
  const orderedScripts = [...scripts].sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div className="surface-tool">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                fontFamily: 'var(--font-playfair), serif',
                fontSize: '1.3rem',
                fontWeight: 400,
                margin: 0,
              }}
            >
              {prospect.agentName}
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {[prospect.agency, prospect.marketArea].filter(Boolean).join(' · ') ||
                'No agency on file'}
            </p>
            {(prospect.email || prospect.phone) && (
              <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: '0.2rem' }}>
                {[prospect.email, prospect.phone].filter(Boolean).join('  ·  ')}
              </p>
            )}
          </div>
          <span
            style={{
              fontSize: '0.64rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: STATUS_META[status].color,
              border: `1px solid ${STATUS_META[status].color}`,
              borderRadius: 'var(--radius-sm)',
              padding: '0.22rem 0.55rem',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {STATUS_META[status].label}
          </span>
        </div>

        {/* Cycle progress */}
        <div
          style={{
            display: 'flex',
            gap: '0.4rem',
            flexWrap: 'wrap',
            marginTop: '0.9rem',
          }}
        >
          {orderedScripts.map((s) => {
            const done = doneKeys.has(s.stageKey);
            const current = s.stageKey === card.nextStepKey;
            return (
              <span
                key={s.id}
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  padding: '0.25rem 0.55rem',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${
                    current ? 'var(--accent)' : done ? 'var(--good)' : 'var(--border)'
                  }`,
                  background: current ? 'var(--accent-dim)' : 'transparent',
                  color: done
                    ? 'var(--good)'
                    : current
                      ? 'var(--text)'
                      : 'var(--text-faint)',
                }}
              >
                {done ? '✓ ' : ''}
                {s.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* History */}
      {contacts.length > 0 && (
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
            Contact history
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {contacts.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  fontSize: '0.8rem',
                  padding: '0.4rem 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--text)' }}>{c.stepLabel}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  {c.responseReceived && (
                    <span style={{ color: 'var(--good)', fontSize: '0.7rem', fontWeight: 700 }}>
                      REPLIED
                    </span>
                  )}
                  <span style={{ color: 'var(--text-faint)' }}>{c.sentAtLabel}</span>
                </span>
              </div>
            ))}
          </div>
          {latestOpen && (
            <button
              className="btn-outline"
              style={{ marginTop: '0.85rem' }}
              disabled={busy}
              onClick={() =>
                run(() => markResponded({ prospectId: prospect.id, contactId: latestOpen.id }))
              }
            >
              They replied
            </button>
          )}
        </div>
      )}

      {/* Status-specific surface */}
      {status === 'replied' ? (
        <div className="surface-tool">
          <p style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
            {prospect.agentName} replied. Take it from here on their client page —
            quote the work and move toward signing.
          </p>
          <Link
            href={`/prospects/${prospect.id}`}
            className="btn-primary"
            style={{ marginTop: '0.85rem' }}
          >
            Open client page
          </Link>
        </div>
      ) : status === 'cycle_done' ? (
        <div className="surface-tool">
          <p style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
            The full cycle ran with no reply. Close it out — {prospect.agentName} moves
            to dormant and leaves the board. You can always research them fresh later.
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: '0.85rem', justifyContent: 'center' }}
            disabled={busy}
            onClick={() => run(() => closeOut({ prospectId: prospect.id }))}
          >
            {busy ? 'Closing…' : 'Close out — no response'}
          </button>
          {error && (
            <p style={{ fontSize: '0.78rem', color: 'var(--bad)', marginTop: '0.5rem' }}>{error}</p>
          )}
        </div>
      ) : !nextStep ? null : !showComposer ? (
        <div className="surface-tool">
          <p style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
            Next touch — <strong>{nextStep.label}</strong> — is due in{' '}
            <strong>{card.dueInDays}</strong> {card.dueInDays === 1 ? 'day' : 'days'}.
            Give it the full window unless there&apos;s a reason not to.
          </p>
          <button
            className="btn-outline"
            style={{ marginTop: '0.85rem' }}
            onClick={() => setShowComposer(true)}
          >
            Send the next touch early
          </button>
        </div>
      ) : (
        <div className="surface-tool" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
              {nextStep.label} · {nextStep.channel}
            </div>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Fill every field, copy the message, send it from your own inbox, then
              log it so the follow-up clock starts.
            </p>
          </div>

          {/* Placeholder inputs */}
          {placeholders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {placeholders.map((key) => (
                <label key={key} style={{ display: 'block' }}>
                  <span className="label">{key.replace(/_/g, ' ')}</span>
                  {key === 'intro' ? (
                    <textarea
                      className="textarea"
                      rows={2}
                      value={values[key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      placeholder="One personal line — something specific you noticed."
                    />
                  ) : (
                    <input
                      className="input"
                      value={values[key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Live preview */}
          <div
            style={{
              background: 'var(--surface-tool-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            {nextStep.subject && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                  }}
                >
                  <span className="label" style={{ marginBottom: 0 }}>
                    Subject
                  </span>
                  <button
                    className="btn-ghost"
                    style={{ padding: '0.15rem 0.3rem' }}
                    onClick={() => copy('subject', filledSubject)}
                  >
                    {copied === 'subject' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>{filledSubject}</div>
              </div>
            )}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                }}
              >
                <span className="label" style={{ marginBottom: 0 }}>
                  Message
                </span>
                <button
                  className="btn-ghost"
                  style={{ padding: '0.15rem 0.3rem' }}
                  onClick={() => copy('body', filledBody)}
                >
                  {copied === 'body' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.55,
                }}
              >
                {filledBody}
              </div>
            </div>
          </div>

          {!allFilled && (
            <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
              Fill every field above before logging the touch.
            </p>
          )}
          {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</p>}

          <button
            className="btn-primary"
            style={{ justifyContent: 'center' }}
            disabled={busy || !allFilled}
            onClick={() =>
              run(() =>
                logContact({
                  prospectId: prospect.id,
                  stepKey: nextStep.stageKey,
                  filledSubject,
                  filledBody,
                }),
              )
            }
          >
            {busy ? 'Logging…' : 'Mark as sent'}
          </button>
        </div>
      )}

      <p
        style={{
          fontSize: '0.72rem',
          color: 'var(--text-faint)',
          textAlign: 'center',
        }}
      >
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}
