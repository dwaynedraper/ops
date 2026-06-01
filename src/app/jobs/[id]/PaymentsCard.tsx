'use client';

/**
 * Payments card (Phase 5A) — the dated money schedule on a job, replacing
 * the old three-state flag toggle. Received rows render solid `--good`;
 * expected rows render ghosted (outline, no fill); an expected row past its
 * due date reads `--warn`. A paid ring shows collected ÷ value at a glance.
 *
 * The "feel" rule (MONEY-AND-LEDGER-PLAN §3): the picture lands before the
 * numbers. Filled = here, ghosted = coming, warn = late. Red is reserved
 * for overdue — never for an ordinary outflow.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtMoney } from '@/lib/pricing';
import {
  receivedTotal,
  expectedTotal,
  paidFraction,
  lastReceivedOn,
  nextExpectedOn,
  PAYMENT_KIND_LABEL,
  type PaymentRow,
  type PaymentKind,
} from '@/lib/money';
import { addJobPayment, markPaymentReceived, deleteJobPayment } from './actions';

const KIND_OPTS: PaymentKind[] = ['deposit', 'balance', 'payment', 'refund'];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const due = Date.parse(`${iso}T00:00:00Z`);
  const today = Date.now();
  return due < today - 86_400_000; // strictly before today (UTC day)
}

export function PaymentsCard({
  jobId,
  rows,
  jobValue,
}: {
  jobId: string;
  rows: PaymentRow[];
  jobValue: number | null;
}) {
  const collected = receivedTotal(rows);
  const outstanding = expectedTotal(rows);
  const frac = paidFraction(rows, jobValue);
  const lastIn = lastReceivedOn(rows);
  const nextDue = nextExpectedOn(rows);

  return (
    <div className="surface-tool">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.9rem',
        }}
      >
        <div className="eyebrow">Payments</div>
        <PaidRing fraction={frac} />
      </div>

      {/* Collected / outstanding summary — felt before read. */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
        <SummaryStat label="Collected" value={fmtMoney(collected)} tone="solid" />
        {outstanding > 0 && <SummaryStat label="Outstanding" value={fmtMoney(outstanding)} tone="ghost" />}
      </div>

      {/* Heartbeat line — the exact sentence Dean asked for. */}
      {(lastIn || nextDue) && (
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
          {lastIn && <>Last in: <strong style={{ color: 'var(--good)' }}>{fmtDate(lastIn)}</strong></>}
          {lastIn && nextDue ? '  ·  ' : ''}
          {nextDue && <>Next expected: <strong style={{ color: 'var(--text)' }}>{fmtDate(nextDue)}</strong></>}
        </p>
      )}

      {/* The rows */}
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
          {rows.map((r) => (
            <PaymentRowView key={r.id} jobId={jobId} row={r} />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          No payments recorded yet. Schedule an expected deposit/balance, or log one that landed.
        </p>
      )}

      <AddPaymentForm jobId={jobId} />
    </div>
  );
}

// ─── Paid ring (SVG) ──────────────────────────────────────────────────

