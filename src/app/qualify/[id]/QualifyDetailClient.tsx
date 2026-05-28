'use client';

/**
 * Per-prospect Qualify — the deep editor for one prospect's rank
 * inputs. Lives at /qualify/[id]. Pre-fills from whatever the rep
 * already entered on Sourcing.
 *
 * Live score panel uses the same `scoreProspect` math as Sourcing and
 * the entry-form QualifyClient. Saving routes through
 * `upsertSourcingRow` (the same server action Sourcing uses) so the
 * two surfaces stay in sync — same recompute, same lifecycle stage
 * rules, same ownership check.
 *
 * Override-with-reason mirrors the inline expansion design from the
 * Sourcing redesign: when the chosen sourcing_status disagrees with
 * the pre-score band, a ≥20-char reason is required. The reason
 * lives in `prospects.sourcing_note`.
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
import type { SourcingStatus } from '@/lib/sourcing';
import { upsertSourcingRow } from '@/app/sourcing/actions';

export interface QualifyDetailWorkflow {
  key: string;
  name: string;
  accent: string;
  contactNoun: string;
  orgNoun: string | null;
  factors: RankFactor[];
  bands: RankBands;
}

const OVERRIDE_MIN_CHARS = 20;

const STATUS_LABEL: Record<SourcingStatus, string> = {
  qualify: 'Qualify',
  pass: 'Pass',
  undecided: 'Undecided',
};

const BAND_META: Record<ScoreBand, { label: string; color: string }> = {
  qualified: { label: 'Qualified', color: 'var(--good)' },
  borderline: { label: 'Borderline', color: 'var(--warn)' },
  reject: { label: 'Below the bar', color: 'var(--bad)' },
};

/** The status the pre-score band recommends. `borderline` makes no
 * recommendation; the rep can pick either side without an override
 * reason. */
function recommendedStatus(band: ScoreBand): SourcingStatus | null {
  if (band === 'qualified') return 'qualify';
  if (band === 'reject') return 'pass';
  return null;
}

function needsOverride(status: SourcingStatus, band: ScoreBand): boolean {
  const rec = recommendedStatus(band);
  if (rec === null) return false;
  if (status === 'undecided') return false; // parking, not contradicting
  return status !== rec;
}

