'use client';

/**
 * The contact board (was the "tracking board" pre-F3 / D-046) —
 * interactive, multi-workflow.
 *
 * Left: every prospect in a contact cycle, across workflows, most urgent
 * first, with a workflow filter. Right: the selected prospect's cycle,
 * worked against its own workflow's scripts.
 *
 * Lib types still read `TrackingCard` / `TrackingStatus` per the V2-PLAN
 * F3 scope (route folder + URL references only). A lib-side rename can
 * follow if needed; this file keeps the imports and renames the local
 * type + exported component to `Contact*`.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useUndo } from '@/components/UndoProvider';
import {
  extractPlaceholders,
  fillTemplate,
  splitPlaceholders,
  type ContactScript,
  type HandoffLink,
  type TrackingCard,
  type TrackingStatus,
} from '@/lib/tracking';
import { logContact, markResponded, closeOut } from './actions';

export interface ContactWorkflow {
  key: string;
  name: string;
  accent: string;
}

const STATUS_META: Record<TrackingStatus, { label: string; color: string }> = {
  ready: { label: 'Ready', color: 'var(--accent)' },
  due: { label: 'Follow-up due', color: 'var(--warn)' },
  waiting: { label: 'Waiting', color: 'var(--steel)' },
  replied: { label: 'Replied', color: 'var(--good)' },
  cycle_done: { label: 'No reply', color: 'var(--text-faint)' },
};

/** Placeholders that carry a default. The org token varies by workflow,
 *  so all three org-ish keys are seeded from the same org name. */
function seedValues(card: TrackingCard, repName: string): Record<string, string> {
  const firstName = card.prospect.contactName.trim().split(/\s+/)[0] ?? '';
  const org = card.prospect.orgName ?? '';
  return {
    first_name: firstName,
    rep_name: repName,
    agency: org,
    company: org,
    organization: org,
  };
}

