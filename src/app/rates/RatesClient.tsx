'use client';

/**
 * Rates editor — interactive.
 *
 * Edits the pricing_globals rate table as a local draft. Nothing reaches
 * the database until Publish (D-012); DraftGuard catches an attempt to
 * leave with unpublished changes.
 */

import { useMemo, useState } from 'react';
import { DraftGuard } from '@/components/DraftGuard';
import { publishGlobals } from './actions';

export interface GlobalRate {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  notes: string | null;
}

function unitTag(unit: string | null): string {
  if (unit === 'usd_per_hour') return '$ / hour';
  if (unit === 'ratio') return 'ratio';
  return unit ?? '';
}

export function RatesClient({ rates }: { rates: GlobalRate[] }) {
  const initial = useMemo<Record<string, string>>(
    () => Object.fromEntries(rates.map((r) => [r.key, String(r.value)])),
    [rates],
  );

  const [inputs, setInputs] = useState<Record<string, string>>(initial);
  const [baseline, setBaseline] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(
    () => rates.some((r) => inputs[r.key] !== baseline[r.key]),
    [rates, inputs, baseline],
  );

  function set(key: string, value: string) {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function reset() {
    setInputs(baseline);
    setError(null);
    setSaved(false);
  }

  async function publish(): Promise<boolean> {
    const updates: { key: string; value: number }[] = [];
    for (const r of rates) {
      const n = Number(inputs[r.key]);
      if (!Number.isFinite(n) || n < 0) {
        setError(`“${r.label}” needs a number of 0 or more.`);
        return false;
      }
      updates.push({ key: r.key, value: n });
    }

    setBusy(true);
    setError(null);
    const res = await publishGlobals(updates);
    setBusy(false);

    if (res.ok) {
      setBaseline({ ...inputs });
      setSaved(true);
      return true;
    }
    setError(res.error ?? 'Could not publish the rates.');
    return false;
  }

  const hourly = rates.filter((r) => r.unit === 'usd_per_hour');
  const ratios = rates.filter((r) => r.unit !== 'usd_per_hour');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <DraftGuard dirty={dirty} onReset={reset} onPublish={publish} what="rate changes" />

      {hourly.length > 0 && (
        <RateGroup title="Hourly rates">
          {hourly.map((r) => (
            <RateRow key={r.key} rate={r} value={inputs[r.key] ?? ''} onChange={set} />
          ))}
        </RateGroup>
      )}

      {ratios.length > 0 && (
        <RateGroup title="Margins &amp; ratios">
          {ratios.map((r) => (
            <RateRow key={r.key} rate={r} value={inputs[r.key] ?? ''} onChange={set} />
          ))}
        </RateGroup>
      )}

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
          {busy ? 'Publishing…' : 'Publish rates'}
        </button>
        <button className="btn-outline" disabled={!dirty || busy} onClick={reset}>
          Reset
        </button>
        {dirty && (
          <span style={{ fontSize: '0.78rem', color: 'var(--warn)' }}>
            Unpublished changes — partners still see the old rates.
          </span>
        )}
        {!dirty && saved && (
          <span style={{ fontSize: '0.78rem', color: 'var(--good)' }}>
            Published. The calculator is current.
          </span>
        )}
        {error && <span style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────

function RateGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface-tool">
      <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {children}
      </div>
    </div>
  );
}

function RateRow({
  rate,
  value,
  onChange,
}: {
  rate: GlobalRate;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '1rem',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.86rem', color: 'var(--text)', fontWeight: 600 }}>
          {rate.label}
        </div>
        {rate.notes && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {rate.notes}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <input
          type="number"
          step="any"
          min={0}
          className="input"
          value={value}
          onChange={(e) => onChange(rate.key, e.target.value)}
          style={{ width: 110, textAlign: 'right' }}
          aria-label={rate.label}
        />
        <span
          style={{
            fontSize: '0.68rem',
            color: 'var(--text-faint)',
            width: '4.5rem',
          }}
        >
          {unitTag(rate.unit)}
        </span>
      </div>
    </div>
  );
}
