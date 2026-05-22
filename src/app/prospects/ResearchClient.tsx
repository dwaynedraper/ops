'use client';

/**
 * The research surface — interactive.
 *
 * A rep enters an agent, clears the two entry gates, and answers the
 * rank factors; the score panel re-rates 0–10 live on every change.
 * "Add" sends the answers (never the score) to createProspect, which
 * recomputes server-side and persists.
 *
 * Scoring math is imported from src/lib/prospects.ts so this component
 * and the server agree to the decimal.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  scoreProspect,
  classifyBand,
  type RankFactor,
  type RankBands,
  type RankInputs,
  type ScoreBand,
  type CreateProspectInput,
  type CreateProspectResult,
} from '@/lib/prospects';
import { createProspect } from './actions';

interface Identity {
  agentName: string;
  agency: string;
  email: string;
  phone: string;
  websiteUrl: string;
  socialUrl: string;
  marketArea: string;
}

const EMPTY_IDENTITY: Identity = {
  agentName: '',
  agency: '',
  email: '',
  phone: '',
  websiteUrl: '',
  socialUrl: '',
  marketArea: '',
};

const BAND_META: Record<ScoreBand, { label: string; color: string; note: string }> = {
  qualified: {
    label: 'Qualified',
    color: 'var(--good)',
    note: 'Strong candidate. Work this one — start the contact cycle.',
  },
  borderline: {
    label: 'Borderline',
    color: 'var(--warn)',
    note: 'A judgment call. Add it and revisit, or keep researching.',
  },
  reject: {
    label: "Don't message",
    color: 'var(--bad)',
    note: 'Below threshold. Logging it keeps it off the re-research pile.',
  },
};

function initialInputs(factors: RankFactor[]): RankInputs {
  const out: RankInputs = {};
  for (const f of factors) out[f.key] = f.kind === 'bool' ? false : 0;
  return out;
}

export function ResearchClient({
  factors,
  bands,
  qualifiedCount,
}: {
  factors: RankFactor[];
  bands: RankBands;
  qualifiedCount: number;
}) {
  const router = useRouter();

  const [identity, setIdentity] = useState<Identity>(EMPTY_IDENTITY);
  const [hasTargetListing, setHasTargetListing] = useState(true);
  const [hasPhotoNeed, setHasPhotoNeed] = useState(true);
  const [inputs, setInputs] = useState<RankInputs>(() => initialInputs(factors));

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateProspectResult | null>(null);

  // ─── Live score ───────────────────────────────────────────────────────
  const scored = useMemo(() => scoreProspect(factors, inputs), [factors, inputs]);
  const band = classifyBand(scored.score, bands);
  const labelByKey = useMemo(
    () => new Map(factors.map((f) => [f.key, f.label])),
    [factors],
  );

  const gateOpen = hasTargetListing && hasPhotoNeed;
  const hasName = identity.agentName.trim().length > 0;
  const canSubmit = gateOpen && hasName && !submitting;

  function patchIdentity(patch: Partial<Identity>) {
    setIdentity((prev) => ({ ...prev, ...patch }));
    setResult(null);
  }

  function setFactor(key: string, value: boolean | number) {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  }

  function reset() {
    setIdentity(EMPTY_IDENTITY);
    setHasTargetListing(true);
    setHasPhotoNeed(true);
    setInputs(initialInputs(factors));
    setResult(null);
  }

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    const payload: CreateProspectInput = {
      agentName: identity.agentName,
      agency: identity.agency,
      email: identity.email,
      phone: identity.phone,
      websiteUrl: identity.websiteUrl,
      socialUrl: identity.socialUrl,
      marketArea: identity.marketArea,
      hasTargetListing,
      hasPhotoNeed,
      rankInputs: inputs,
    };
    try {
      const res = await createProspect(payload);
      setResult(res);
      // Refresh the server-rendered prospect list below the tool.
      if (res.ok) router.refresh();
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Could not save the prospect.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Button label + style follow the band — a reject is logged, not "added".
  let buttonLabel: string;
  if (!gateOpen) buttonLabel = 'Entry gate not cleared';
  else if (submitting) buttonLabel = 'Saving…';
  else if (band === 'qualified') buttonLabel = 'Add qualified prospect';
  else if (band === 'borderline') buttonLabel = 'Add borderline prospect';
  else buttonLabel = 'Log as passed';

  return (
    <div className="research-layout">
      {/* ─── Form ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Agent identity */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
            The agent
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            Name is required. Fill in the rest as you find it — you can finish the
            record on their client page later.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <Field label="Agent name">
              <input
                className="input"
                value={identity.agentName}
                onChange={(e) => patchIdentity({ agentName: e.target.value })}
                placeholder="Jordan Avery"
              />
            </Field>
            <Field label="Agency">
              <input
                className="input"
                value={identity.agency}
                onChange={(e) => patchIdentity({ agency: e.target.value })}
                placeholder="Avery & Co. Realty"
              />
            </Field>
            <Field label="Market area">
              <input
                className="input"
                value={identity.marketArea}
                onChange={(e) => patchIdentity({ marketArea: e.target.value })}
                placeholder="Frisco / Prosper"
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={identity.email}
                onChange={(e) => patchIdentity({ email: e.target.value })}
                placeholder="jordan@averyco.com"
              />
            </Field>
            <Field label="Phone">
              <input
                className="input"
                value={identity.phone}
                onChange={(e) => patchIdentity({ phone: e.target.value })}
                placeholder="(214) 555-0100"
              />
            </Field>
            <Field label="Website">
              <input
                className="input"
                value={identity.websiteUrl}
                onChange={(e) => patchIdentity({ websiteUrl: e.target.value })}
                placeholder="averyco.com"
              />
            </Field>
            <Field label="Social profile">
              <input
                className="input"
                value={identity.socialUrl}
                onChange={(e) => patchIdentity({ socialUrl: e.target.value })}
                placeholder="instagram.com/jordanavery"
              />
            </Field>
          </div>
        </div>

        {/* Entry gate */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
            Entry gate
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            Both have to be true for this agent to be a prospect at all. If either
            is off, there&apos;s nothing to sell yet — move on.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <GateToggle
              checked={hasTargetListing}
              onChange={(v) => {
                setHasTargetListing(v);
                setResult(null);
              }}
              label="Has a current target listing"
              help="A live listing in the $500K–$2M range worth shooting now."
            />
            <GateToggle
              checked={hasPhotoNeed}
              onChange={(v) => {
                setHasPhotoNeed(v);
                setResult(null);
              }}
              label="Has a visible photo need"
              help="Their current media is weak, missing, or off-brand — a real gap."
            />
          </div>
          {!gateOpen && (
            <p style={{ fontSize: '0.76rem', color: 'var(--warn)', marginTop: '0.75rem' }}>
              Gate not cleared — this agent can&apos;t enter the pipeline yet.
            </p>
          )}
        </div>

        {/* Scoring */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
            Score the fit
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            Answer what you can verify. The rank updates live in the panel.
          </p>
          {factors.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              No rank factors configured yet — seed the CRM config to score prospects.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {factors.map((f) =>
                f.kind === 'bool' ? (
                  <BoolFactor
                    key={f.key}
                    factor={f}
                    checked={inputs[f.key] === true}
                    onChange={(v) => setFactor(f.key, v)}
                  />
                ) : (
                  <NumberFactor
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
      </div>

      {/* ─── Live score panel ──────────────────────────────────────────── */}
      <div className="research-score">
        <div
          className="surface-tool"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          <div className="eyebrow">Rank</div>

          {/* Score */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
            <span
              className="money"
              style={{ fontSize: '2.6rem', lineHeight: 1, color: BAND_META[band].color }}
            >
              {scored.score.toFixed(1)}
            </span>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-faint)' }}>/ 10</span>
          </div>

          {/* Band */}
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
                ? BAND_META[band].note
                : 'Clear both entry gates before this score means anything.'}
            </p>
          </div>

          {/* Breakdown */}
          {scored.factors.length > 0 && (
            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: '0.7rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
              {scored.factors.map((fs) => {
                const filled = fs.weight > 0 ? fs.earned / fs.weight : 0;
                return (
                  <div
                    key={fs.key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.6rem',
                      fontSize: '0.74rem',
                    }}
                  >
                    <span
                      style={{
                        color: filled > 0 ? 'var(--text-mid)' : 'var(--text-faint)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {labelByKey.get(fs.key) ?? fs.key}
                    </span>
                    <span
                      className="money"
                      style={{
                        color: filled > 0 ? 'var(--text)' : 'var(--text-faint)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fs.earned.toFixed(1)} / {fs.weight}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Qualified progress */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: '0.7rem',
              fontSize: '0.74rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-mid)' }}>Qualified pipeline</span>
              <span className="money" style={{ color: 'var(--text)' }}>
                {qualifiedCount} / {bands.targetCount}
              </span>
            </div>
            <p style={{ color: 'var(--text-faint)', marginTop: '0.35rem', lineHeight: 1.5 }}>
              {qualifiedCount >= bands.targetCount
                ? 'Target hit — time to start the contact cycle.'
                : `${bands.targetCount - qualifiedCount} more to hit the contact target.`}
            </p>
          </div>

          {/* Action / result */}
          {result?.ok ? (
            <div
              style={{
                background: 'var(--steel-dim)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: 'var(--text)' }}>{result.agentName}</strong> saved —
              scored {result.score?.toFixed(1)}, stage{' '}
              <strong style={{ color: 'var(--text)' }}>{result.stage}</strong>.
              <button
                onClick={reset}
                className="btn-ghost"
                style={{ marginTop: '0.5rem', padding: '0.3rem 0' }}
              >
                Research another
              </button>
            </div>
          ) : (
            <>
              <button
                className={band === 'reject' ? 'btn-outline' : 'btn-primary'}
                style={{ justifyContent: 'center', width: '100%' }}
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                {buttonLabel}
              </button>
              {!hasName && gateOpen && (
                <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                  Add the agent&apos;s name to save.
                </p>
              )}
              {result && !result.ok && (
                <p style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{result.error}</p>
              )}
            </>
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

// ─── Small pieces ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function GateToggle({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.7rem',
        padding: '0.6rem 0.7rem',
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
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.83rem', color: 'var(--text)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
          {help}
        </div>
      </div>
    </label>
  );
}

function BoolFactor({
  factor,
  checked,
  onChange,
}: {
  factor: RankFactor;
  checked: boolean;
  onChange: (v: boolean) => void;
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
        <div style={{ fontSize: '0.82rem', color: 'var(--text)' }}>
          {factor.label}
          <span style={{ color: 'var(--text-faint)' }}> · {factor.weight} pts</span>
        </div>
        {factor.helpText && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {factor.helpText}
          </div>
        )}
      </div>
    </label>
  );
}

function NumberFactor({
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
        <div style={{ fontSize: '0.82rem', color: 'var(--text)' }}>
          {factor.label}
          <span style={{ color: 'var(--text-faint)' }}> · {factor.weight} pts</span>
        </div>
        {factor.helpText && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {factor.helpText}
          </div>
        )}
        {factor.maxInput !== null && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: '0.15rem' }}>
            Full credit at {factor.maxInput}+
          </div>
        )}
      </div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="input"
        style={{ width: 64, padding: '0.35rem 0.4rem', textAlign: 'center', flexShrink: 0 }}
        aria-label={factor.label}
      />
    </div>
  );
}