export function ContactClient({
  cards,
  workflows,
  scriptsByWorkflow,
  linksByWorkflow,
  repName,
}: {
  cards: TrackingCard[];
  workflows: ContactWorkflow[];
  scriptsByWorkflow: Record<string, ContactScript[]>;
  linksByWorkflow: Record<string, HandoffLink[]>;
  repName: string;
}) {
  const wfByKey = new Map(workflows.map((w) => [w.key, w]));

  const [shown, setShown] = useState<Set<string>>(() => new Set(workflows.map((w) => w.key)));
  const [selectedId, setSelectedId] = useState<string | null>(cards[0]?.prospect.id ?? null);
  const [nonce, setNonce] = useState(0);

  const visible = cards.filter((c) => shown.has(c.prospect.workflowKey));
  // No silent fallback: if the selection no longer resolves — the prospect
  // was acted on and left the board, or its workflow was filtered out —
  // show an explicit prompt rather than quietly swapping in a different
  // prospect the rep might then act on by mistake.
  const selected = selectedId
    ? visible.find((c) => c.prospect.id === selectedId) ?? null
    : null;

  function toggleWorkflow(key: string) {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (cards.length === 0) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No prospects in the cycle yet — qualify some, then work them here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Workflow filter */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {workflows.map((w) => {
          const on = shown.has(w.key);
          return (
            <button
              key={w.key}
              onClick={() => toggleWorkflow(w.key)}
              style={{
                padding: '0.35rem 0.7rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${on ? w.accent : 'var(--border)'}`,
                background: on ? `${w.accent}22` : 'transparent',
                color: on ? 'var(--text)' : 'var(--text-faint)',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: on ? 'none' : 'line-through',
              }}
            >
              {w.name}
            </button>
          );
        })}
      </div>

      <div className="track-layout">
        {/* ─── Board ──────────────────────────────────────────────────── */}
        <div className="track-list">
          {visible.length === 0 ? (
            <div className="surface-card">
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                No prospects match the filter.
              </p>
            </div>
          ) : (
            visible.map((card) => {
              const meta = STATUS_META[card.status];
              const active = card.prospect.id === selected?.prospect.id;
              const wf = wfByKey.get(card.prospect.workflowKey);
              const accent = wf?.accent ?? 'var(--text-faint)';
              // D-051: urgency drives the LEFT-side status dot. Workflow
              // accent colors the card body (left-stripe + tinted background).
              const urgencyColor =
                card.urgency === 'now'
                  ? 'var(--good)'
                  : card.urgency === 'soon'
                    ? 'var(--warn)'
                    : card.urgency === 'overdue'
                      ? 'var(--bad)'
                      : 'var(--text-faint)';
              return (
                <button
                  key={card.prospect.id}
                  onClick={() => setSelectedId(card.prospect.id)}
                  style={{
                    textAlign: 'left',
                    padding: '0.65rem 0.8rem 0.65rem 0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${active ? accent : 'var(--border)'}`,
                    borderLeft: `4px solid ${accent}`,
                    background: active ? `${accent}1A` : `${accent}0D`,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.55rem',
                  }}
                >
                  {/* Urgency dot — leftmost. D-051. */}
                  <span
                    aria-hidden
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: urgencyColor,
                      flexShrink: 0,
                      marginTop: '0.35rem',
                      boxShadow:
                        card.urgency === 'now' || card.urgency === 'overdue'
                          ? `0 0 0 2px ${urgencyColor}33`
                          : 'none',
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.2rem',
                    }}
                  >
                    <span
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
                        {card.prospect.contactName}
                      </span>
                      <span
                        className="money"
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-faint)',
                          flexShrink: 0,
                        }}
                      >
                        {card.prospect.rankScore.toFixed(1)}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: '0.66rem',
                        letterSpacing: '0.08em',
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
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* ─── Detail ─────────────────────────────────────────────────── */}
        <div>
          {selected ? (
            <DetailPanel
              key={`${selected.prospect.id}:${nonce}`}
              card={selected}
              scripts={scriptsByWorkflow[selected.prospect.workflowKey] ?? []}
              links={linksByWorkflow[selected.prospect.workflowKey] ?? []}
              workflowName={wfByKey.get(selected.prospect.workflowKey)?.name ?? ''}
              repName={repName}
              onActed={() => setNonce((n) => n + 1)}
            />
          ) : (
            <div className="surface-card">
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Select a prospect from the board to work their contact cycle.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detail panel — one prospect's cycle ──────────────────────────────────

function DetailPanel({
  card,
  scripts,
  links,
  workflowName,
  repName,
  onActed,
}: {
  card: TrackingCard;
  scripts: ContactScript[];
  links: HandoffLink[];
  workflowName: string;
  repName: string;
  onActed: () => void;
}) {
  const undo = useUndo();
  const { prospect, contacts, status } = card;

  const nextStep = scripts.find((s) => s.stageKey === card.nextStepKey) ?? null;
  const placeholders = nextStep ? extractPlaceholders(nextStep.subject, nextStep.body) : [];

  // Two kinds of placeholder: human ones the rep fills, config ones (a
  // {{link_key}} matching a handoff link) that resolve to a live URL.
  const { human: humanPlaceholders, config: configLinks } = splitPlaceholders(
    placeholders,
    links,
  );

  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...seedValues(card, repName),
    // Config placeholders are pre-resolved and never edited by the rep.
    ...Object.fromEntries(links.map((l) => [l.linkKey, l.url])),
  }));
  const [showComposer, setShowComposer] = useState(status === 'ready' || status === 'due');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const filledSubject = nextStep?.subject ? fillTemplate(nextStep.subject, values) : '';
  const filledBody = nextStep ? fillTemplate(nextStep.body, values) : '';
  // Only the human fields gate the send — config links are always resolved.
  const allFilled = humanPlaceholders.every((k) => (values[k] ?? '').trim() !== '');

  const latestOpen =
    contacts.length > 0 && !contacts[contacts.length - 1].responseReceived
      ? contacts[contacts.length - 1]
      : null;

  // Lifecycle moves run behind the 20-second undo window: the action is
  // handed to the undo provider and only fires if the rep doesn't undo it.
  // The provider refreshes the route itself on a successful commit.
  async function run(
    label: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setBusy(true);
    setError(null);
    const result = await undo.runWithUndo({ label, run: action });
    if (result.outcome === 'committed') {
      onActed();
    } else if (result.outcome === 'failed') {
      setError(result.error);
    }
    setBusy(false);
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

  // D-049: cycle-step tabs are all navigable. `viewedStepKey` is the
  // tab the rep is looking at — defaults to the current next step
  // (null sentinel resolves to nextStep). When the rep clicks a past
  // step, we show the message as it was sent; when they click a
  // future step, we show the template + a "send X first" badge.
  const [viewedStepKey, setViewedStepKey] = useState<string | null>(null);
  const viewedStep =
    (viewedStepKey ? orderedScripts.find((s) => s.stageKey === viewedStepKey) : null) ??
    nextStep;
  const viewedIsCurrent = viewedStep != null && nextStep != null && viewedStep.stageKey === nextStep.stageKey;
  const viewedIsPast = viewedStep != null && doneKeys.has(viewedStep.stageKey);
  const viewedIsFuture = viewedStep != null && !viewedIsCurrent && !viewedIsPast;
  const viewedContact =
    viewedIsPast && viewedStep
      ? contacts.find((c) => c.stepKey === viewedStep.stageKey) ?? null
      : null;
  // The step that has to land before `viewedStep` becomes live —
  // surfaced in the future-step badge.
  const prevStepLabel = viewedIsFuture && viewedStep
    ? (() => {
        const idx = orderedScripts.findIndex((s) => s.stageKey === viewedStep.stageKey);
        return idx > 0 ? orderedScripts[idx - 1].label : null;
      })()
    : null;

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
            <div className="eyebrow" style={{ marginBottom: '0.2rem' }}>
              {workflowName}
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-playfair), serif',
                fontSize: '1.3rem',
                fontWeight: 400,
                margin: 0,
              }}
            >
              {prospect.contactName}
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {[prospect.orgName, prospect.marketArea].filter(Boolean).join(' · ') ||
                'No organization on file'}
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

        {/* Cycle progress — every step is a navigable tab (D-049). */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
          {orderedScripts.map((s) => {
            const done = doneKeys.has(s.stageKey);
            const current = s.stageKey === card.nextStepKey;
            const viewed = viewedStep != null && s.stageKey === viewedStep.stageKey;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setViewedStepKey(s.stageKey)}
                aria-pressed={viewed}
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  padding: '0.25rem 0.55rem',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${
                    viewed
                      ? 'var(--accent)'
                      : current
                        ? 'var(--accent)'
                        : done
                          ? 'var(--good)'
                          : 'var(--border)'
                  }`,
                  background: viewed
                    ? 'var(--accent-dim)'
                    : current
                      ? 'var(--accent-dim)'
                      : 'transparent',
                  color: done ? 'var(--good)' : viewed || current ? 'var(--text)' : 'var(--text-faint)',
                  cursor: 'pointer',
                }}
              >
                {done ? '✓ ' : ''}
                {s.label}
              </button>
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
                run('Marked as replied', () =>
                  markResponded({ prospectId: prospect.id, contactId: latestOpen.id }),
                )
              }
            >
              They replied
            </button>
          )}
        </div>
      )}

      {/* Viewed step is past or future (D-049). Past steps show the
          message as it actually went out; future steps show the
          template + a "send X first" badge. The Log-contact action is
          NOT shown — that lives only on the current step view below. */}
      {!viewedIsCurrent && viewedStep && (
        <div
          className="surface-tool"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <div className="eyebrow">
              {viewedStep.label} · {viewedStep.channel}
            </div>
            {viewedIsPast && viewedContact && (
              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--good)',
                  border: '1px solid var(--good)',
                  background: 'rgba(16, 185, 129, 0.08)',
                  padding: '0.18rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Already sent · {viewedContact.sentAtLabel}
              </span>
            )}
            {viewedIsFuture && (
              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--warn)',
                  border: '1px solid var(--warn)',
                  background: 'rgba(245, 158, 11, 0.08)',
                  padding: '0.18rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {prevStepLabel ? `Send ${prevStepLabel} first` : 'Cycle hasn’t reached this step yet'}
              </span>
            )}
          </div>

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
            {(() => {
              const subj = viewedIsPast
                ? viewedContact?.filledSubject ?? null
                : viewedStep.subject;
              if (!subj) return null;
              return (
                <div>
                  <span className="label" style={{ marginBottom: 0 }}>
                    Subject
                  </span>
                  <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>
                    {subj}
                  </div>
                </div>
              );
            })()}
            <div>
              <span className="label" style={{ marginBottom: 0 }}>
                Message
              </span>
              <div
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.55,
                }}
              >
                {viewedIsPast
                  ? viewedContact?.filledBody ?? (
                      <span style={{ color: 'var(--text-faint)' }}>
                        The send-time text wasn’t snapshotted for this touch.
                      </span>
                    )
                  : viewedStep.body}
              </div>
            </div>
          </div>

          {nextStep && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setViewedStepKey(null)}
              style={{ alignSelf: 'flex-start' }}
            >
              ← Back to {nextStep.label}
            </button>
          )}
        </div>
      )}

      {/* Status-specific surface — current view only. */}
      {viewedIsCurrent && (status === 'replied' ? (
        <div className="surface-tool">
          <p style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
            {prospect.contactName} replied. Take it from here on their client page —
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
            The full cycle ran with no reply. Close it out — {prospect.contactName} moves
            to dormant and leaves the board. You can always qualify them fresh later.
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: '0.85rem', justifyContent: 'center' }}
            disabled={busy}
            onClick={() => run('Closed out — no response', () => closeOut({ prospectId: prospect.id }))}
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

          {humanPlaceholders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {humanPlaceholders.map((key) => (
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

          {/* Config placeholders — resolved automatically, not editable. */}
          {configLinks.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                fontSize: '0.72rem',
                color: 'var(--text-faint)',
              }}
            >
              {configLinks.map((link) => (
                <span key={link.linkKey}>
                  <span style={{ color: 'var(--good)', fontWeight: 700 }}>✓</span>{' '}
                  {link.label} link filled in automatically.
                </span>
              ))}
            </div>
          )}

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
              run('Logged contact', () =>
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
      ))}

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}
