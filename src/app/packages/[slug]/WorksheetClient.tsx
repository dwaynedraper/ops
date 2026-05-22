'use client';

/**
 * Package worksheet editor — interactive.
 *
 * Edits a package's cost lines and margin as a local draft (D-012). The
 * summary re-prices live with priceFromCostLines — the same function the
 * seed and calculator use — so the Working and Website prices on screen
 * match exactly what Publish will write. DraftGuard catches an attempt to
 * leave with unpublished changes.
 */

import { useMemo, useState } from 'react';
import { DraftGuard } from '@/components/DraftGuard';
import {
  priceFromCostLines,
  resolveRate,
  fmtMoney,
  type CostLine,
  type RateRole,
  type PricingGlobals,
} from '@/lib/pricing';
import { publishWorksheet } from './actions';

export interface WorksheetPackage {
  slug: string;
  name: string;
  branch: string;
  defaultMargin: number;
  basePrice: number;
}

export interface WorksheetLineInit {
  kind: 'time' | 'hard';
  category: string;
  hours: number;
  rateRole: RateRole | null;
  amount: number;
}

interface DraftLine {
  localId: string;
  kind: 'time' | 'hard';
  category: string;
  hours: string;
  rateRole: RateRole;
  amount: string;
}

const RATE_ROLES: { value: RateRole; label: string }[] = [
  { value: 'lp', label: 'LP — standard' },
  { value: 'lp_saga', label: 'LP — Saga premium' },
  { value: 'second_shooter', label: 'Second shooter' },
  { value: 'pa', label: 'Production assistant' },
  { value: 'xm', label: 'External marketer' },
];

const BRANCH_LABEL: Record<string, string> = {
  portraits: 'Portraits',
  realestate: 'Real Estate',
  corporate: 'Corporate',
};

function newId(): string {
  return `ln-${Math.random().toString(36).slice(2)}`;
}

function toDraft(line: WorksheetLineInit): DraftLine {
  return {
    localId: newId(),
    kind: line.kind,
    category: line.category,
    hours: String(line.hours),
    rateRole: line.rateRole ?? 'lp',
    amount: String(line.amount),
  };
}

/** Stable serialization of the editable state, for dirty detection. */
function serialize(margin: string, lines: DraftLine[]): string {
  return JSON.stringify({
    margin,
    lines: lines.map((l) => ({
      kind: l.kind,
      category: l.category,
      hours: l.hours,
      rateRole: l.rateRole,
      amount: l.amount,
    })),
  });
}

/** Resolve a role's hourly rate; 0 if the global is somehow missing. */
function rateFor(role: RateRole, globals: PricingGlobals): number {
  try {
    return resolveRate(role, globals);
  } catch {
    return 0;
  }
}

