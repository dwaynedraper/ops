'use client';

/**
 * QualifyForm — the unified Qualify surface (D-033, P8).
 *
 * One component, two modes:
 *
 *   - **Create mode** (`prospectId === null`). The Qualify entry form.
 *     Identity is editable; the rep is adding an agent they found
 *     through non-Sourcing research. On save the prospect is created.
 *     After a successful create the page redirects to /qualify/[new-id]
 *     so the rep stays on Qualify with the just-created record loaded.
 *
 *   - **Edit mode** (`prospectId` provided). The Qualify deep-work
 *     surface for an existing prospect. Identity displays as a
 *     read-only card with a link to /prospects/[id] for full record
 *     edits; everything else (gates, scoring, status, override
 *     reason) is editable inline. Used as the click destination from
 *     /sourcing — the row's data is pre-filled so the rep is "carrying
 *     the prospect's info from Sourcing to Qualify."
 *
 * Both modes save through `upsertSourcingRow` so the two surfaces
 * stay in sync — same recompute, same lifecycle stage rules, same
 * ownership check. The live score panel uses `scoreProspect` from
 * `lib/prospects` (the same math the server runs).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  scoreProspect,
  classifyBand,
  gatesPassed,
  type RankFactor,
  type RankBands,
  type RankInputs,
  type ScoreBand,
  type ProspectStage,
} from '@/lib/prospects';
import { needsOverride, type SourcingStatus } from '@/lib/sourcing';
import { HelpBox } from '@/components/HelpBox';
import {
  upsertSourcingRow,
  type DuplicateProspect,
} from '@/app/sourcing/actions';
import { DuplicateWarning } from '@/components/DuplicateWarning';

export interface QualifyFormWorkflow {
  key: string;
  name: string;
  accent: string;
  contactNoun: string;
  orgNoun: string | null;
  factors: RankFactor[];
  bands: RankBands;
}

export interface QualifyFormIdentity {
  contactName: string;
  orgName: string | null;
  marketArea: string | null;
  grossVolume: number | null;
  sourceUrl: string | null;
}

const OVERRIDE_MIN_CHARS = 20;

const STATUS_LABEL: Record<SourcingStatus, string> = {
  undecided: 'Undecided',
  pursue: 'Pursue',
  qualify: 'Qualify',
  reject: 'Reject',
};

const BAND_META: Record<ScoreBand, { label: string; color: string }> = {
  qualified: { label: 'Qualified', color: 'var(--good)' },
  borderline: { label: 'Borderline', color: 'var(--warn)' },
  reject: { label: 'Below the bar', color: 'var(--bad)' },
};

/* ── The unified form ──────────────────────────────────────────────── */

