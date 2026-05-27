'use client';

/**
 * Rank-factor editor — interactive, per workflow.
 *
 * Pick a workflow, then edit its rank factors and thresholds as a local
 * draft (D-012). A factor can be marked a gate — an entry-gate question
 * that must answer yes; gates are always yes/no. DraftGuard catches an
 * attempt to leave the page with unpublished changes; switching workflow
 * is blocked while a draft is dirty so nothing is lost.
 *
 * Existing factors can be deactivated but not removed — a key may be
 * referenced in a prospect's saved answers. Factors added in this draft
 * can be removed outright.
 */

import { useMemo, useState } from 'react';
import { DraftGuard } from '@/components/DraftGuard';
import type { RankFactorKind } from '@/lib/prospects';
import { publishRankConfig, type RankFactorInput } from './actions';

export interface FactorInit {
  key: string;
  label: string;
  helpText: string;
  kind: RankFactorKind;
  weight: number;
  maxInput: number | null;
  isGate: boolean;
  active: boolean;
}

export interface ThresholdsInit {
  qualifiedMin: number;
  borderlineMin: number;
  targetCount: number;
}

export interface WorkflowConfig {
  key: string;
  name: string;
  accent: string;
  factors: FactorInit[];
  thresholds: ThresholdsInit;
}

interface FactorDraft {
  localId: string;
  key: string;
  isNew: boolean;
  label: string;
  helpText: string;
  kind: RankFactorKind;
  weight: string;
  maxInput: string;
  isGate: boolean;
  active: boolean;
}

interface Thresholds {
  qualifiedMin: string;
  borderlineMin: string;
  targetCount: string;
}

function newId(): string {
  return `f-${Math.random().toString(36).slice(2)}`;
}

function toDraft(f: FactorInit): FactorDraft {
  return {
    localId: newId(),
    key: f.key,
    isNew: false,
    label: f.label,
    helpText: f.helpText,
    kind: f.kind,
    weight: String(f.weight),
    maxInput: f.maxInput === null ? '' : String(f.maxInput),
    isGate: f.isGate,
    active: f.active,
  };
}

function toThresholds(t: ThresholdsInit): Thresholds {
  return {
    qualifiedMin: String(t.qualifiedMin),
    borderlineMin: String(t.borderlineMin),
    targetCount: String(t.targetCount),
  };
}

function serialize(factors: FactorDraft[], t: Thresholds): string {
  return JSON.stringify({
    factors: factors.map((f) => ({
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      kind: f.kind,
      weight: f.weight,
      maxInput: f.maxInput,
      isGate: f.isGate,
      active: f.active,
    })),
    t,
  });
}

