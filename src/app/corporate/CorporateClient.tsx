'use client';

/**
 * Corporate formula editor — interactive.
 *
 * Edits the corporate_pricing parameters as a local draft (D-012) and
 * shows a live preview of the formula's output — Single Executive prices
 * and a few example Team Days — recomputed on every keystroke from the
 * same pricing.ts functions the calculator uses. DraftGuard catches an
 * attempt to leave with unpublished changes.
 */

import { useMemo, useState } from 'react';
import { DraftGuard } from '@/components/DraftGuard';
import {
  corporatePricingFromRows,
  singleExecPrice,
  computeTeamDay,
  fmtMoney,
} from '@/lib/pricing';
import { publishCorporate } from './actions';

export interface CorporateParam {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  notes: string | null;
}

const GROUP_LABEL: Record<string, string> = {
  single: 'Single Executive',
  team: 'Team Day',
  volume: 'Volume discounts',
};
const GROUP_ORDER = ['single', 'team', 'volume'];

function groupOf(key: string): string {
  return key.split('_')[0];
}

function unitTag(unit: string | null): string {
  if (unit === 'usd') return '$';
  if (unit === 'usd_per_person') return '$ / person';
  if (unit === 'count') return 'people';
  if (unit === 'ratio') return 'ratio';
  return unit ?? '';
}

interface Preview {
  single: number;
  singleFeatured: number;
  team12: number;
  team12promo: number;
  team15: number;
  team30: number;
}

export function CorporateClient({ params }: { params: CorporateParam[] }) {
  const initial = useMemo<Record<string, string>>(
    () => Object.fromEntries(params.map((p) => [p.key, String(p.value)])),
    [params],
  );

  const [inputs, setInputs] = useState<Record<string, string>>(initial);
  const [baseline, setBaseline] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(
    () => params.some((p) => inputs[p.key] !== baseline[p.key]),
    [params, inputs, baseline],
  );

  // Live formula preview — null if any field isn't a usable number yet.
  const preview = useMemo<Preview | null>(() => {
    try {
      const rows: Record<string, number> = {};
      for (const p of params) {
        const n = Number(inputs[p.key]);
        if (!Number.isFinite(n)) return null;
        rows[p.key] = n;
      }
      const cfg = corporatePricingFromRows(rows);
      return {
        single: singleExecPrice(false, cfg),
        singleFeatured: singleExecPrice(true, cfg),
        team12: computeTeamDay({ standardCount: 12, featuredCount: 0, promo: false }, cfg).total,
        team12promo: computeTeamDay({ standardCount: 12, featuredCount: 0, promo: true }, cfg).total,
        team15: computeTeamDay({ standardCount: 15, featuredCount: 0, promo: false }, cfg).total,
        team30: computeTeamDay({ standardCount: 30, featuredCount: 0, promo: false }, cfg).total,
      };
    } catch {
      return null;
    }
  }, [params, inputs]);

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
    for (const p of params) {
      const n = Number(inputs[p.key]);
      if (!Number.isFinite(n) || n < 0) {
        setError(`“${p.label}” needs a number of 0 or more.`);
        return false;
      }
      updates.push({ key: p.key, value: n });
    }

    setBusy(true);
    setError(null);
    const res = await publishCorporate(updates);
    setBusy(false);

    if (res.ok) {
      setBaseline({ ...inputs });
      setSaved(true);
      return true;
    }
    setError(res.error ?? 'Could not publish corporate pricing.');
    return false;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <DraftGuard dirty={dirty} onReset={reset} onPublish={publish} what="corporate pricing changes" />

      {GROUP_ORDER.map((g) => {
        const groupParams = params.filter((p) => groupOf(p.key) === g);
        if (groupParams.length === 0) return null;
        return (
          <div key={g} className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
              {GROUP_LABEL[g] ?? g}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {groupParams.map((p) => (
                <ParamRow key={p.key} param={p} value={inputs[p.key] ?? ''} onChange={set} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Live preview */}
      <div className="surface-tool">
        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
          At these numbers
        </div>
        {preview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <PreviewRow label="Single Executive · standard" value={preview.single} />
            <PreviewRow label="Single Executive · featured" value={preview.singleFeatured} />
            <PreviewRow label="Team Day · 12 standard" value={preview.team12} />
            <PreviewRow label="Team Day · 12 standard (first-time)" value={preview.team12promo} />
            <PreviewRow label="Team Day · 15 standard (tier 1)" value={preview.team15} />
            <PreviewRow label="Team Day · 30 standard (tier 2)" value={preview.team30} />
          </div>
        ) : (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Fill every field with a number to see the preview.
          </p>
        )}
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
          {busy ? 'Publishing…' : 'Publish corporate pricing'}
        </button>
        <button className="btn-outline" disabled={!dirty || busy} onClick={reset}>
          Reset
        </button>
        {dirty && (
          <span style={{ fontSize: '0.78rem', color: 'var(--warn)' }}>
            Unpublished — the calculator still uses the old formula.
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

function ParamRow({
  param,
  value,
  onChange,
}: {
  param: CorporateParam;
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
          {param.label}
        </div>
        {param.notes && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {param.notes}
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
          onChange={(e) => onChange(param.key, e.target.value)}
          style={{ width: 110, textAlign: 'right' }}
          aria-label={param.label}
        />
        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)', width: '5rem' }}>
          {unitTag(param.unit)}
        </span>
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '1rem',
        fontSize: '0.82rem',
      }}
    >
      <span style={{ color: 'var(--text-mid)' }}>{label}</span>
      <span className="money" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
        {fmtMoney(value)}
      </span>
    </div>
  );
}
