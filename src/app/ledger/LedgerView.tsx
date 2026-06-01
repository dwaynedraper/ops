'use client';

/**
 * Ledger — interactive (Phase 5C). Two fast quick-add forms (expense /
 * mileage) and this month's lists. Outflow reads calm — muted tone, a
 * down-arrow — never red (red is reserved for overdue money). Mobile-
 * friendly: mileage gets logged from the truck.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtMoney } from '@/lib/pricing';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  mileageAmount,
  type ExpenseCategory,
  type ExpenseItem,
  type MileageItem,
} from '@/lib/ledger';
import {
  addExpense,
  addMileage,
  deleteExpense,
  deleteMileage,
  setMileageRate,
} from './actions';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}
function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function LedgerView({
  expenses,
  mileage,
  mileageRate,
  isAdmin,
}: {
  expenses: ExpenseItem[];
  mileage: MileageItem[];
  mileageRate: number;
  isAdmin: boolean;
}) {
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const mileageTotal = mileage.reduce((s, m) => s + m.amount, 0);
  const milesTotal = mileage.reduce((s, m) => s + m.miles, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Out-this-month summary — calm, down-arrow, not red */}
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <OutStat label="Expenses" value={`↓ ${fmtMoney(expenseTotal)}`} />
        <OutStat
          label="Mileage"
          value={`↓ ${fmtMoney(mileageTotal)}`}
          sub={`${milesTotal.toLocaleString('en-US')} mi @ ${mileageRate}`}
        />
        <OutStat label="Total out" value={`↓ ${fmtMoney(expenseTotal + mileageTotal)}`} strong />
      </div>

      <div className="calc-layout" style={{ gap: '1.25rem' }}>
        <ExpenseForm />
        <MileageForm rate={mileageRate} isAdmin={isAdmin} />
      </div>

      {/* Expenses list */}
      <div>
        <div className="eyebrow" style={{ marginBottom: '0.7rem' }}>
          Expenses · this month
        </div>
        {expenses.length === 0 ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Nothing logged yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {expenses.map((e) => (
              <Row
                key={e.id}
                date={fmtDay(e.spentOn)}
                title={e.vendor ?? EXPENSE_CATEGORY_LABEL[e.category]}
                sub={`${EXPENSE_CATEGORY_LABEL[e.category]}${e.jobLabel ? ` · ${e.jobLabel}` : ''}${e.billable ? ' · billable' : ''}${e.note ? ` · ${e.note}` : ''}`}
                amount={e.amount}
                onDelete={() => deleteExpense({ id: e.id })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mileage list */}
      <div>
        <div className="eyebrow" style={{ marginBottom: '0.7rem' }}>
          Mileage · this month
        </div>
        {mileage.length === 0 ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Nothing logged yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {mileage.map((m) => (
              <Row
                key={m.id}
                date={fmtDay(m.droveOn)}
                title={m.purpose ?? 'Drive'}
                sub={`${m.miles} mi @ ${m.ratePerMile}${m.jobLabel ? ` · ${m.jobLabel}` : ''}${m.note ? ` · ${m.note}` : ''}`}
                amount={m.amount}
                onDelete={() => deleteMileage({ id: m.id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutStat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <div
        className="money"
        style={{ fontSize: strong ? '1.5rem' : '1.25rem', lineHeight: 1, color: strong ? 'var(--text)' : 'var(--text-mid)' }}
      >
        {value}
      </div>
      <div style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 700, marginTop: '0.25rem' }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: '0.15rem' }}>{sub}</div>}
    </div>
  );
}

function Row({
  date,
  title,
  sub,
  amount,
  onDelete,
}: {
  date: string;
  title: string;
  sub: string;
  amount: number;
  onDelete: () => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (busy) return;
    setBusy(true);
    await onDelete();
    router.refresh();
    setBusy(false);
  }
  return (
    <div
      className="surface-tool list-row-responsive"
      style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.6rem 0.8rem' }}
    >
      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', minWidth: '3rem', flexShrink: 0 }}>
        {date}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub}
        </span>
      </span>
      <span className="money list-row-trail" style={{ fontSize: '0.86rem', color: 'var(--text-mid)', flexShrink: 0 }}>
        ↓ {fmtMoney(amount)}
      </span>
      <button className="btn-ghost" disabled={busy} onClick={del} title="Delete" style={{ padding: '0.15rem 0.35rem', flexShrink: 0 }}>
        ✕
      </button>
    </div>
  );
}

// ─── Expense quick-add ────────────────────────────────────────────────

function ExpenseForm() {
  const router = useRouter();
  const [spentOn, setSpentOn] = useState(todayIso());
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('general');
  const [billable, setBillable] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onAdd() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await addExpense({ spentOn, vendor, amount, category, billable, note });
    if (res.ok) {
      setVendor('');
      setAmount('');
      setNote('');
      setBillable(false);
      setSaved(true);
      router.refresh();
    } else {
      setError(res.error ?? 'Could not log the expense.');
    }
    setBusy(false);
  }

  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>Log an expense</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
        <Field label="Date">
          <input className="input" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
        </Field>
        <Field label="Amount ($)">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="42.00" />
        </Field>
        <Field label="Vendor">
          <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="B&H, Adobe…" />
        </Field>
        <Field label="Category">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </Field>
      </div>
      <label style={{ display: 'block', marginTop: '0.6rem' }}>
        <span className="label">Note</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--text-mid)', cursor: 'pointer' }}>
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        Rebillable to a client
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.85rem' }}>
        <button className="btn-primary" disabled={busy || !amount.trim()} onClick={onAdd}>
          {busy ? 'Logging…' : 'Log expense'}
        </button>
        {saved && <span style={{ fontSize: '0.76rem', color: 'var(--good)' }}>Logged.</span>}
        {error && <span style={{ fontSize: '0.76rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
    </div>
  );
}

// ─── Mileage quick-add ────────────────────────────────────────────────

function MileageForm({ rate, isAdmin }: { rate: number; isAdmin: boolean }) {
  const router = useRouter();
  const [droveOn, setDroveOn] = useState(todayIso());
  const [purpose, setPurpose] = useState('');
  const [miles, setMiles] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const milesNum = Number(miles);
  const preview = Number.isFinite(milesNum) && milesNum > 0 ? mileageAmount(milesNum, rate) : 0;

  async function onAdd() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await addMileage({ droveOn, purpose, miles, note });
    if (res.ok) {
      setPurpose('');
      setMiles('');
      setNote('');
      setSaved(true);
      router.refresh();
    } else {
      setError(res.error ?? 'Could not log the miles.');
    }
    setBusy(false);
  }

  return (
    <div className="surface-tool">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
        <div className="eyebrow">Log mileage</div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
          {fmtMoney(preview)} @ {rate}/mi
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
        <Field label="Date">
          <input className="input" type="date" value={droveOn} onChange={(e) => setDroveOn(e.target.value)} />
        </Field>
        <Field label="Miles">
          <input className="input" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} placeholder="40" />
        </Field>
        <Field label="Purpose">
          <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Frisco shoot, scout…" />
        </Field>
      </div>
      <label style={{ display: 'block', marginTop: '0.6rem' }}>
        <span className="label">Note</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.85rem' }}>
        <button className="btn-primary" disabled={busy || !miles.trim()} onClick={onAdd}>
          {busy ? 'Logging…' : 'Log miles'}
        </button>
        {saved && <span style={{ fontSize: '0.76rem', color: 'var(--good)' }}>Logged.</span>}
        {error && <span style={{ fontSize: '0.76rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
      {isAdmin && <RateEditor rate={rate} />}
    </div>
  );
}

function RateEditor({ rate }: { rate: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(rate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await setMileageRate({ rate: val });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? 'Could not update the rate.');
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)} style={{ padding: '0.3rem 0', marginTop: '0.5rem', fontSize: '0.72rem' }}>
        Rate is {rate}/mi — edit
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.6rem' }}>
      <input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 90 }} />
      <button className="btn-primary" disabled={busy} onClick={save} style={{ padding: '0.35rem 0.7rem' }}>Save</button>
      <button className="btn-ghost" onClick={() => setOpen(false)} style={{ padding: '0.35rem 0.5rem' }}>Cancel</button>
      {error && <span style={{ fontSize: '0.72rem', color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
