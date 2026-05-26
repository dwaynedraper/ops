'use client';

/**
 * The client page — a prospect's mini-CRM, interactive.
 *
 * Header + lifecycle stage actions, an editable details card (labelled by
 * the workflow's vocabulary), the pinned facts + notes timeline, an
 * embedded calculator whose quotes link back to this prospect, and the
 * quote history. The 10% workflow has no quote — the calculator is
 * suppressed there. Every mutation runs a server action then refreshes.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalculatorClient } from '@/app/calculator/CalculatorClient';
import { useUndo } from '@/components/UndoProvider';
import { useUnsavedGuard } from '@/components/useUnsavedGuard';
import { fmtMoney } from '@/lib/pricing';
import { STAGE_LABEL, type ProspectStage, type ScoreBand } from '@/lib/prospects';
import type { Catalog, QuoteClientInfo, Branch } from '@/lib/catalog';
import { updateProspectDetails, addNote, setNotePinned, advanceStage } from './actions';

// ─── DTOs (page.tsx builds these) ─────────────────────────────────────

export interface ProspectDetail {
  id: string;
  workflowKey: string;
  workflowName: string;
  workflowAccent: string;
  contactNoun: string;
  orgNoun: string | null;
  branch: Branch | null;
  contactName: string;
  orgName: string | null;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  socialUrl: string | null;
  marketArea: string | null;
  rankScore: number;
  band: ScoreBand;
  stage: ProspectStage;
  signedByName: string | null;
  createdAtLabel: string;
}

export interface NoteItem {
  id: string;
  body: string;
  pinned: boolean;
  authorName: string | null;
  createdAtLabel: string;
}

export interface QuoteHistoryItem {
  id: string;
  quoteNumber: number;
  totalPrice: number;
  status: string;
  packageLabel: string;
  createdAtLabel: string;
}

// ─── Display maps ─────────────────────────────────────────────────────

const BAND_COLOR: Record<ScoreBand, string> = {
  qualified: 'var(--good)',
  borderline: 'var(--warn)',
  reject: 'var(--text-faint)',
};

const STAGE_COLOR: Record<ProspectStage, string> = {
  researching: 'var(--text-faint)',
  qualified: 'var(--good)',
  contacting: 'var(--accent)',
  responded: 'var(--warn)',
  signed: 'var(--good)',
  client: 'var(--brand-cyan)',
  passed: 'var(--text-faint)',
  dormant: 'var(--text-faint)',
};

const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-faint)',
  sent: 'var(--warn)',
  accepted: 'var(--good)',
  declined: 'var(--bad)',
  archived: 'var(--text-faint)',
};

function stageActionLabel(stage: ProspectStage): string {
  switch (stage) {
    case 'qualified':
      return 'Mark as qualified';
    case 'signed':
      return 'Mark as signed';
    case 'client':
      return 'Mark as active client';
    case 'passed':
      return 'Pass on this prospect';
    case 'dormant':
      return 'Mark dormant';
    default:
      return `Move to ${STAGE_LABEL[stage]}`;
  }
}

// ─── Main view ────────────────────────────────────────────────────────

export function ClientPageView({
  prospect,
  allowedStages,
  notes,
  quotes,
  catalog,
  role,
}: {
  prospect: ProspectDetail;
  allowedStages: ProspectStage[];
  notes: NoteItem[];
  quotes: QuoteHistoryItem[];
  catalog: Catalog;
  role: 'super_admin' | 'partner';
}) {
  const router = useRouter();
  const undo = useUndo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialClient = useMemo<QuoteClientInfo>(
    () => ({
      name: prospect.contactName,
      email: prospect.email ?? '',
      phone: prospect.phone ?? '',
      project: '',
      targetDate: '',
      notes: '',
    }),
    [prospect.contactName, prospect.email, prospect.phone],
  );

  // A stage move runs behind the 20-second undo window. The undo provider
  // fires the action only if the rep doesn't undo, and refreshes the route
  // itself on a successful commit.
  async function onStage(next: ProspectStage) {
    setBusy(true);
    setError(null);
    const result = await undo.runWithUndo({
      label: `Moved to ${STAGE_LABEL[next]}`,
      run: () => advanceStage({ prospectId: prospect.id, nextStage: next }),
    });
    if (result.outcome === 'failed') {
      setError(result.error);
    }
    setBusy(false);
  }

  const pinned = notes.filter((n) => n.pinned);
  const timeline = notes.filter((n) => !n.pinned);
  const subtitle =
    [prospect.orgName, prospect.marketArea].filter(Boolean).join(' · ') || 'No details yet';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Link
        href="/clients"
        className="btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '0.2rem 0' }}
      >
        ← Clients
      </Link>

      {/* ─── Header ──────────────────────────────────────────────────── */}
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
            <div
              className="eyebrow"
              style={{ marginBottom: '0.35rem', color: prospect.workflowAccent }}
            >
              {prospect.workflowName}
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
              {prospect.contactName}
            </h1>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-mid)', marginTop: '0.25rem' }}>
              {subtitle}
            </p>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: '0.2rem' }}>
              Researched {prospect.createdAtLabel}
              {prospect.signedByName ? ` · signed by ${prospect.signedByName}` : ''}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
            <span
              style={{
                fontSize: '0.64rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: STAGE_COLOR[prospect.stage],
                border: `1px solid ${STAGE_COLOR[prospect.stage]}`,
                borderRadius: 'var(--radius-sm)',
                padding: '0.22rem 0.55rem',
              }}
            >
              {STAGE_LABEL[prospect.stage]}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
              <span
                className="money"
                style={{ fontSize: '1.5rem', color: BAND_COLOR[prospect.band], lineHeight: 1 }}
              >
                {prospect.rankScore.toFixed(1)}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>/ 10</span>
            </div>
          </div>
        </div>

        {/* Stage actions */}
        {allowedStages.length > 0 && (
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
            {allowedStages.map((s) => {
              const primary = s === 'signed' || s === 'client';
              return (
                <button
                  key={s}
                  className={primary ? 'btn-primary' : 'btn-outline'}
                  disabled={busy}
                  onClick={() => onStage(s)}
                >
                  {stageActionLabel(s)}
                </button>
              );
            })}
          </div>
        )}
        {error && (
          <p style={{ fontSize: '0.78rem', color: 'var(--bad)', marginTop: '0.6rem' }}>{error}</p>
        )}
      </div>

      {/* ─── Details ─────────────────────────────────────────────────── */}
      <DetailsEditor prospect={prospect} />

      {/* ─── Notes ───────────────────────────────────────────────────── */}
      <NotesSection prospectId={prospect.id} pinned={pinned} timeline={timeline} />

      {/* ─── Quotes ──────────────────────────────────────────────────── */}
      {prospect.branch === null ? (
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
            Contributed work
          </div>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            The {prospect.workflowName} workflow is pro-bono — there&apos;s no quote
            to build here.
          </p>
        </div>
      ) : (
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
                  <span
                    className="money"
                    style={{ fontSize: '0.82rem', color: 'var(--text-faint)', flexShrink: 0 }}
                  >
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
                  <span
                    className="money"
                    style={{ fontSize: '0.9rem', color: 'var(--text)', flexShrink: 0 }}
                  >
                    {fmtMoney(q.totalPrice)}
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-faint)',
                      flexShrink: 0,
                      minWidth: '5.5rem',
                      textAlign: 'right',
                    }}
                  >
                    {q.createdAtLabel}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              No quotes yet — build one below.
            </p>
          )}

          <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
            Build a quote
          </div>
          <CalculatorClient
            catalog={catalog}
            role={role}
            prospectId={prospect.id}
            initialClient={initialClient}
            defaultBranch={prospect.branch}
            onSaved={() => router.refresh()}
          />
        </div>
      )}

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}