export function RankFactorsClient({ workflows }: { workflows: WorkflowConfig[] }) {
  const [selectedKey, setSelectedKey] = useState(workflows[0]?.key ?? '');
  const wf = workflows.find((w) => w.key === selectedKey) ?? workflows[0] ?? null;

  const [factors, setFactors] = useState<FactorDraft[]>(() =>
    (workflows[0]?.factors ?? []).map(toDraft),
  );
  const [thresholds, setThresholds] = useState<Thresholds>(() =>
    toThresholds(workflows[0]?.thresholds ?? { qualifiedMin: 8, borderlineMin: 6, targetCount: 10 }),
  );
  const [baseline, setBaseline] = useState<string>(() =>
    serialize(
      (workflows[0]?.factors ?? []).map(toDraft),
      toThresholds(workflows[0]?.thresholds ?? { qualifiedMin: 8, borderlineMin: 6, targetCount: 10 }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = serialize(factors, thresholds) !== baseline;

  const activeWeight = useMemo(
    () => factors.filter((f) => f.active).reduce((s, f) => s + (Number(f.weight) || 0), 0),
    [factors],
  );

  if (!wf) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No workflows configured yet — seed the database first.
        </p>
      </div>
    );
  }

  function selectWorkflow(key: string) {
    if (dirty) return;
    const next = workflows.find((w) => w.key === key);
    if (!next) return;
    const drafts = next.factors.map(toDraft);
    const th = toThresholds(next.thresholds);
    setSelectedKey(key);
    setFactors(drafts);
    setThresholds(th);
    setBaseline(serialize(drafts, th));
    setError(null);
    setSaved(false);
  }

  function patch(localId: string, p: Partial<FactorDraft>) {
    setFactors((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...p } : f)));
    setSaved(false);
  }
  function removeFactor(localId: string) {
    setFactors((prev) => prev.filter((f) => f.localId !== localId));
    setSaved(false);
  }
  function addFactor() {
    setFactors((prev) => [
      ...prev,
      {
        localId: newId(),
        key: '',
        isNew: true,
        label: '',
        helpText: '',
        kind: 'bool',
        weight: '1',
        maxInput: '',
        isGate: false,
        active: true,
      },
    ]);
    setSaved(false);
  }
  function patchThreshold(p: Partial<Thresholds>) {
    setThresholds((prev) => ({ ...prev, ...p }));
    setSaved(false);
  }

  function reset() {
    const drafts = wf!.factors.map(toDraft);
    const th = toThresholds(wf!.thresholds);
    setFactors(drafts);
    setThresholds(th);
    setError(null);
    setSaved(false);
  }

  async function publish(): Promise<boolean> {
    setBusy(true);
    setError(null);
    const payloadFactors: RankFactorInput[] = factors.map((f) => ({
      key: f.isNew ? '' : f.key,
      label: f.label,
      helpText: f.helpText,
      kind: f.isGate ? 'bool' : f.kind,
      weight: Number(f.weight) || 0,
      maxInput: !f.isGate && f.kind === 'number' ? Number(f.maxInput) || 0 : null,
      isGate: f.isGate,
      active: f.active,
    }));
    const res = await publishRankConfig({
      workflowKey: selectedKey,
      factors: payloadFactors,
      thresholds: {
        qualifiedMin: Number(thresholds.qualifiedMin) || 0,
        borderlineMin: Number(thresholds.borderlineMin) || 0,
        targetCount: Number(thresholds.targetCount) || 0,
      },
    });
    setBusy(false);

    if (res.ok) {
      setBaseline(serialize(factors, thresholds));
      setSaved(true);
      return true;
    }
    setError(res.error ?? 'Could not publish the scoring config.');
    return false;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <DraftGuard dirty={dirty} onReset={reset} onPublish={publish} what="scoring changes" />

      {/* Workflow picker */}
      <div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {workflows.map((w) => {
            const active = w.key === selectedKey;
            return (
              <button
                key={w.key}
                onClick={() => selectWorkflow(w.key)}
                disabled={dirty && !active}
                style={{
                  padding: '0.5rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? w.accent : 'var(--border-strong)'}`,
                  background: active ? `${w.accent}22` : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-mid)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: dirty && !active ? 'not-allowed' : 'pointer',
                  opacity: dirty && !active ? 0.5 : 1,
                }}
              >
                {w.name}
              </button>
            );
          })}
        </div>
        {dirty && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Publish or reset your changes to switch workflow.
          </p>
        )}
      </div>

      {/* Factors */}
      <div className="surface-tool">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '0.85rem',
          }}
        >
          <div className="eyebrow">{wf.name} · rank factors</div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
            {factors.filter((f) => f.active && !f.isGate).length} scoring · total weight {activeWeight}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {factors.map((f) => (
            <FactorCard
              key={f.localId}
              factor={f}
              onPatch={patch}
              onRemove={f.isNew ? removeFactor : null}
            />
          ))}
        </div>

        <button className="btn-outline" onClick={addFactor} style={{ marginTop: '0.85rem' }}>
          Add factor
        </button>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.6rem' }}>
          A maxed-out prospect always scores 10 — weights set each factor&apos;s share.
          Gates are yes/no and don&apos;t score; mark a factor a gate to make it an
          entry requirement. Deactivate a factor to drop it without losing its history.
        </p>
      </div>

      {/* Thresholds */}
      <div className="surface-tool">
        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
          {wf.name} · thresholds
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <ThresholdRow
            label="Qualified — minimum score"
            help="At or above this, a prospect is a strong candidate."
            value={thresholds.qualifiedMin}
            onChange={(v) => patchThreshold({ qualifiedMin: v })}
          />
          <ThresholdRow
            label="Borderline — minimum score"
            help="At or above this is a judgment call; below it, don't message."
            value={thresholds.borderlineMin}
            onChange={(v) => patchThreshold({ borderlineMin: v })}
          />
          <ThresholdRow
            label="Qualified target count"
            help="Once a rep has this many qualified prospects, start the contact cycle."
            value={thresholds.targetCount}
            onChange={(v) => patchThreshold({ targetCount: v })}
          />
        </div>
      </div>

      {/* Action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          flexWrap: 'wrap',
          paddingTop: '0.25rem',
        }}
      >
        <button className="btn-primary" disabled={!dirty || busy} onClick={publish}>
          {busy ? 'Publishing…' : `Publish ${wf.name} scoring`}
        </button>
        <button className="btn-outline" disabled={!dirty || busy} onClick={reset}>
          Reset
        </button>
        {dirty && (
          <span style={{ fontSize: '0.78rem', color: 'var(--warn)' }}>
            Unpublished — Qualify still uses the old config.
          </span>
        )}
        {!dirty && saved && (
          <span style={{ fontSize: '0.78rem', color: 'var(--good)' }}>
            Published. Qualify scoring is current.
          </span>
        )}
        {error && <span style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────

function FactorCard({
  factor,
  onPatch,
  onRemove,
}: {
  factor: FactorDraft;
  onPatch: (localId: string, p: Partial<FactorDraft>) => void;
  onRemove: ((localId: string) => void) | null;
}) {
  const f = factor;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: f.active ? 'var(--surface-tool-2)' : 'transparent',
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        opacity: f.active ? 1 : 0.6,
      }}
    >
      <input
        className="input"
        value={f.label}
        placeholder="Factor label — e.g. Active on social"
        onChange={(e) => onPatch(f.localId, { label: e.target.value })}
      />
      <input
        className="input"
        value={f.helpText}
        placeholder="Help text — what the rep should look for"
        onChange={(e) => onPatch(f.localId, { helpText: e.target.value })}
        style={{ fontSize: '0.82rem' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.78rem',
            color: 'var(--text-mid)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={f.isGate}
            onChange={(e) =>
              onPatch(f.localId, e.target.checked ? { isGate: true, kind: 'bool' } : { isGate: false })
            }
            style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          Gate
        </label>

        {f.isGate ? (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>yes/no · entry requirement</span>
        ) : (
          <select
            className="select"
            value={f.kind}
            onChange={(e) => onPatch(f.localId, { kind: e.target.value as RankFactorKind })}
            style={{ width: 130 }}
            aria-label="Factor kind"
          >
            <option value="bool">Yes / no</option>
            <option value="number">Number</option>
          </select>
        )}

        {!f.isGate && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>Weight</span>
            <input
              type="number"
              step="0.5"
              min={0}
              className="input"
              value={f.weight}
              onChange={(e) => onPatch(f.localId, { weight: e.target.value })}
              style={{ width: 64, textAlign: 'right' }}
              aria-label="Weight"
            />
          </label>
        )}
        {!f.isGate && f.kind === 'number' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>Full credit at</span>
            <input
              type="number"
              step="1"
              min={1}
              className="input"
              value={f.maxInput}
              onChange={(e) => onPatch(f.localId, { maxInput: e.target.value })}
              style={{ width: 64, textAlign: 'right' }}
              aria-label="Full credit at"
            />
          </label>
        )}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.78rem',
            color: 'var(--text-mid)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => onPatch(f.localId, { active: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          Active
        </label>
        {onRemove && (
          <button
            className="btn-ghost"
            onClick={() => onRemove(f.localId)}
            style={{ padding: '0.2rem 0.4rem', marginLeft: 'auto' }}
            aria-label="Remove factor"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function ThresholdRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', justifyContent: 'space-between' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.86rem', color: 'var(--text)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>{help}</div>
      </div>
      <input
        type="number"
        step="0.5"
        min={0}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 90, textAlign: 'right', flexShrink: 0 }}
        aria-label={label}
      />
    </div>
  );
}
