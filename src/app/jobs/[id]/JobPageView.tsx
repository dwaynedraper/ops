'use client';

/**
 * The job page — one engagement, interactive. Header + stage rail, an
 * editable schedule/value card, payment toggle, the roles editor (the
 * several people on one job), the embedded calculator (quotes link back
 * to this job), and quote history. Mirrors the prospect/client dialect.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalculatorClient } from '@/app/calculator/CalculatorClient';
import { useUnsavedGuard } from '@/components/useUnsavedGuard';
import { fmtMoney } from '@/lib/pricing';
import {
  JOB_STAGE_FLOW,
  JOB_STAGE_LABEL,
  JOB_STAGE_NEXT,
  JOB_ROLE_LABEL,
  JOB_ROLE_HINT,
  PAYMENT_LABEL,
  jobStageIndex,
  jobStageActionLabel,
  isJobClosed,
  type JobStage,
  type PaymentStatus,
  type JobRole,
} from '@/lib/jobs';
import type { Catalog, Branch, QuoteClientInfo } from '@/lib/catalog';
import type { PaymentRow } from '@/lib/money';
import { jobProfit } from '@/lib/ledger';
import { searchClients, type ClientSearchHit } from '@/app/clients/actions';
import { PaymentsCard } from './PaymentsCard';
import {
  updateJobDetails,
  advanceJobStage,
  addJobRole,
  removeJobRole,
} from './actions';

export interface JobDetail {
  id: string;
  clientId: string;
  clientName: string;
  title: string | null;
  stage: JobStage;
  workflowName: string | null;
  workflowAccent: string | null;
  branch: Branch | null;
  shootDate: string | null;
  location: string | null;
  deliveryDue: string | null;
  valuePrice: number | null;
  paymentStatus: PaymentStatus;
  ownerName: string | null;
  createdAtLabel: string;
}
export interface JobRoleItem {
  id: string;
  clientId: string;
  clientName: string;
  role: JobRole;
  roleLabel: string | null;
}
export interface JobQuoteItem {
  id: string;
  quoteNumber: number;
  totalPrice: number;
  status: string;
  packageLabel: string;
  createdAtLabel: string;
}

const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-faint)',
  sent: 'var(--warn)',
  accepted: 'var(--good)',
  declined: 'var(--bad)',
  archived: 'var(--text-faint)',
};

export function JobPageView({
  job,
  roles,
  quotes,
  payments,
  expensesTotal,
  mileageTotal,
  catalog,
  role,
}: {
  job: JobDetail;
  roles: JobRoleItem[];
  quotes: JobQuoteItem[];
  payments: PaymentRow[];
  expensesTotal: number;
  mileageTotal: number;
  catalog: Catalog;
  role: 'super_admin' | 'partner';
}) {
  const router = useRouter();
  const accent = job.workflowAccent ?? 'var(--accent)';
  const closed = isJobClosed(job.stage);
  const allowedStages = JOB_STAGE_NEXT[job.stage] ?? [];

  const initialClient = useMemo<QuoteClientInfo>(
    () => ({
      name: job.clientName,
      email: '',
      phone: '',
      project: job.title ?? '',
      targetDate: job.shootDate ?? '',
      notes: '',
    }),
    [job.clientName, job.title, job.shootDate],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Link
        href={`/clients/${job.clientId}`}
        className="btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '0.2rem 0' }}
      >
        ← {job.clientName}
      </Link>

      {/* Header */}
      <div className="surface-tool">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: '0.3rem', color: accent }}>
              {job.workflowName ?? 'Job'}
            </div>
            <h1
              style={{
                fontFamily: 'var(--font-playfair), serif',
                fontSize: 'clamp(1.4rem, 3vw, 2rem)',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              {job.title || `${job.clientName} — job`}
            </h1>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>
              Booked {job.createdAtLabel}
              {job.ownerName ? ` · ${job.ownerName}` : ''}
            </p>
          </div>
          {job.valuePrice !== null && (
            <div style={{ textAlign: 'right' }}>
              <span className="money" style={{ fontSize: '1.4rem', color: 'var(--text)', lineHeight: 1 }}>
                {fmtMoney(job.valuePrice)}
              </span>
              <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-faint)' }}>
                {PAYMENT_LABEL[job.paymentStatus]}
              </span>
            </div>
          )}
        </div>

        {/* Stage rail */}
        <div style={{ marginTop: '1.1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <StageRail stage={job.stage} accent={accent} />
        </div>

        {/* Stage actions */}
        {allowedStages.length > 0 && (
          <StageActions jobId={job.id} allowed={allowedStages} />
        )}
        {closed && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.8rem' }}>
            This job is {JOB_STAGE_LABEL[job.stage].toLowerCase()}. Reopen it to make further changes
            to the lifecycle.
          </p>
        )}
      </div>

      {/* Schedule + value */}
      <JobDetailsEditor job={job} />

      {/* Payments — dated rows (Phase 5A) */}
      <PaymentsCard jobId={job.id} rows={payments} jobValue={job.valuePrice} />

      {/* Profitability (Phase 5C) — only once a cost exists */}
      {(expensesTotal > 0 || mileageTotal > 0) && (
        <ProfitStrip value={job.valuePrice} expenses={expensesTotal} mileage={mileageTotal} />
      )}

      {/* Roles */}
      <RolesEditor jobId={job.id} primaryName={job.clientName} roles={roles} />

      {/* Quotes */}
      <div>
        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
          Quotes
        </div>
        {quotes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
            {quotes.map((q) => (
              <Link
                key={q.id}
                href={`/quotes/${q.id}`}
                className="surface-tool"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.7rem 0.9rem',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span className="money" style={{ fontSize: '0.82rem', color: 'var(--text-faint)', flexShrink: 0 }}>
                  #{q.quoteNumber}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: '0.84rem',
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {q.packageLabel}
                </span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: QUOTE_STATUS_COLOR[q.status] ?? 'var(--text-faint)',
                    flexShrink: 0,
                  }}
                >
                  {q.status}
                </span>
                <span className="money" style={{ fontSize: '0.9rem', color: 'var(--text)', flexShrink: 0 }}>
                  {fmtMoney(q.totalPrice)}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            No quotes on this job yet — build one below.
          </p>
        )}

        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
          Build a quote
        </div>
        <CalculatorClient
          catalog={catalog}
          role={role}
          jobId={job.id}
          initialClient={initialClient}
          defaultBranch={job.branch ?? undefined}
          onSaved={() => router.refresh()}
        />
      </div>

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}

// ─── Stage rail ───────────────────────────────────────────────────────

function StageRail({ stage, accent }: { stage: JobStage; accent: string }) {
  const current = jobStageIndex(stage);
  if (current === 0) {
    return (
      <span
        style={{
          fontSize: '0.7rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: stage === 'cancelled' ? 'var(--bad)' : 'var(--text-faint)',
        }}
      >
        {JOB_STAGE_LABEL[stage]}
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {JOB_STAGE_FLOW.map((s, i) => {
        const done = i + 1 < current;
        const here = i + 1 === current;
        return (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.25rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${here ? accent : 'var(--border)'}`,
              background: here ? `${accent}1A` : done ? 'var(--surface-tool-2)' : 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: here ? accent : done ? 'var(--good)' : 'var(--text-faint)',
                opacity: done || here ? 1 : 0.4,
              }}
            />
            <span
              style={{
                fontSize: '0.66rem',
                fontWeight: here ? 700 : 500,
                color: here ? 'var(--text)' : done ? 'var(--text-mid)' : 'var(--text-faint)',
              }}
            >
              {JOB_STAGE_LABEL[s]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StageActions({ jobId, allowed }: { jobId: string; allowed: JobStage[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStage(next: JobStage) {
    setBusy(true);
    setError(null);
    const res = await advanceJobStage({ jobId, nextStage: next });
    if (res.ok) router.refresh();
    else {
      setError(res.error ?? 'Could not update the stage.');
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.9rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {allowed.map((s) => {
          const primary = s !== 'cancelled' && s !== 'booked';
          return (
            <button
              key={s}
              className={primary ? 'btn-primary' : 'btn-outline'}
              disabled={busy}
              onClick={() => onStage(s)}
            >
              {jobStageActionLabel(s)}
            </button>
          );
        })}
      </div>
      {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)', marginTop: '0.6rem' }}>{error}</p>}
    </div>
  );
}

// ─── Schedule + value editor ──────────────────────────────────────────

interface DetailsForm {
  title: string;
  shootDate: string;
  location: string;
  deliveryDue: string;
  valuePrice: string;
  notes: string;
}

function JobDetailsEditor({ job }: { job: JobDetail }) {
  const router = useRouter();
  const initial = useMemo<DetailsForm>(
    () => ({
      title: job.title ?? '',
      shootDate: job.shootDate ?? '',
      location: job.location ?? '',
      deliveryDue: job.deliveryDue ?? '',
      valuePrice: job.valuePrice === null ? '' : String(job.valuePrice),
      notes: '',
    }),
    [job],
  );
  const [form, setForm] = useState<DetailsForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedGuard(dirty);

  function patch(p: Partial<DetailsForm>) {
    setForm((f) => ({ ...f, ...p }));
    setSaved(false);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateJobDetails({ jobId: job.id, ...form });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not save the job.');
      }
    } catch {
      setError('Could not save — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.9rem' }}>
        Schedule &amp; value
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <DFieldFull label="Job title">
          <input
            className="input"
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Fall family session / 123 Oak St listing"
          />
        </DFieldFull>
        <DField label="Shoot date">
          <input
            className="input"
            type="date"
            value={form.shootDate}
            onChange={(e) => patch({ shootDate: e.target.value })}
          />
        </DField>
        <DField label="Delivery due">
          <input
            className="input"
            type="date"
            value={form.deliveryDue}
            onChange={(e) => patch({ deliveryDue: e.target.value })}
          />
        </DField>
        <DField label="Location">
          <input
            className="input"
            value={form.location}
            onChange={(e) => patch({ location: e.target.value })}
          />
        </DField>
        <DField label="Value ($)">
          <input
            className="input"
            inputMode="decimal"
            value={form.valuePrice}
            onChange={(e) => patch({ valuePrice: e.target.value })}
            placeholder="From the accepted quote"
          />
        </DField>
        <DFieldFull label="Notes">
          <textarea
            className="textarea"
            rows={2}
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Anything about the shoot day, the deliverables, the access."
          />
        </DFieldFull>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '1rem' }}>
        <button className="btn-primary" disabled={busy || !dirty} onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && !dirty && <span style={{ fontSize: '0.78rem', color: 'var(--good)' }}>Saved.</span>}
        {error && <span style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
    </div>
  );
}

function DField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
function DFieldFull({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', gridColumn: '1 / -1' }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// ─── Profitability strip (Phase 5C) ──────────────────────────────────

function ProfitStrip({
  value,
  expenses,
  mileage,
}: {
  value: number | null;
  expenses: number;
  mileage: number;
}) {
  const p = jobProfit(value, expenses, mileage);
  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.7rem' }}>Profitability</div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ProfitNum label="Value" value={value !== null ? fmtMoney(value) : '—'} tone="text" />
        <ProfitNum label="Expenses" value={`↓ ${fmtMoney(p.expenses)}`} tone="muted" />
        <ProfitNum label="Mileage" value={`↓ ${fmtMoney(p.mileage)}`} tone="muted" />
        <ProfitNum
          label="Net"
          value={fmtMoney(p.net)}
          tone={p.net >= 0 ? 'good' : 'bad'}
          strong
        />
      </div>
      <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.6rem' }}>
        Net = value − expenses − mileage linked to this job.
      </p>
    </div>
  );
}

function ProfitNum({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone: 'text' | 'muted' | 'good' | 'bad';
  strong?: boolean;
}) {
  const color =
    tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : tone === 'muted' ? 'var(--text-mid)' : 'var(--text)';
  return (
    <div>
      <div className="money" style={{ fontSize: strong ? '1.4rem' : '1.15rem', lineHeight: 1, color }}>
        {value}
      </div>
      <div style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 700, marginTop: '0.2rem' }}>
        {label}
      </div>
    </div>
  );
}

// ─── Roles editor ─────────────────────────────────────────────────────

function RolesEditor({
  jobId,
  primaryName,
  roles,
}: {
  jobId: string;
  primaryName: string;
  roles: JobRoleItem[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRemove(roleId: string) {
    setBusy(true);
    setError(null);
    const res = await removeJobRole({ jobId, roleId });
    if (res.ok) router.refresh();
    else {
      setError(res.error ?? 'Could not remove the role.');
      setBusy(false);
    }
  }

  return (
    <div className="surface-tool">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '1rem',
          marginBottom: '0.7rem',
        }}
      >
        <div className="eyebrow">People on this job</div>
        {!adding && (
          <button className="btn-ghost" onClick={() => setAdding(true)} style={{ padding: '0.2rem 0' }}>
            + Add role
          </button>
        )}
      </div>

      {/* Primary contact — always the client */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.55rem 0.7rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-accent)',
          background: 'var(--accent-dim)',
          marginBottom: '0.5rem',
        }}
      >
        <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>
          {primaryName}
        </span>
        <span
          style={{
            fontSize: '0.6rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--accent)',
          }}
        >
          Primary contact
        </span>
      </div>

      {/* Additional roles */}
      {roles.map((r) => (
        <div
          key={r.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.55rem 0.7rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            marginBottom: '0.5rem',
          }}
        >
          <Link
            href={`/clients/${r.clientId}`}
            style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, textDecoration: 'none' }}
          >
            {r.clientName}
          </Link>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-mid)' }}>
            {r.role === 'other' && r.roleLabel ? r.roleLabel : JOB_ROLE_LABEL[r.role]}
          </span>
          <button
            className="btn-ghost"
            style={{ padding: '0.1rem 0.3rem' }}
            disabled={busy}
            onClick={() => onRemove(r.id)}
          >
            Remove
          </button>
        </div>
      ))}

      {roles.length === 0 && !adding && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
          Just the primary contact so far. Add a billing payer, the subject, or a gallery
          recipient when they differ.
        </p>
      )}

      {adding && (
        <AddRoleForm
          jobId={jobId}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)', marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}

function AddRoleForm({
  jobId,
  onDone,
  onCancel,
}: {
  jobId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClientSearchHit[]>([]);
  const [picked, setPicked] = useState<ClientSearchHit | null>(null);
  const [role, setRole] = useState<JobRole>('billing');
  const [roleLabel, setRoleLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (seq.current === mine) setHits([]);
        return;
      }
      const results = await searchClients(q);
      if (seq.current === mine) setHits(results);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  async function onAdd() {
    if (!picked) {
      setError('Pick a person first.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addJobRole({ jobId, clientId: picked.id, role, roleLabel });
    if (res.ok) onDone();
    else {
      setError(res.error ?? 'Could not add the role.');
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: '0.6rem',
        padding: '0.8rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--border-accent)',
        background: 'var(--surface-tool-2)',
      }}
    >
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
        Attach another person on file. They&apos;re a client record too — search by name. New
        person? Add them in <Link href="/clients/new" style={{ color: 'var(--accent)' }}>Clients</Link> first.
      </p>

      {picked ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>{picked.displayName}</span>
          <button className="btn-ghost" style={{ padding: '0.1rem 0.3rem' }} onClick={() => setPicked(null)}>
            change
          </button>
        </div>
      ) : (
        <>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            style={{ marginBottom: '0.4rem' }}
          />
          {hits.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.6rem' }}>
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setPicked(h);
                    setHits([]);
                    setQuery('');
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '0.4rem 0.55rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--text)',
                    fontSize: '0.82rem',
                  }}
                >
                  {h.displayName}
                  {h.marketArea ? <span style={{ color: 'var(--text-faint)' }}> · {h.marketArea}</span> : null}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
        <label style={{ display: 'block' }}>
          <span className="label">Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as JobRole)}>
            {(Object.keys(JOB_ROLE_LABEL) as JobRole[]).map((r) => (
              <option key={r} value={r}>
                {JOB_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {role === 'other' && (
          <label style={{ display: 'block' }}>
            <span className="label">Label</span>
            <input
              className="input"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="Scheduler, decision-maker…"
            />
          </label>
        )}
      </div>
      <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.35rem' }}>
        {JOB_ROLE_HINT[role]}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
        <button className="btn-primary" disabled={busy || !picked} onClick={onAdd}>
          {busy ? 'Adding…' : 'Add to job'}
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)', marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}