// ─── Details editor ───────────────────────────────────────────────────

interface DetailsForm {
  contactName: string;
  orgName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  socialUrl: string;
  marketArea: string;
}

function DetailsEditor({ prospect }: { prospect: ProspectDetail }) {
  const router = useRouter();
  const initial = useMemo<DetailsForm>(
    () => ({
      contactName: prospect.contactName,
      orgName: prospect.orgName ?? '',
      email: prospect.email ?? '',
      phone: prospect.phone ?? '',
      websiteUrl: prospect.websiteUrl ?? '',
      socialUrl: prospect.socialUrl ?? '',
      marketArea: prospect.marketArea ?? '',
    }),
    [prospect],
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
      const res = await updateProspectDetails({ prospectId: prospect.id, ...form });
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <DField label={`${prospect.contactNoun} name`}>
          <input
            className="input"
            value={form.contactName}
            onChange={(e) => patch({ contactName: e.target.value })}
          />
        </DField>
        {prospect.orgNoun && (
          <DField label={prospect.orgNoun}>
            <input
              className="input"
              value={form.orgName}
              onChange={(e) => patch({ orgName: e.target.value })}
            />
          </DField>
        )}
        <DField label="Market area">
          <input
            className="input"
            value={form.marketArea}
            onChange={(e) => patch({ marketArea: e.target.value })}
          />
        </DField>
        <DField label="Email">
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => patch({ email: e.target.value })}
          />
        </DField>
        <DField label="Phone">
          <input
            className="input"
            value={form.phone}
            onChange={(e) => patch({ phone: e.target.value })}
          />
        </DField>
        <DField label="Website">
          <input
            className="input"
            value={form.websiteUrl}
            onChange={(e) => patch({ websiteUrl: e.target.value })}
          />
        </DField>
        <DField label="Social profile">
          <input
            className="input"
            value={form.socialUrl}
            onChange={(e) => patch({ socialUrl: e.target.value })}
          />
        </DField>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          marginTop: '1rem',
        }}
      >
        <button className="btn-primary" disabled={busy || !dirty} onClick={onSave}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
        {saved && !dirty && (
          <span style={{ fontSize: '0.78rem', color: 'var(--good)' }}>Saved.</span>
        )}
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

// ─── Notes ────────────────────────────────────────────────────────────

function NotesSection({
  prospectId,
  pinned,
  timeline,
}: {
  prospectId: string;
  pinned: NoteItem[];
  timeline: NoteItem[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pinNew, setPinNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An untyped-but-unsent note draft counts as unsaved work.
  useUnsavedGuard(body.trim().length > 0);

  async function onAdd() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addNote({ prospectId, body, pinned: pinNew });
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

  async function onPinToggle(noteId: string, pinned: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await setNotePinned({ prospectId, noteId, pinned });
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

      {/* Add */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <textarea
          className="textarea"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's worth remembering — a detail, a call recap, a fact about them."
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
          <button
            className="btn-primary"
            disabled={busy || !body.trim()}
            onClick={onAdd}
            style={{ marginLeft: 'auto' }}
          >
            {busy ? 'Adding…' : 'Add note'}
          </button>
        </div>
        {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</p>}
      </div>

      {/* Pinned facts */}
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

      {/* Timeline */}
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
  note: NoteItem;
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