export function WorksheetClient({
  pkg,
  initialLines,
  globals,
}: {
  pkg: WorksheetPackage;
  initialLines: WorksheetLineInit[];
  globals: PricingGlobals;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() => initialLines.map(toDraft));
  const [margin, setMargin] = useState<string>(String(pkg.defaultMargin));
  const [baseline, setBaseline] = useState<string>(() =>
    serialize(String(pkg.defaultMargin), initialLines.map(toDraft)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = serialize(margin, lines) !== baseline;

  // ─── Live price ──────────────────────────────────────────────────────
  const priced = useMemo(() => {
    const costLines: CostLine[] = lines.map((l) =>
      l.kind === 'time'
        ? {
            kind: 'time',
            category: l.category,
            hours: Number(l.hours) || 0,
            rateRole: l.rateRole,
          }
        : { kind: 'hard', category: l.category, amount: Number(l.amount) || 0 },
    );
    try {
      return priceFromCostLines(costLines, globals, Number(margin) || 0);
    } catch {
      return null;
    }
  }, [lines, margin, globals]);

  const timeLines = lines.filter((l) => l.kind === 'time');
  const hardLines = lines.filter((l) => l.kind === 'hard');

  function patch(localId: string, p: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...p } : l)));
    setSaved(false);
  }
  function remove(localId: string) {
    setLines((prev) => prev.filter((l) => l.localId !== localId));
    setSaved(false);
  }
  function addLine(kind: 'time' | 'hard') {
    setLines((prev) => [
      ...prev,
      { localId: newId(), kind, category: '', hours: '0', rateRole: 'lp', amount: '0' },
    ]);
    setSaved(false);
  }

  function reset() {
    const fresh = initialLines.map(toDraft);
    setLines(fresh);
    setMargin(String(pkg.defaultMargin));
    setBaseline(serialize(String(pkg.defaultMargin), fresh));
    setError(null);
    setSaved(false);
  }

  async function publish(): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await publishWorksheet({
      slug: pkg.slug,
      margin: Number(margin) || 0,
      lines: lines.map((l) => ({
        kind: l.kind,
        category: l.category,
        hours: Number(l.hours) || 0,
        rateRole: l.kind === 'time' ? l.rateRole : null,
        amount: Number(l.amount) || 0,
      })),
    });
    setBusy(false);

    if (res.ok) {
      setBaseline(serialize(margin, lines));
      setSaved(true);
      return true;
    }
    setError(res.error ?? 'Could not publish the worksheet.');
    return false;
  }

  const websitePrice = priced?.displayPrice ?? null;
  const priceMoved = websitePrice !== null && websitePrice !== pkg.basePrice;

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
        {BRANCH_LABEL[pkg.branch] ?? pkg.branch} · worksheet
      </div>
      <h1
        style={{
          fontSize: 'clamp(1.6rem, 3vw, 2.3rem)',
          fontFamily: 'var(--font-playfair), serif',
          fontWeight: 400,
          letterSpacing: '-0.01em',
          marginBottom: '0.5rem',
        }}
      >
        {pkg.name}
      </h1>
      <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '58ch' }}>
        Every line feeds the cost basis. Margin and round-up turn it into the
        website price. Edit freely — nothing reaches the calculator until you
        publish.
      </p>

      <div className="calc-layout">
        {/* ─── Builder ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Margin */}
          <div className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
              Margin
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                className="input"
                value={margin}
                onChange={(e) => {
                  setMargin(e.target.value);
                  setSaved(false);
                }}
                style={{ width: 110, textAlign: 'right' }}
                aria-label="Margin"
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                ratio — {Math.round((Number(margin) || 0) * 100)}%
              </span>
            </div>
          </div>

          {/* Time lines */}
          <div className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
              Time lines
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {timeLines.map((l) => {
                const cost = (Number(l.hours) || 0) * rateFor(l.rateRole, globals);
                return (
                  <div
                    key={l.localId}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
                  >
                    <input
                      className="input"
                      value={l.category}
                      placeholder="Line item — e.g. Shooting"
                      onChange={(e) => patch(l.localId, { category: e.target.value })}
                      style={{ flex: '1 1 150px', minWidth: 0 }}
                    />
                    <input
                      type="number"
                      step="0.25"
                      min={0}
                      className="input"
                      value={l.hours}
                      onChange={(e) => patch(l.localId, { hours: e.target.value })}
                      style={{ width: 68, textAlign: 'right' }}
                      aria-label="Hours"
                    />
                    <select
                      className="select"
                      value={l.rateRole}
                      onChange={(e) => patch(l.localId, { rateRole: e.target.value as RateRole })}
                      style={{ width: 150 }}
                      aria-label="Rate role"
                    >
                      {RATE_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <span
                      className="money"
                      style={{
                        width: 70,
                        textAlign: 'right',
                        fontSize: '0.8rem',
                        color: 'var(--text-mid)',
                      }}
                    >
                      {fmtMoney(cost)}
                    </span>
                    <button
                      className="btn-ghost"
                      onClick={() => remove(l.localId)}
                      style={{ padding: '0.2rem 0.4rem' }}
                      aria-label={`Remove ${l.category || 'line'}`}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {timeLines.length === 0 && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                  No time lines yet.
                </p>
              )}
            </div>
            <button
              className="btn-outline"
              onClick={() => addLine('time')}
              style={{ marginTop: '0.85rem' }}
            >
              Add time line
            </button>
          </div>

          {/* Hard cost lines */}
          <div className="surface-tool">
            <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
              Hard costs
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {hardLines.map((l) => (
                <div
                  key={l.localId}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
                >
                  <input
                    className="input"
                    value={l.category}
                    placeholder="Line item — e.g. Prints &amp; packaging"
                    onChange={(e) => patch(l.localId, { category: e.target.value })}
                    style={{ flex: '1 1 150px', minWidth: 0 }}
                  />
                  <input
                    type="number"
                    step="1"
                    min={0}
                    className="input"
                    value={l.amount}
                    onChange={(e) => patch(l.localId, { amount: e.target.value })}
                    style={{ width: 96, textAlign: 'right' }}
                    aria-label="Amount"
                  />
                  <button
                    className="btn-ghost"
                    onClick={() => remove(l.localId)}
                    style={{ padding: '0.2rem 0.4rem' }}
                    aria-label={`Remove ${l.category || 'line'}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {hardLines.length === 0 && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                  No hard-cost lines yet.
                </p>
              )}
            </div>
            <button
              className="btn-outline"
              onClick={() => addLine('hard')}
              style={{ marginTop: '0.85rem' }}
            >
              Add hard cost
            </button>
          </div>
        </div>

        {/* ─── Summary ──────────────────────────────────────────────── */}
        <div className="calc-summary">
          <div
            className="surface-tool"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}
          >
            <div className="eyebrow">Worksheet price</div>

            {priced ? (
              <>
                <SummaryRow label="Total hours" value={String(priced.totalHours)} />
                <SummaryRow label="Time cost" value={fmtMoney(priced.timeCost)} />
                <SummaryRow label="Hard cost" value={fmtMoney(priced.hardCost)} />
                <SummaryRow label="Cost basis" value={fmtMoney(priced.costBasis)} />
                <SummaryRow
                  label={`Margin (${Math.round((Number(margin) || 0) * 100)}%)`}
                  value={fmtMoney(priced.marginAmount)}
                />
                <SummaryRow label="Working price" value={fmtMoney(priced.workingPrice)} />

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.7rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.7rem',
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                        color: 'var(--text-mid)',
                        fontWeight: 600,
                      }}
                    >
                      Website price
                    </span>
                    <span
                      className="money"
                      style={{ fontSize: '1.7rem', color: 'var(--accent)', lineHeight: 1 }}
                    >
                      {fmtMoney(priced.displayPrice)}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '0.72rem',
                      color: priceMoved ? 'var(--warn)' : 'var(--text-faint)',
                      marginTop: '0.4rem',
                    }}
                  >
                    {priceMoved
                      ? `Currently published: ${fmtMoney(pkg.basePrice)} — publishing moves it.`
                      : `Matches the published price (${fmtMoney(pkg.basePrice)}).`}
                  </p>
                </div>
              </>
            ) : (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Add a cost line to see the price.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.2rem' }}>
              <button
                className="btn-primary"
                style={{ justifyContent: 'center' }}
                disabled={!dirty || busy}
                onClick={publish}
              >
                {busy ? 'Publishing…' : 'Publish worksheet'}
              </button>
              <button
                className="btn-outline"
                style={{ justifyContent: 'center' }}
                disabled={!dirty || busy}
                onClick={reset}
              >
                Reset
              </button>
            </div>

            {dirty && (
              <p style={{ fontSize: '0.74rem', color: 'var(--warn)' }}>
                Unpublished — the calculator still uses the old worksheet.
              </p>
            )}
            {!dirty && saved && (
              <p style={{ fontSize: '0.74rem', color: 'var(--good)' }}>
                Published. The calculator is current.
              </p>
            )}
            {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</p>}
          </div>
        </div>
      </div>

      <DraftGuard dirty={dirty} onReset={reset} onPublish={publish} what="worksheet changes" />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
      <span style={{ color: 'var(--text-mid)' }}>{label}</span>
      <span className="money" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}
