'use client';

/**
 * The qualify surface — interactive, multi-workflow.
 *
 * A rep picks the workflow they're qualifying for; the entry gate,
 * scoring factors, and identity labels all adapt to it. The score panel
 * re-rates live. "Add" sends the answers + the workflow to createProspect,
 * which recomputes server-side and persists.
 *
 * Renamed from ResearchClient in Phase E (D-023). Component shape and
 * behavior unchanged; the deeper per-prospect detail page is still at
 * /prospects/[id] (Option B), so the list-row click-throughs stay
 * pointing there.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  scoreProspect,
  classifyBand,
  gatesPassed,
  type RankFactor,
  type RankBands,
  type RankInputs,
  type ScoreBand,
  type ProspectStage,
  type ProspectListItem,
  type CreateProspectInput,
  type CreateProspectResult,
} from '@/lib/prospects';
import { HelpBox } from '@/components/HelpBox';
import { createProspect } from './actions';

export interface QualifyWorkflow {
  key: string;
  name: string;
  branch: 'portraits' | 'realestate' | 'corporate' | null;
  contactNoun: string;
  orgNoun: string | null;
  accent: string;
  factors: RankFactor[];
  bands: RankBands;
  qualifiedCount: number;
}

interface Identity {
  contactName: string;
  orgName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  socialUrl: string;
  marketArea: string;
}

const EMPTY_IDENTITY: Identity = {
  contactName: '',
  orgName: '',
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
    note: 'Strong fit. Work this one — it earns a place in the pipeline.',
  },
  borderline: {
    label: 'Borderline',
    color: 'var(--warn)',
    note: 'A judgment call. Add it and revisit, or keep qualifying.',
  },
  reject: {
    label: 'Below the bar',
    color: 'var(--bad)',
    note: 'Under threshold. Logging it keeps it off the re-qualify pile.',
  },
};

type StageTone = 'good' | 'warn' | 'accent' | 'cyan' | 'muted';
const STAGE_META: Record<ProspectStage, { label: string; tone: StageTone }> = {
  researching: { label: 'Researching', tone: 'muted' },
  qualified: { label: 'Qualified', tone: 'good' },
  contacting: { label: 'Contacting', tone: 'accent' },
  responded: { label: 'Responded', tone: 'warn' },
  signed: { label: 'Signed', tone: 'good' },
  client: { label: 'Client', tone: 'cyan' },
  passed: { label: 'Passed', tone: 'muted' },
  dormant: { label: 'Dormant', tone: 'muted' },
};
const TONE_COLOR: Record<StageTone, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
  cyan: 'var(--brand-cyan)',
  muted: 'var(--text-faint)',
};

function initialInputs(factors: RankFactor[]): RankInputs {
  const out: RankInputs = {};
  for (const f of factors) out[f.key] = f.kind === 'bool' ? false : 0;
  return out;
}

export function QualifyClient({
  workflows,
  prospects,
}: {
  workflows: QualifyWorkflow[];
  prospects: ProspectListItem[];
}) {
  const router = useRouter();

  const [selectedKey, setSelectedKey] = useState(workflows[0]?.key ?? '');
  const [identity, setIdentity] = useState<Identity>(EMPTY_IDENTITY);
  const [inputs, setInputs] = useState<RankInputs>(() =>
    workflows[0] ? initialInputs(workflows[0].factors) : {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateProspectResult | null>(null);

  const wf = workflows.find((w) => w.key === selectedKey) ?? workflows[0] ?? null;

  if (!wf) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No workflows configured yet — seed the database to start qualifying.
        </p>
      </div>
    );
  }

  const gateFactors = wf.factors.filter((f) => f.isGate);
  const scoringFactors = wf.factors.filter((f) => !f.isGate);

  // D-032: gates contribute to the score too. `scoringFactors` above
  // is kept only for rendering the "score the fit" panel; the actual
  // score sees every factor.
  const scored = scoreProspect(wf.factors, inputs);
  const band = classifyBand(scored.score, wf.bands);
  const gateOpen = gatesPassed(wf.factors, inputs);
  const hasName = identity.contactName.trim().length > 0;
  const canSubmit = gateOpen && hasName && !submitting;

  const myProspects = prospects.filter((p) => p.workflowKey === wf.key);

  function selectWorkflow(key: string) {
    const next = workflows.find((w) => w.key === key);
    if (!next) return;
    setSelectedKey(key);
    setIdentity(EMPTY_IDENTITY);
    setInputs(initialInputs(next.factors));
    setResult(null);
  }

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
    setInputs(initialInputs(wf!.factors));
    setResult(null);
  }

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    const payload: CreateProspectInput = {
      workflowKey: wf!.key,
      contactName: identity.contactName,
      orgName: identity.orgName,
      email: identity.email,
      phone: identity.phone,
      websiteUrl: identity.websiteUrl,
      socialUrl: identity.socialUrl,
      marketArea: identity.marketArea,
      rankInputs: inputs,
    };
    try {
      const res = await createProspect(payload);
      setResult(res);
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

  let buttonLabel: string;
  if (!gateOpen) buttonLabel = 'Entry gate not cleared';
  else if (submitting) buttonLabel = 'Saving…';
  else if (band === 'qualified') buttonLabel = 'Add qualified prospect';
  else if (band === 'borderline') buttonLabel = 'Add borderline prospect';
  else buttonLabel = 'Log as below-bar';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ─── Workflow picker ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {workflows.map((w) => {
          const active = w.key === wf.key;
          return (
            <button
              key={w.key}
              onClick={() => selectWorkflow(w.key)}
              style={{
                padding: '0.5rem 0.95rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${active ? w.accent : 'var(--border-strong)'}`,
                background: active ? `${w.accent}22` : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-mid)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s, color 0.15s',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: w.accent,
                  marginRight: '0.45rem',
                }}
              />
              {w.name}
            </button>
          );
        })}
      </div>

      <div className="qualify-layout">
        {/* ─── Form ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Identity */}
          <div className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
              The {wf.contactNoun.toLowerCase()}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
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
              <Field label={`${wf.contactNoun} name`}>
                <input
                  className="input"
                  value={identity.contactName}
                  onChange={(e) => patchIdentity({ contactName: e.target.value })}
                  placeholder="Jordan Avery"
                />
              </Field>
              {wf.orgNoun && (
                <Field label={wf.orgNoun}>
                  <input
                    className="input"
                    value={identity.orgName}
                    onChange={(e) => patchIdentity({ orgName: e.target.value })}
                  />
                </Field>
              )}
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
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input"
                  value={identity.phone}
                  onChange={(e) => patchIdentity({ phone: e.target.value })}
                />
              </Field>
              <Field label="Website">
                <input
                  className="input"
                  value={identity.websiteUrl}
                  onChange={(e) => patchIdentity({ websiteUrl: e.target.value })}
                />
              </Field>
              <Field label="Social profile">
                <input
                  className="input"
                  value={identity.socialUrl}
                  onChange={(e) => patchIdentity({ socialUrl: e.target.value })}
                />
              </Field>
            </div>
          </div>

          {/* Entry gate */}
          {gateFactors.length > 0 && (
            <div className="surface-tool">
              <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
                Entry gate
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
                Every gate has to be true for this {wf.contactNoun.toLowerCase()} to be a
                prospect at all. If one is off, there&apos;s nothing to work yet.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {gateFactors.map((f) => (
                  <GateToggle
                    key={f.key}
                    factor={f}
                    workflowKey={wf.key}
                    checked={inputs[f.key] === true}
                    onChange={(v) => setFactor(f.key, v)}
                  />
                ))}
              </div>
              {!gateOpen && (
                <p style={{ fontSize: '0.76rem', color: 'var(--warn)', marginTop: '0.75rem' }}>
                  Gate not cleared — this {wf.contactNoun.toLowerCase()} can&apos;t enter the
                  pipeline yet.
                </p>
              )}
            </div>
          )}

          {/* Scoring */}
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
                    <BoolFactor
                      key={f.key}
                      factor={f}
                      workflowKey={wf.key}
                      checked={inputs[f.key] === true}
                      onChange={(v) => setFactor(f.key, v)}
                    />
                  ) : (
                    <NumberFactor
                      key={f.key}
                      factor={f}
                      workflowKey={wf.key}
                      value={typeof inputs[f.key] === 'number' ? (inputs[f.key] as number) : 0}
                      onChange={(v) => setFactor(f.key, v)}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Live score panel ────────────────────────────────────────── */}
        <div className="qualify-score">
          <div
            className="surface-tool"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
          >
            <div className="eyebrow">{wf.name} · rank</div>

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
                  ? BAND_META[band].note
                  : 'Clear every entry gate before this score means anything.'}
              </p>
            </div>

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
                  const label = scoringFactors.find((f) => f.key === fs.key)?.label ?? fs.key;
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
                        {label}
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
                  {wf.qualifiedCount} / {wf.bands.targetCount}
                </span>
              </div>
              <p style={{ color: 'var(--text-faint)', marginTop: '0.35rem', lineHeight: 1.5 }}>
                {wf.qualifiedCount >= wf.bands.targetCount
                  ? 'Target hit — time to start the contact cycle.'
                  : `${wf.bands.targetCount - wf.qualifiedCount} more to hit the contact target.`}
              </p>
            </div>

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
                <strong style={{ color: 'var(--text)' }}>{result.contactName}</strong> saved —
                scored {result.score?.toFixed(1)}, stage{' '}
                <strong style={{ color: 'var(--text)' }}>{result.stage}</strong>.
                <button
                  onClick={reset}
                  className="btn-ghost"
                  style={{ marginTop: '0.5rem', padding: '0.3rem 0' }}
                >
                  Qualify another
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
                    Add a name to save.
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

      {/* ─── This workflow's prospects ───────────────────────────────────── */}
      <section>
        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
          Your {wf.name} prospects
        </div>
        {myProspects.length === 0 ? (
          <div className="surface-card">
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
              No prospects in this workflow yet — qualify one above.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {myProspects.map((p) => {
              const stage = STAGE_META[p.stage];
              const pBand = classifyBand(p.rankScore, wf.bands);
              const scoreColor =
                pBand === 'qualified'
                  ? 'var(--good)'
                  : pBand === 'borderline'
                    ? 'var(--warn)'
                    : 'var(--text-faint)';
              return (
                <Link
                  key={p.id}
                  href={`/prospects/${p.id}`}
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
                    style={{
                      fontSize: '1.15rem',
                      color: scoreColor,
                      minWidth: '2.4rem',
                      textAlign: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {p.rankScore.toFixed(1)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.contactName}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {[p.orgName, p.marketArea].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: TONE_COLOR[stage.tone],
                      border: `1px solid ${TONE_COLOR[stage.tone]}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.2rem 0.5rem',
                      flexShrink: 0,
                    }}
                  >
                    {stage.label}
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-faint)',
                      minWidth: '3.2rem',
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {p.createdAt}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
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
  factor,
  workflowKey,
  checked,
  onChange,
}: {
  factor: RankFactor;
  workflowKey: string;
  checked: boolean;
  onChange: (v: boolean) => void;
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
        <div style={{ fontSize: '0.83rem', color: 'var(--text)', fontWeight: 600 }}>
          {factor.label}
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

function BoolFactor({
  factor,
  workflowKey,
  checked,
  onChange,
}: {
  factor: RankFactor;
  workflowKey: string;
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
        <div style={{ marginTop: '0.2rem' }}>
          <HelpBox workflowKey={workflowKey} factorKey={factor.key} />
        </div>
      </div>
    </label>
  );
}

function NumberFactor({
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
        <div style={{ marginTop: '0.2rem' }}>
          <HelpBox workflowKey={workflowKey} factorKey={factor.key} />
        </div>
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