function PaidRing({ fraction }: { fraction: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const filled = c * fraction;
  const full = fraction >= 0.999;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      title={`${Math.round(fraction * 100)}% collected`}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={full ? 'var(--good)' : 'var(--good)'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform="rotate(-90 16 16)"
          opacity={fraction > 0 ? 1 : 0.25}
        />
      </svg>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', fontWeight: 600 }}>
        {Math.round(fraction * 100)}%
      </span>
    </span>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: 'solid' | 'ghost' }) {
  const solid = tone === 'solid';
  return (
    <div>
      <div
        className="money"
        style={{
          fontSize: '1.25rem',
          lineHeight: 1,
          color: solid ? 'var(--good)' : 'transparent',
          // Ghosted = outlined text: green stroke, no fill, so it reads as
          // "the same money, not yet arrived."
          WebkitTextStroke: solid ? undefined : '1px var(--good)',
          opacity: solid ? 1 : 0.75,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 700, marginTop: '0.2rem' }}>
        {label}
      </div>
    </div>
  );
}

// ─── A single payment row ─────────────────────────────────────────────

function PaymentRowView({ jobId, row }: { jobId: string; row: PaymentRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const received = row.status === 'received';
  const overdue = !received && isOverdue(row.dueOn);

  const borderColor = received ? 'var(--good)' : overdue ? 'var(--warn)' : 'var(--border)';
  const fill = received ? 'rgba(74,222,128,0.10)' : 'transparent';

  async function act(fn: () => Promise<{ ok: boolean }>) {
    if (busy) return;
    setBusy(true);
    await fn();
    router.refresh();
    setBusy(false);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.55rem 0.7rem',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${borderColor}`,
        background: fill,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          background: received ? 'var(--good)' : 'transparent',
          border: received ? 'none' : `2px solid ${overdue ? 'var(--warn)' : 'var(--text-faint)'}`,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>
          {row.kind === 'refund' ? '− ' : ''}
          {fmtMoney(row.amount)}
          <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · {PAYMENT_KIND_LABEL[row.kind]}</span>
        </span>
        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {received
            ? `Received ${fmtDate(row.receivedOn)}${row.method ? ` · ${row.method}` : ''}`
            : `${overdue ? 'Overdue — was due' : 'Expected'} ${fmtDate(row.dueOn)}`}
          {row.note ? ` · ${row.note}` : ''}
        </span>
      </span>
      {!received && (
        <button
          className="btn-outline"
          disabled={busy}
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }}
          onClick={() => act(() => markPaymentReceived({ jobId, paymentId: row.id, receivedOn: '' }))}
        >
          Mark received
        </button>
      )}
      <button
        className="btn-ghost"
        disabled={busy}
        title="Delete this payment"
        style={{ padding: '0.15rem 0.35rem', flexShrink: 0 }}
        onClick={() => act(() => deleteJobPayment({ jobId, paymentId: row.id }))}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Add payment ──────────────────────────────────────────────────────

function AddPaymentForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'expected' | 'received'>('received');
  const [kind, setKind] = useState<PaymentKind>('payment');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode('received');
    setKind('payment');
    setAmount('');
    setDate('');
    setMethod('');
    setNote('');
    setError(null);
  }

  async function onAdd() {
    setBusy(true);
    setError(null);
    const res = await addJobPayment({
      jobId,
      kind,
      amount,
      status: mode,
      dueOn: mode === 'expected' ? date : '',
      receivedOn: mode === 'received' ? date : '',
      method,
      note,
    });
    if (res.ok) {
      reset();
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? 'Could not add the payment.');
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add payment
      </button>
    );
  }

  return (
    <div
      style={{
        padding: '0.85rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--border-accent)',
        background: 'var(--surface-tool-2)',
      }}
    >
      {/* Received vs expected */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          type="button"
          className={mode === 'received' ? 'btn-primary' : 'btn-outline'}
          onClick={() => setMode('received')}
        >
          Received
        </button>
        <button
          type="button"
          className={mode === 'expected' ? 'btn-primary' : 'btn-outline'}
          onClick={() => setMode('expected')}
        >
          Expected
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
        <label style={{ display: 'block' }}>
          <span className="label">Amount ($)</span>
          <input
            className="input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="450"
            autoFocus
          />
        </label>
        <label style={{ display: 'block' }}>
          <span className="label">Kind</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
            {KIND_OPTS.map((k) => (
              <option key={k} value={k}>{PAYMENT_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block' }}>
          <span className="label">{mode === 'received' ? 'Received on' : 'Due on'}</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {mode === 'received' && (
          <label style={{ display: 'block' }}>
            <span className="label">Method</span>
            <input
              className="input"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="Check, Zelle…"
            />
          </label>
        )}
      </div>
      <label style={{ display: 'block', marginTop: '0.6rem' }}>
        <span className="label">Note</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', alignItems: 'center' }}>
        <button className="btn-primary" disabled={busy || !amount.trim()} onClick={onAdd}>
          {busy ? 'Adding…' : mode === 'received' ? 'Record payment' : 'Schedule payment'}
        </button>
        <button className="btn-ghost" onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </button>
        {mode === 'received' && !date && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>Date defaults to today.</span>
        )}
        {error && <span style={{ fontSize: '0.76rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
    </div>
  );
}