export function QualifyForm({
  prospectId,
  workflow,
  initialIdentity,
  initialInputs,
  initialScore,
  initialStage,
  initialSourcingStatus,
  initialSourcingNote,
}: {
  /** Null in create mode; set in edit mode. */
  prospectId: string | null;
  workflow: QualifyFormWorkflow;
  initialIdentity: QualifyFormIdentity;
  initialInputs: RankInputs;
  initialScore: number;
  initialStage: ProspectStage;
  initialSourcingStatus: SourcingStatus;
  initialSourcingNote: string | null;
}) {
  const router = useRouter();
  const isCreate = prospectId === null;

  // Identity is editable in create mode, read-only in edit mode.
  const [identity, setIdentity] = useState<QualifyFormIdentity>(initialIdentity);

  // Rank inputs — seed every factor key so React doesn't flip between
  // controlled/uncontrolled inputs.
  const [inputs, setInputs] = useState<RankInputs>(() => {
    const seeded: RankInputs = { ...initialInputs };
    for (const f of workflow.factors) {
      if (!(f.key in seeded)) {
        seeded[f.key] = f.kind === 'bool' ? false : 0;
      }
    }
    return seeded;
  });

  const [status, setStatus] = useState<SourcingStatus>(initialSourcingStatus);
  const [reason, setReason] = useState<string>(initialSourcingNote ?? '');
  const [serverScore, setServerScore] = useState<number>(initialScore);
  const [serverStage, setServerStage] = useState<ProspectStage>(initialStage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // D-057: same duplicate-warning pattern as Sourcing. Only fires
  // in create mode (the server check skips update). Reset on
  // workflow change via the key={wf.key} on the parent.
  const [pendingDuplicates, setPendingDuplicates] = useState<DuplicateProspect[]>([]);

  // Live score from the local draft.
  const scored = scoreProspect(workflow.factors, inputs);
  const band = classifyBand(scored.score, workflow.bands);
  const gateOpen = gatesPassed(workflow.factors, inputs);

  const gateFactors = workflow.factors.filter((f) => f.isGate);
  const scoringFactors = workflow.factors.filter((f) => !f.isGate);

  // D-045: the override-with-reason rule skips when no qualifier
  // inputs are filled at all — band='reject' (score 0) on a fresh
  // direct-entry isn't meaningful, so don't force a reason out of
  // the rep before they've even started scoring.
  const override = needsOverride(status, band, {
    rankInputs: inputs,
    factorKeys: workflow.factors.map((f) => f.key),
  });
  const reasonOk = !override || reason.trim().length >= OVERRIDE_MIN_CHARS;

  // Create mode requires a name to enable Save. Edit mode requires
  // nothing extra — the row already has one.
  const hasNameForCreate = !isCreate || identity.contactName.trim().length > 0;
  const canSave = !busy && reasonOk && hasNameForCreate;

  function setFactor(key: string, value: boolean | number) {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  function patchIdentity(patch: Partial<QualifyFormIdentity>) {
    setIdentity((prev) => ({ ...prev, ...patch }));
    setSavedAt(null);
  }

  /** Save with the current status (default), or override it for the
   * one-click Qualify path (D-042). The override doesn't reach the
   * needsOverride check because by definition Qualify is a positive
   * call and the rep clicked it at score ≥ 7 — band is qualified or
   * borderline, neither a forced-reason case.
   *
   * D-057: `acknowledgeDuplicates=true` is sent only when the rep
   * has clicked "Continue anyway" on the warning panel for this
   * exact submission. Default false — the server holds the create
   * and returns the duplicates list for any other path. */
  async function onSave(
    overrideStatus?: SourcingStatus,
    acknowledgeDuplicates = false,
  ) {
    if (!canSave && !overrideStatus) return;
    const effectiveStatus = overrideStatus ?? status;
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await upsertSourcingRow(
        isCreate
          ? {
              workflowKey: workflow.key,
              contactName: identity.contactName,
              orgName: identity.orgName ?? '',
              marketArea: identity.marketArea ?? '',
              sourceUrl: identity.sourceUrl ?? '',
              rankInputPatches: inputs,
              sourcingStatus: effectiveStatus,
              sourcingNote: override ? reason.trim() : null,
              acknowledgeDuplicates,
            }
          : {
              id: prospectId,
              rankInputPatches: inputs,
              sourcingStatus: effectiveStatus,
              sourcingNote: override ? reason.trim() : null,
            },
      );
      // D-057: surface the warning panel on a duplicates-only result
      // and pause until the rep chooses Continue / Cancel.
      if (!res.ok && res.duplicates && res.duplicates.length > 0) {
        setPendingDuplicates(res.duplicates);
        return;
      }
      if (!res.ok || !res.row) {
        setError(res.error ?? 'Could not save.');
        return;
      }
      // Sync local state with the saved-from row so the form reflects
      // what's on the server (including any status override).
      if (overrideStatus) setStatus(overrideStatus);
      setServerScore(res.row.rankScore);
      setServerStage(res.row.stage);
      setSavedAt(Date.now());
      setPendingDuplicates([]);
      if (isCreate) {
        // Carry the just-created prospect forward into edit mode —
        // the rep stays on Qualify with the new record loaded.
        router.push(`/qualify/${res.row.id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qualify-layout">
      {/* ─── Form column ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <IdentitySection
          mode={isCreate ? 'edit' : 'display'}
          workflow={workflow}
          identity={identity}
          patchIdentity={patchIdentity}
          prospectId={prospectId}
        />

        {/* Entry gate */}
        {gateFactors.length > 0 && (
          <div className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
              Entry gate
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
              {gateFactors.length === 1 ? 'This gate has' : 'All gates have'} to be true for
              this {workflow.contactNoun.toLowerCase()} to enter the pipeline. Each also adds
              its weight (shown per gate) to the score.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {gateFactors.map((f) => (
                <BoolRow
                  key={f.key}
                  factor={f}
                  workflowKey={workflow.key}
                  checked={inputs[f.key] === true}
                  onChange={(v) => setFactor(f.key, v)}
                  highlight
                />
              ))}
            </div>
            {!gateOpen && (
              <p style={{ fontSize: '0.76rem', color: 'var(--warn)', marginTop: '0.75rem' }}>
                Gate not cleared — this{` ${workflow.contactNoun.toLowerCase()} `}can&apos;t
                enter the pipeline yet.
              </p>
            )}
          </div>
        )}

        {/* Scoring factors */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
            Score the fit
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            Answer what you can verify. The rank updates live in the panel.
          </p>
          {scoringFactors.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              No scoring factors configured for this workflow yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {scoringFactors.map((f) =>
                f.kind === 'bool' ? (
                  <BoolRow
                    key={f.key}
                    factor={f}
                    workflowKey={workflow.key}
                    checked={inputs[f.key] === true}
                    onChange={(v) => setFactor(f.key, v)}
                  />
                ) : (
                  <NumberRow
                    key={f.key}
                    factor={f}
                    workflowKey={workflow.key}
                    value={typeof inputs[f.key] === 'number' ? (inputs[f.key] as number) : 0}
                    onChange={(v) => setFactor(f.key, v)}
                  />
                ),
              )}
            </div>
          )}
        </div>

        {/* Status + commit */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
            Your call
          </div>
          <StatusChooser
            value={status}
            onChange={(s) => {
              setStatus(s);
              setSavedAt(null);
            }}
          />

          {override && (
            <div
              role="region"
              aria-label="Override reason"
              style={{
                marginTop: '0.85rem',
                padding: '0.7rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--steel-dim)',
                border: '1px dashed var(--border-accent)',
              }}
            >
              <p style={{ fontSize: '0.76rem', color: 'var(--warn)', marginBottom: '0.45rem' }}>
                Your call disagrees with the pre-score band ({BAND_META[band].label}). Tell
                future-you why — at least {OVERRIDE_MIN_CHARS} characters.
              </p>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setSavedAt(null);
                }}
                rows={3}
                placeholder="What I saw that the numbers didn't catch."
                className="input"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
                  fontSize: '0.85rem',
                  lineHeight: 1.45,
                  resize: 'vertical',
                }}
                aria-label="Override reason"
              />
              <div
                style={{
                  marginTop: '0.35rem',
                  fontSize: '0.7rem',
                  color: reasonOk ? 'var(--text-faint)' : 'var(--warn)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>{reason.trim().length} chars</span>
                <span>{reasonOk ? '✓ enough' : `${OVERRIDE_MIN_CHARS - reason.trim().length} more`}</span>
              </div>
            </div>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className="btn-primary"
              disabled={!canSave}
              onClick={() => onSave()}
              style={{ justifyContent: 'center' }}
            >
              {busy ? 'Saving…' : isCreate ? 'Save & open' : 'Save'}
            </button>
            {!isCreate && prospectId && (
              <Link
                href={`/prospects/${prospectId}`}
                className="btn-ghost"
                style={{ padding: '0.4rem 0.6rem' }}
              >
                Open record →
              </Link>
            )}
            {savedAt && (
              <span style={{ fontSize: '0.74rem', color: 'var(--good)' }}>Saved.</span>
            )}
            {error && (
              <span style={{ fontSize: '0.74rem', color: 'var(--bad)' }}>{error}</span>
            )}
            {isCreate && !hasNameForCreate && (
              <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                Add a name to save.
              </span>
            )}
          </div>

          {/* D-057: duplicate warning panel — only fires on create. */}
          {pendingDuplicates.length > 0 && (
            <DuplicateWarning
              duplicates={pendingDuplicates}
              contactName={identity.contactName.trim()}
              onContinue={() => onSave(undefined, true)}
              onCancel={() => setPendingDuplicates([])}
              busy={busy}
            />
          )}
        </div>
      </div>

      {/* ─── Live score panel ────────────────────────────────────── */}
      <div className="qualify-score">
        <div
          className="surface-tool"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          <div className="eyebrow">{workflow.name} · rank</div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
            <span
              className="money"
              style={{ fontSize: '2.6rem', lineHeight: 1, color: BAND_META[band].color }}
            >
              {scored.score.toFixed(1)}
            </span>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-faint)' }}>/ 10</span>
          </div>

          <div>
            <span
              style={{
                display: 'inline-block',
                fontSize: '0.64rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: BAND_META[band].color,
                border: `1px solid ${BAND_META[band].color}`,
                borderRadius: 'var(--radius-sm)',
                padding: '0.22rem 0.55rem',
              }}
            >
              {BAND_META[band].label}
            </span>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: '0.5rem',
                lineHeight: 1.5,
              }}
            >
              {gateOpen
                ? band === 'borderline'
                  ? 'A judgment call — either Qualify or Reject works without a reason.'
                  : `Pre-score recommends ${band === 'qualified' ? 'Qualify' : 'Reject'}. Overrides need a reason.`
                : 'Clear every entry gate before this score is actionable.'}
            </p>
          </div>

          {/* D-042: one-click Qualify shortcut. Visible whenever the
              score is ≥ 7 (including the borderline band) AND every
              gate is clear AND the rep hasn't already qualified this
              row. The shortcut commits sourcing_status='qualify',
              which advances stage to 'qualified' via
              stageForSourcingStatus. The three-button toggle below
              stays available for explicit Pursue / Undecided /
              Reject choices. */}
          {gateOpen && scored.score >= 7 && status !== 'qualify' && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !hasNameForCreate}
              onClick={() => onSave('qualify')}
              style={{ justifyContent: 'center' }}
            >
              {busy ? 'Saving…' : 'Qualify this prospect'}
            </button>
          )}

          {!isCreate && (
            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: '0.7rem',
                fontSize: '0.74rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-mid)' }}>Server score (last saved)</span>
                <span className="money" style={{ color: 'var(--text)' }}>
                  {serverScore.toFixed(1)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-mid)' }}>Lifecycle stage</span>
                <span style={{ color: 'var(--text)' }}>{serverStage}</span>
              </div>
            </div>
          )}
        </div>

        <p
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-faint)',
            marginTop: '0.6rem',
            textAlign: 'center',
          }}
        >
          Stay Sharp. Stay Seen. Stay Human.
        </p>
      </div>
    </div>
  );
}

/* ── Identity section — editable inputs (create) or read-only card (edit) ── */

function IdentitySection({
  mode,
  workflow,
  identity,
  patchIdentity,
  prospectId,
}: {
  mode: 'edit' | 'display';
  workflow: QualifyFormWorkflow;
  identity: QualifyFormIdentity;
  patchIdentity: (patch: Partial<QualifyFormIdentity>) => void;
  prospectId: string | null;
}) {
  if (mode === 'display' && prospectId) {
    return (
      <div className="surface-tool">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.6rem',
            marginBottom: '0.25rem',
          }}
        >
          <div className="eyebrow">{workflow.contactNoun}</div>
          <Link
            href={`/prospects/${prospectId}`}
            style={{
              fontSize: '0.68rem',
              color: 'var(--text-faint)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            Full record →
          </Link>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            marginTop: '0.5rem',
          }}
        >
          <IdRow label={workflow.contactNoun} value={identity.contactName} />
          {workflow.orgNoun && (
            <IdRow label={workflow.orgNoun} value={identity.orgName ?? '—'} />
          )}
          <IdRow label="Market" value={identity.marketArea ?? '—'} />
          {identity.grossVolume !== null && (
            <IdRow
              label="Gross volume"
              value={`$${identity.grossVolume.toLocaleString('en-US')}`}
            />
          )}
          {identity.sourceUrl && (
            <IdRow
              label="Source"
              value={
                <a
                  href={identity.sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  style={{ color: 'var(--accent)' }}
                >
                  {identity.sourceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              }
            />
          )}
        </div>
        <p
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-faint)',
            marginTop: '0.85rem',
          }}
        >
          Identity edits live on the full record (above).
        </p>
      </div>
    );
  }

  // Edit mode — create form
  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
        The {workflow.contactNoun.toLowerCase()}
      </div>
      <p
        style={{
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          marginBottom: '0.9rem',
        }}
      >
        Name is required. Fill in the rest as you find it — you can finish the
        record on the client page later.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <Field label={`${workflow.contactNoun} name`}>
          <input
            className="input"
            value={identity.contactName}
            onChange={(e) => patchIdentity({ contactName: e.target.value })}
            placeholder="Jordan Avery"
          />
        </Field>
        {workflow.orgNoun && (
          <Field label={workflow.orgNoun}>
            <input
              className="input"
              value={identity.orgName ?? ''}
              onChange={(e) =>
                patchIdentity({ orgName: e.target.value === '' ? null : e.target.value })
              }
            />
          </Field>
        )}
        <Field label="Market area">
          <input
            className="input"
            value={identity.marketArea ?? ''}
            onChange={(e) =>
              patchIdentity({ marketArea: e.target.value === '' ? null : e.target.value })
            }
            placeholder="Frisco / Prosper"
          />
        </Field>
        <Field label="Source URL (optional)">
          <input
            className="input"
            type="url"
            value={identity.sourceUrl ?? ''}
            onChange={(e) =>
              patchIdentity({ sourceUrl: e.target.value === '' ? null : e.target.value })
            }
            placeholder="https://…"
          />
        </Field>
      </div>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
      <span
        style={{
          fontSize: '0.66rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          minWidth: '5.5rem',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '0.86rem', color: 'var(--text)' }}>{value}</span>
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

/* ── Bool + number factor rows ───────────────────────────────────── */

function BoolRow({
  factor,
  workflowKey,
  checked,
  onChange,
  highlight,
}: {
  factor: RankFactor;
  workflowKey: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  highlight?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.7rem',
        padding: '0.55rem 0.65rem',
        borderRadius: 'var(--radius-sm)',
        background: checked ? 'var(--accent-dim)' : 'transparent',
        border: `1px solid ${checked ? 'var(--border-accent)' : 'var(--border)'}`,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 16,
          height: 16,
          accentColor: 'var(--accent)',
          flexShrink: 0,
          marginTop: '0.1rem',
          cursor: 'pointer',
        }}
        aria-label={factor.label}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.83rem',
            color: 'var(--text)',
            fontWeight: highlight ? 600 : 400,
          }}
        >
          {factor.label}
          <span style={{ color: 'var(--text-faint)' }}> · {factor.weight} pts</span>
        </div>
        {factor.helpText && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {factor.helpText}
          </div>
        )}
        <div style={{ marginTop: '0.2rem' }}>
          <HelpBox workflowKey={workflowKey} factorKey={factor.key} />
        </div>
      </div>
    </label>
  );
}

function NumberRow({
  factor,
  workflowKey,
  value,
  onChange,
}: {
  factor: RankFactor;
  workflowKey: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const active = value > 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.7rem',
        padding: '0.55rem 0.65rem',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--accent-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--border-accent)' : 'var(--border)'}`,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.83rem', color: 'var(--text)' }}>
          {factor.label}
          <span style={{ color: 'var(--text-faint)' }}> · {factor.weight} pts</span>
        </div>
        {factor.helpText && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {factor.helpText}
          </div>
        )}
        <div style={{ marginTop: '0.2rem' }}>
          <HelpBox workflowKey={workflowKey} factorKey={factor.key} />
        </div>
      </div>
      <input
        type="number"
        min={0}
        value={value === 0 ? '' : value}
        onChange={(e) =>
          onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))
        }
        className="input"
        style={{ width: 72, padding: '0.35rem 0.4rem', textAlign: 'center', flexShrink: 0 }}
        aria-label={factor.label}
      />
    </div>
  );
}

/* ── Status chooser ────────────────────────────────────────────────── */

function StatusChooser({
  value,
  onChange,
}: {
  value: SourcingStatus;
  onChange: (next: SourcingStatus) => void;
}) {
  const opts: SourcingStatus[] = ['qualify', 'undecided', 'reject'];
  return (
    <div role="group" aria-label="Status" style={{ display: 'flex', gap: '0.5rem' }}>
      {opts.map((opt) => {
        const active = opt === value;
        const color =
          opt === 'qualify'
            ? 'var(--good)'
            : opt === 'reject'
              ? 'var(--bad)'
              : 'var(--text-faint)';
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '0.5rem 0.95rem',
              border: `1px solid ${active ? color : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              background: active ? `${color}22` : 'transparent',
              color: active ? color : 'var(--text-mid)',
              cursor: 'pointer',
            }}
          >
            {STATUS_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}
