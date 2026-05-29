'use client';

/**
 * DuplicateWarning — the inline panel that surfaces when the server's
 * D-057 duplicate check fires on add-prospect-form save.
 *
 * Shared between Sourcing's `AddProspectForm` and the create mode of
 * Qualify's `QualifyForm` so both surfaces render the same warning
 * shape from the same `DuplicateProspect[]` payload. The panel is
 * non-blocking — the rep can either back out (Cancel) or re-submit
 * with the server-side ack flag (Continue anyway). Owner-scoped (a
 * rep only ever sees their own prospects, even in collision-checks).
 */

import type { DuplicateProspect } from '@/app/sourcing/actions';

export function DuplicateWarning({
  duplicates,
  contactName,
  onContinue,
  onCancel,
  busy,
}: {
  duplicates: DuplicateProspect[];
  contactName: string;
  onContinue: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Possible duplicate"
      style={{
        marginTop: '0.65rem',
        padding: '0.85rem 1rem',
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px dashed var(--warn)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
      }}
    >
      <p style={{ fontSize: '0.78rem', color: 'var(--warn)', margin: 0 }}>
        <strong>Possible duplicate.</strong> You already have{' '}
        {duplicates.length === 1 ? 'a prospect' : `${duplicates.length} prospects`}{' '}
        named &ldquo;{contactName}&rdquo;. Common names can collide — your
        call.
      </p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
        }}
      >
        {duplicates.map((d) => (
          <li
            key={d.id}
            style={{
              fontSize: '0.78rem',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600 }}>{d.contactName}</span>
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                color: 'var(--text-faint)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.1rem 0.45rem',
              }}
            >
              {d.workflowName}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-mid)' }}>
              stage · {d.stage}
            </span>
            <a
              href={`/qualify/${d.id}`}
              style={{
                fontSize: '0.7rem',
                color: 'var(--accent)',
                textDecoration: 'none',
              }}
            >
              open →
            </a>
          </li>
        ))}
      </ul>
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          className="btn-ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onContinue}
          disabled={busy}
          style={{ padding: '0.45rem 1rem', fontSize: '0.7rem' }}
        >
          {busy ? 'Adding…' : 'Continue anyway'}
        </button>
      </div>
    </div>
  );
}
