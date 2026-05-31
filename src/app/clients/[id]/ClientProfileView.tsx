'use client';

/**
 * The client page — the cold-call card. Header + relationship, an editable
 * details card, the pinned facts + notes timeline (business-context
 * notes), and the history: lifetime value + past quotes. The "+ New job"
 * button is a Phase-2 stub. Mirrors the prospect client-page dialect.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtMoney } from '@/lib/pricing';
import { useUnsavedGuard } from '@/components/useUnsavedGuard';
import {
  clientInitials,
  clientSubtitle,
  CLIENT_KIND_LABEL,
  CLIENT_BRANCH_LABEL,
  type ClientKind,
  type ClientStatus,
  type ClientBranch,
} from '@/lib/clients';
import { JOB_STAGE_LABEL, PAYMENT_LABEL, isJobClosed, type JobStage, type PaymentStatus } from '@/lib/jobs';
import {
  updateClientDetails,
  addClientNote,
  setClientNotePinned,
  setClientArchived,
  createJobForClient,
} from './actions';

export interface ClientDetail {
  id: string;
  kind: ClientKind;
  displayName: string;
  email: string | null;
  phone: string | null;
  marketArea: string | null;
  relationship: string | null;
  referralSource: string | null;
  branchAffinity: ClientBranch | null;
  status: ClientStatus;
  ownerName: string | null;
  originProspectId: string | null;
  createdAtLabel: string;
}
export interface ClientNoteItem {
  id: string;
  body: string;
  pinned: boolean;
  authorName: string | null;
  createdAtLabel: string;
}
export interface ClientQuoteItem {
  id: string;
  quoteNumber: number;
  totalPrice: number;
  status: string;
  packageLabel: string;
  createdAtLabel: string;
}
export interface ClientJobItem {
  id: string;
  title: string | null;
  stage: JobStage;
  workflowName: string | null;
  workflowAccent: string | null;
  shootDateLabel: string | null;
  valuePrice: number | null;
  paymentStatus: PaymentStatus;
  updatedAtLabel: string;
}

const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-faint)',
  sent: 'var(--warn)',
  accepted: 'var(--good)',
  declined: 'var(--bad)',
  archived: 'var(--text-faint)',
};

export function ClientProfileView({
  client,
  notes,
  quotes,
  jobs,
  lifetimeValue,
}: {
  client: ClientDetail;
  notes: ClientNoteItem[];
  quotes: ClientQuoteItem[];
  jobs: ClientJobItem[];
  lifetimeValue: number;
}) {
  const pinned = notes.filter((n) => n.pinned);
  const timeline = notes.filter((n) => !n.pinned);
  const archived = client.status === 'archived';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Link
        href="/clients"
        className="btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '0.2rem 0' }}
      >
        ← Clients
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
          <div style={{ display: 'flex', gap: '0.9rem', minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                fontWeight: 700,
              }}
            >
              {clientInitials(client.displayName)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>
                {CLIENT_KIND_LABEL[client.kind]}
                {client.branchAffinity ? ` · ${CLIENT_BRANCH_LABEL[client.branchAffinity]}` : ''}
              </div>
              <h1
                style={{
                  fontFamily: 'var(--font-playfair), serif',
                  fontSize: 'clamp(1.5rem, 3vw, 2.1rem)',
                  fontWeight: 400,
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                {client.displayName}
              </h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-mid)', marginTop: '0.25rem' }}>
                {clientSubtitle({
                  relationship: client.relationship,
                  marketArea: client.marketArea,
                  email: client.email,
                })}
              </p>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: '0.2rem' }}>
                Added {client.createdAtLabel}
                {client.ownerName ? ` · ${client.ownerName}` : ''}
                {client.originProspectId ? ' · from the pipeline' : ''}
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '0.4rem',
            }}
          >
            <span
              style={{
                fontSize: '0.62rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: archived ? 'var(--text-faint)' : 'var(--good)',
                border: `1px solid ${archived ? 'var(--text-faint)' : 'var(--good)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '0.22rem 0.55rem',
              }}
            >
              {archived ? 'Archived' : 'Active'}
            </span>
            {lifetimeValue > 0 && (
              <div style={{ textAlign: 'right' }}>
                <span className="money" style={{ fontSize: '1.4rem', color: 'var(--text)', lineHeight: 1 }}>
                  {fmtMoney(lifetimeValue)}
                </span>
                <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-faint)' }}>
                  lifetime
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Quick contact + actions */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
          }}
        >
          {client.email && (
            <a href={`mailto:${client.email}`} className="btn-outline">
              Email
            </a>
          )}
          {client.phone && (
            <a href={`tel:${client.phone}`} className="btn-outline">
              Call
            </a>
          )}
          <NewJobButton clientId={client.id} />
        </div>
      </div>

      {/* Details */}
      <ClientDetailsEditor client={client} />

      {/* Notes */}
      <ClientNotesSection clientId={client.id} pinned={pinned} timeline={timeline} />

      {/* Jobs — the real history */}
      <div className="surface-tool">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '1rem',
            marginBottom: '0.85rem',
          }}
        >
          <div className="eyebrow">Jobs</div>
          <NewJobButton clientId={client.id} ghost />
        </div>
        {jobs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {jobs.map((j) => {
              const accent = j.workflowAccent ?? 'var(--text-faint)';
              const closed = isJobClosed(j.stage);
              return (
                <Link
                  key={j.id}
                  href={`/jobs/${j.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.7rem 0.9rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${accent}`,
                    background: `${accent}0D`,
                    textDecoration: 'none',
                    color: 'inherit',
                    opacity: closed ? 0.6 : 1,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {j.title || j.workflowName || 'Job'}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {j.shootDateLabel ?? 'No shoot date'}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: '0.6rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: closed ? 'var(--text-faint)' : accent,
                      flexShrink: 0,
                    }}
                  >
                    {JOB_STAGE_LABEL[j.stage]}
                  </span>
                  {j.valuePrice !== null && (
                    <span
                      className="money"
                      style={{
                        fontSize: '0.86rem',
                        color: j.paymentStatus === 'paid' ? 'var(--good)' : 'var(--text)',
                        flexShrink: 0,
                      }}
                      title={PAYMENT_LABEL[j.paymentStatus]}
                    >
                      {fmtMoney(j.valuePrice)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            No jobs yet. Hit <strong>+ New job</strong> to book one — bookings, shoots,
            deliveries, and payments all live here.
          </p>
        )}
      </div>

      {/* Origin quotes — the pipeline paper trail, if any */}
      {quotes.length > 0 && (
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
            Quotes from the pipeline
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {quotes.map((q) => (
              <Link
                key={q.id}
                href={`/quotes/${q.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.7rem 0.9rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
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
        </div>
      )}

      {/* Archive */}
      <ArchiveControl clientId={client.id} archived={archived} />

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}

// ─── New job button ───────────────────────────────────────────────────

function NewJobButton({ clientId, ghost }: { clientId: string; ghost?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    const res = await createJobForClient({ clientId });
    if (res.ok && res.jobId) {
      router.push(`/jobs/${res.jobId}`);
    } else {
      setError(res.error ?? 'Could not create the job.');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={ghost ? 'btn-ghost' : 'btn-primary'}
        disabled={busy}
        onClick={onClick}
        style={ghost ? { padding: '0.2rem 0' } : undefined}
      >
        {busy ? 'Creating…' : '+ New job'}
      </button>
      {error && <span style={{ fontSize: '0.76rem', color: 'var(--bad)' }}>{error}</span>}
    </>
  );
}

// ─── Details editor ───────────────────────────────────────────────────

interface DetailsForm {
  kind: ClientKind;
  displayName: string;
  email: string;
  phone: string;
  marketArea: string;
  relationship: string;
  referralSource: string;
  branchAffinity: ClientBranch | '';
}

function ClientDetailsEditor({ client }: { client: ClientDetail }) {
  const router = useRouter();
  const initial = useMemo<DetailsForm>(
    () => ({
      kind: client.kind,
      displayName: client.displayName,
      email: client.email ?? '',
      phone: client.phone ?? '',
      marketArea: client.marketArea ?? '',
      relationship: client.relationship ?? '',
      referralSource: client.referralSource ?? '',
      branchAffinity: client.branchAffinity ?? '',
    }),
    [client],
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
      const res = await updateClientDetails({ clientId: client.id, ...form });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not save the details.');
      }
    } catch {
      setError('Could not save the details — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.9rem' }}>
        Details
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.9rem' }}>
        {(['person', 'org'] as ClientKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => patch({ kind: k })}
            className={form.kind === k ? 'btn-primary' : 'btn-outline'}
          >
            {CLIENT_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <DField label={form.kind === 'org' ? 'Business name' : 'Full name'}>
          <input className="input" value={form.displayName} onChange={(e) => patch({ displayName: e.target.value })} />
        </DField>
        <DField label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} />
        </DField>
        <DField label="Phone">
          <input className="input" value={form.phone} onChange={(e) => patch({ phone: e.target.value })} />
        </DField>
        <DField label="Market area">
          <input className="input" value={form.marketArea} onChange={(e) => patch({ marketArea: e.target.value })} />
        </DField>
        <DField label="Branch">
          <select
            className="select"
            value={form.branchAffinity}
            onChange={(e) => patch({ branchAffinity: e.target.value as ClientBranch | '' })}
          >
            <option value="">—</option>
            {(Object.keys(CLIENT_BRANCH_LABEL) as ClientBranch[]).map((b) => (
              <option key={b} value={b}>
                {CLIENT_BRANCH_LABEL[b]}
              </option>
            ))}
          </select>
        </DField>
        <DField label="Referred by">
          <input className="input" value={form.referralSource} onChange={(e) => patch({ referralSource: e.target.value })} />
        </DField>
        <DFieldFull label="Relationship">
          <input
            className="input"
            value={form.relationship}
            onChange={(e) => patch({ relationship: e.target.value })}
            placeholder="How you know them — kept to business context"
          />
        </DFieldFull>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '1rem' }}>
        <button className="btn-primary" disabled={busy || !dirty} onClick={onSave}>
          {busy ? 'Saving…' : 'Save details'}
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

// ─── Notes ────────────────────────────────────────────────────────────

function ClientNotesSection({
  clientId,
  pinned,
  timeline,
}: {
  clientId: string;
  pinned: ClientNoteItem[];
  timeline: ClientNoteItem[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pinNew, setPinNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useUnsavedGuard(body.trim().length > 0);

  async function onAdd() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addClientNote({ clientId, body, pinned: pinNew });
      if (res.ok) {
        setBody('');
        setPinNew(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not add the note.');
      }
    } catch {
      setError('Could not add the note — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onPinToggle(noteId: string, pinnedNext: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await setClientNotePinned({ clientId, noteId, pinned: pinnedNext });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? 'Could not update the note.');
      }
    } catch {
      setError('Could not update the note — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.9rem' }}>
        Notes
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <textarea
          className="textarea"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="A call recap, a business-context detail — met at the chamber mixer, opening a second office."
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.78rem',
              color: 'var(--text-mid)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={pinNew}
              onChange={(e) => setPinNew(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            Pin as an evergreen fact
          </label>
          <button className="btn-primary" disabled={busy || !body.trim()} onClick={onAdd} style={{ marginLeft: 'auto' }}>
            {busy ? 'Adding…' : 'Add note'}
          </button>
        </div>
        {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</p>}
      </div>

      {pinned.length > 0 && (
        <div style={{ marginTop: '1.1rem' }}>
          <div
            style={{
              fontSize: '0.66rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              fontWeight: 700,
              marginBottom: '0.5rem',
            }}
          >
            Pinned facts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {pinned.map((n) => (
              <NoteRow key={n.id} note={n} busy={busy} onPinToggle={onPinToggle} />
            ))}
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div style={{ marginTop: '1.1rem' }}>
          <div
            style={{
              fontSize: '0.66rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
              fontWeight: 700,
              marginBottom: '0.5rem',
            }}
          >
            Timeline
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {timeline.map((n) => (
              <NoteRow key={n.id} note={n} busy={busy} onPinToggle={onPinToggle} />
            ))}
          </div>
        </div>
      )}

      {pinned.length === 0 && timeline.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
          No notes yet — the first one starts the record.
        </p>
      )}
    </div>
  );
}

function NoteRow({
  note,
  busy,
  onPinToggle,
}: {
  note: ClientNoteItem;
  busy: boolean;
  onPinToggle: (id: string, pinned: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        padding: '0.6rem 0.7rem',
        borderRadius: 'var(--radius-sm)',
        background: note.pinned ? 'var(--accent-dim)' : 'var(--surface-tool-2)',
        border: `1px solid ${note.pinned ? 'var(--border-accent)' : 'var(--border)'}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.83rem', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {note.body}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: '0.3rem' }}>
          {(note.authorName ?? 'Someone') + ' · ' + note.createdAtLabel}
        </div>
      </div>
      <button
        className="btn-ghost"
        style={{ padding: '0.15rem 0.35rem', flexShrink: 0 }}
        disabled={busy}
        onClick={() => onPinToggle(note.id, !note.pinned)}
      >
        {note.pinned ? 'Unpin' : 'Pin'}
      </button>
    </div>
  );
}

// ─── Archive control ──────────────────────────────────────────────────

function ArchiveControl({ clientId, archived }: { clientId: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await setClientArchived({ clientId, archived: !archived });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? 'Could not update the client.');
      }
    } catch {
      setError('Could not update the client — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
      <button className="btn-ghost" disabled={busy} onClick={onToggle}>
        {archived ? 'Restore client' : 'Archive client'}
      </button>
      {error && <span style={{ fontSize: '0.76rem', color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}