export function QualifyDetailClient({
  prospectId,
  workflow,
  identity,
  initialInputs,
  initialScore,
  initialStage,
  initialSourcingStatus,
  initialSourcingNote,
}: {
  prospectId: string;
  workflow: QualifyDetailWorkflow;
  identity: {
    contactName: string;
    orgName: string | null;
    marketArea: string | null;
    grossVolume: number | null;
    sourceUrl: string | null;
  };
  initialInputs: RankInputs;
  initialScore: number;
  initialStage: ProspectStage;
  initialSourcingStatus: SourcingStatus;
  initialSourcingNote: string | null;
}) {
  const router = useRouter();

  const [inputs, setInputs] = useState<RankInputs>(() => {
    // Make sure every factor key has a value so the controlled inputs
    // never warn about uncontrolled-to-controlled flips.
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

  // Live score from the local draft — mirrors the entry-form pattern.
  const scored = scoreProspect(workflow.factors, inputs);
  const band = classifyBand(scored.score, workflow.bands);
  const gateOpen = gatesPassed(workflow.factors, inputs);

  const gateFactors = workflow.factors.filter((f) => f.isGate);
  const scoringFactors = workflow.factors.filter((f) => !f.isGate);

  const override = needsOverride(status, band);
  const reasonOk = !override || reason.trim().length >= OVERRIDE_MIN_CHARS;
  const canSave = !busy && reasonOk;

  function setFactor(key: string, value: boolean | number) {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function onSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await upsertSourcingRow({
        id: prospectId,
        rankInputPatches: inputs,
        sourcingStatus: status,
        // When status agrees with the band, clear the reason — it
        // only carries weight when overriding.
        sourcingNote: override ? reason.trim() : null,
      });
      if (!res.ok || !res.row) {
        setError(res.error ?? 'Could not save.');
        return;
      }
      setServerScore(res.row.rankScore);
      setServerStage(res.row.stage);
      setSavedAt(Date.now());
      router.refresh();
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
        {/* Identity (read-only display) */}
        <IdentityCard workflow={workflow} identity={identity} prospectId={prospectId} />

        {/* Entry gate */}
        {gateFactors.length > 0 && (
          <div className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
              Entry gate
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
              Both gates have to be true for this {workflow.contactNoun.toLowerCase()} to
              enter the pipeline. They also each add 1.0 to the score.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {gateFactors.map((f) => (
                <BoolRow
                  key={f.key}
                  factor={f}
                  checked={inputs[f.key] === true}
                  onChange={(v) => setFactor(f.key, v)}
                  highlight
                />
              ))}
            </div>
            {!gateOpen && (
              <p style={{ fontSize: '0.76rem', color: 'var(--warn)', marginTop: '0.75rem' }}>
                Gate not cleared — this {workflow.contactNoun.toLowerCase()} can&apos;t
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
                    checked={inputs[f.key] === true}
                    onChange={(v) => setFactor(f.key, v)}
                  />
                ) : (
                  <NumberRow
                    key={f.key}
                    factor={f}
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
          <StatusChooser value={status} onChange={(s) => { setStatus(s); setSavedAt(null); }} />

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
                onChange={(e) => { setReason(e.target.value); setSavedAt(null); }}
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
              onClick={onSave}
              style={{ justifyContent: 'center' }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <Link
              href={`/prospects/${prospectId}`}
              className="btn-ghost"
              style={{ padding: '0.4rem 0.6rem' }}
            >
              Open record →
            </Link>
            {savedAt && (
              <span style={{ fontSize: '0.74rem', color: 'var(--good)' }}>
                Saved.
              </span>
            )}
            {error && (
              <span style={{ fontSize: '0.74rem', color: 'var(--bad)' }}>{error}</span>
            )}
          </div>
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
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
              {gateOpen
                ? recommendedStatus(band) === null
                  ? 'A judgment call — either Qualify or Pass works without a reason.'
                  : `Pre-score recommends ${STATUS_LABEL[recommendedStatus(band)!]}. Overrides need a reason.`
                : 'Clear every entry gate before this score is actionable.'}
            </p>
          </div>

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
              <span className="money" style={{ color: 'var(--text)' }}>{serverScore.toFixed(1)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-mid)' }}>Lifecycle stage</span>
              <span style={{ color: 'var(--text)' }}>{serverStage}</span>
            </div>
          </div>
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

/* ── Identity card ──────────────────────────────────────────────── */

function IdentityCard({
  workflow,
  identity,
  prospectId,
}: {
  workflow: QualifyDetailWorkflow;
  identity: {
    contactName: string;
    orgName: string | null;
    marketArea: string | null;
    grossVolume: number | null;
    sourceUrl: string | null;
  };
  prospectId: string;
}) {
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem' }}>
        <IdRow label={workflow.contactNoun} value={identity.contactName} />
        {workflow.orgNoun && <IdRow label={workflow.orgNoun} value={identity.orgName ?? '—'} />}
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

/* ── Bool + number factor rows (matches QualifyClient styling) ────── */

function BoolRow({
  factor,
  checked,
  onChange,
  highlight,
}: {
  factor: RankFactor;
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
        background: checked
          ? highlight
            ? 'var(--accent-dim)'
            : 'var(--accent-dim)'
          : 'transparent',
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
        <div style={{ fontSize: '0.83rem', color: 'var(--text)', fontWeight: highlight ? 600 : 400 }}>
          {factor.label}
          <span style={{ color: 'var(--text-faint)' }}> · {factor.weight} pts</span>
        </div>
        {factor.helpText && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {factor.helpText}
          </div>
        )}
      </div>
    </label>
  );
}

function NumberRow({
  factor,
  value,
  onChange,
}: {
  factor: RankFactor;
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
  const opts: SourcingStatus[] = ['qualify', 'undecided', 'pass'];
  return (
    <div role="group" aria-label="Status" style={{ display: 'flex', gap: '0.5rem' }}>
      {opts.map((opt) => {
        const active = opt === value;
        const color =
          opt === 'qualify'
            ? 'var(--good)'
            : opt === 'pass'
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
