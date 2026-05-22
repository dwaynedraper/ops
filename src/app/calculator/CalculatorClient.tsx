'use client';

/**
 * The pricing calculator — interactive surface.
 *
 * Pick a branch, pick a package, layer add-ons; or, on the corporate
 * branch, run the parametric Single Executive / Team Day formula. The
 * summary panel re-prices live on every change. "Save quote" sends the
 * *selection* to the server action, which recomputes and persists.
 *
 * All pricing math is imported from src/lib/pricing.ts so this component
 * and the server agree to the cent.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmtMoney, singleExecPrice, computeTeamDay } from '@/lib/pricing';
import type { Catalog, CatalogAddon, Branch, QuoteSelection, QuoteClientInfo, SaveQuoteResult } from '@/lib/catalog';
import { saveQuote } from './actions';

const BRANCH_LABEL: Record<Branch, string> = {
  portraits: 'Portraits',
  realestate: 'Real Estate',
  corporate: 'Corporate',
};

const EMPTY_CLIENT: QuoteClientInfo = {
  name: '',
  email: '',
  phone: '',
  project: '',
  targetDate: '',
  notes: '',
};

interface SummaryLine {
  label: string;
  detail?: string;
  qty: number;
  unitPrice: number;
  unitLabel: string | null;
  lineTotal: number;
}

export function CalculatorClient({
  catalog,
  role,
  prospectId,
  initialClient,
  onSaved,
}: {
  catalog: Catalog;
  role: 'super_admin' | 'partner';
  /** When set, saved quotes link to this prospect (client-page embed). */
  prospectId?: string;
  /** Pre-fills the client-info card (e.g. from a prospect record). */
  initialClient?: QuoteClientInfo;
  /** Called after a quote saves — lets an embedding page refresh. */
  onSaved?: () => void;
}) {
  const pkgsFor = useMemo(
    () => (b: Branch) => catalog.packages.filter((p) => p.branch === b),
    [catalog.packages],
  );

  // Which branch tabs to show: any branch with packages, plus corporate
  // if its parametric config is loaded.
  const branches = useMemo<Branch[]>(() => {
    const order: Branch[] = ['portraits', 'realestate', 'corporate'];
    const list = order.filter((b) => catalog.packages.some((p) => p.branch === b));
    if (catalog.corporate && !list.includes('corporate')) list.push('corporate');
    return list.length ? list : ['portraits'];
  }, [catalog]);

  const [branch, setBranch] = useState<Branch>(branches[0]);
  const [packageId, setPackageId] = useState<string>(() => pkgsFor(branches[0])[0]?.id ?? '');
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});

  // Corporate inputs
  const [corpMode, setCorpMode] = useState<'single' | 'team'>('single');
  const [featured, setFeatured] = useState(false);
  const [standardCount, setStandardCount] = useState(0);
  const [featuredCount, setFeaturedCount] = useState(0);
  const [promo, setPromo] = useState(false);

  const [client, setClient] = useState<QuoteClientInfo>(
    () => initialClient ?? EMPTY_CLIENT,
  );

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveQuoteResult | null>(null);

  function selectBranch(b: Branch) {
    if (b === branch) return;
    setBranch(b);
    setPackageId(pkgsFor(b)[0]?.id ?? '');
    setAddonQty({});
    setResult(null);
  }

  function selectPackage(id: string) {
    setPackageId(id);
    setAddonQty({});
    setResult(null);
  }

  const pkg = catalog.packages.find((p) => p.id === packageId) ?? null;

  // Add-ons that apply to the current package/branch.
  const addons = useMemo<CatalogAddon[]>(
    () =>
      catalog.addons.filter((a) => {
        if (a.packageId) return a.packageId === packageId;
        if (a.branch === null) return true;
        return a.branch === branch;
      }),
    [catalog.addons, packageId, branch],
  );

  // ─── Live pricing ────────────────────────────────────────────────────
  const summary = useMemo<{ lines: SummaryLine[]; total: number; costBasis: number } | null>(() => {
    if (branch === 'corporate') {
      if (!catalog.corporate) return null;
      if (corpMode === 'single') {
        const price = singleExecPrice(featured, catalog.corporate);
        return {
          lines: [
            {
              label: featured ? 'Single Executive — Featured' : 'Single Executive — Standard',
              qty: 1,
              unitPrice: price,
              unitLabel: null,
              lineTotal: price,
            },
          ],
          total: price,
          costBasis: 0,
        };
      }
      const r = computeTeamDay({ standardCount, featuredCount, promo }, catalog.corporate);
      const lines: SummaryLine[] = [
        {
          label: promo ? 'Team Day — base (first-time)' : 'Team Day — base',
          qty: 1,
          unitPrice: r.base,
          unitLabel: null,
          lineTotal: r.base,
        },
      ];
      if (standardCount > 0) {
        lines.push({
          label: 'Standard headshots',
          detail: r.standardDiscount > 0 ? `${Math.round(r.standardDiscount * 100)}% volume discount` : undefined,
          qty: standardCount,
          unitPrice: standardCount ? r.standardSubtotal / standardCount : 0,
          unitLabel: 'person',
          lineTotal: r.standardSubtotal,
        });
      }
      if (featuredCount > 0) {
        lines.push({
          label: 'Featured headshots',
          detail: r.featuredDiscount > 0 ? `${Math.round(r.featuredDiscount * 100)}% volume discount` : undefined,
          qty: featuredCount,
          unitPrice: featuredCount ? r.featuredSubtotal / featuredCount : 0,
          unitLabel: 'person',
          lineTotal: r.featuredSubtotal,
        });
      }
      return { lines, total: r.total, costBasis: 0 };
    }

    if (!pkg) return null;
    const lines: SummaryLine[] = [
      { label: pkg.name, qty: 1, unitPrice: pkg.basePrice, unitLabel: null, lineTotal: pkg.basePrice },
    ];
    let total = pkg.basePrice;
    let costBasis = pkg.costBasis;
    for (const a of addons) {
      const qty = addonQty[a.id] ?? 0;
      if (qty <= 0) continue;
      const lineTotal = a.basePrice * qty;
      lines.push({ label: a.name, qty, unitPrice: a.basePrice, unitLabel: a.unitLabel, lineTotal });
      total += lineTotal;
      costBasis += a.costBasis * qty;
    }
    return { lines, total, costBasis };
  }, [branch, corpMode, featured, standardCount, featuredCount, promo, pkg, addons, addonQty, catalog.corporate]);

  function buildSelection(): QuoteSelection | null {
    if (branch === 'corporate') {
      if (corpMode === 'single') return { kind: 'corp-single', featured };
      return { kind: 'corp-team', standardCount, featuredCount, promo };
    }
    if (!pkg) return null;
    return { kind: 'package', packageId: pkg.id, addonQtys: addonQty };
  }

  async function onSave() {
    const selection = buildSelection();
    if (!selection) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await saveQuote(selection, client, prospectId ?? null);
      setResult(res);
      if (res.ok) onSaved?.();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Could not save the quote.' });
    } finally {
      setSaving(false);
    }
  }

  function newQuote() {
    setClient(initialClient ?? EMPTY_CLIENT);
    setAddonQty({});
    setStandardCount(0);
    setFeaturedCount(0);
    setPromo(false);
    setFeatured(false);
    setResult(null);
  }

  const canSave = !!summary && summary.total > 0 && !saving;

  return (
    <div className="calc-layout">
      {/* ─── Builder ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Branch */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
            Branch
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {branches.map((b) => (
              <Segment key={b} active={b === branch} onClick={() => selectBranch(b)}>
                {BRANCH_LABEL[b]}
              </Segment>
            ))}
          </div>
        </div>

        {/* Package picker / corporate panel */}
        {branch === 'corporate' ? (
          <CorporatePanel
            available={!!catalog.corporate}
            mode={corpMode}
            setMode={(m) => {
              setCorpMode(m);
              setResult(null);
            }}
            featured={featured}
            setFeatured={setFeatured}
            standardCount={standardCount}
            setStandardCount={setStandardCount}
            featuredCount={featuredCount}
            setFeaturedCount={setFeaturedCount}
            promo={promo}
            setPromo={setPromo}
          />
        ) : (
          <>
            <div className="surface-tool">
              <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
                Package
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {pkgsFor(branch).map((p) => (
                  <PackageCard
                    key={p.id}
                    name={p.name}
                    description={p.description}
                    price={p.basePrice}
                    selected={p.id === packageId}
                    onClick={() => selectPackage(p.id)}
                  />
                ))}
                {pkgsFor(branch).length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No packages in this branch yet.
                  </p>
                )}
              </div>
            </div>

            {addons.length > 0 && (
              <div className="surface-tool">
                <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
                  Add-ons
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {addons.map((a) => (
                    <AddonRow
                      key={a.id}
                      addon={a}
                      qty={addonQty[a.id] ?? 0}
                      onChange={(qty) => {
                        setAddonQty((prev) => ({ ...prev, [a.id]: qty }));
                        setResult(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Client info */}
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
            Who&apos;s this for?
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            Optional now — fill in what you have. You can finish it on the saved quote later.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
            <Field label="Client name">
              <input
                className="input"
                value={client.name}
                onChange={(e) => setClient({ ...client, name: e.target.value })}
                placeholder="Jordan Avery"
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={client.email}
                onChange={(e) => setClient({ ...client, email: e.target.value })}
                placeholder="jordan@example.com"
              />
            </Field>
            <Field label="Phone">
              <input
                className="input"
                value={client.phone}
                onChange={(e) => setClient({ ...client, phone: e.target.value })}
                placeholder="(214) 555-0100"
              />
            </Field>
            <Field label="Project">
              <input
                className="input"
                value={client.project}
                onChange={(e) => setClient({ ...client, project: e.target.value })}
                placeholder="Spring listing — Frisco"
              />
            </Field>
            <Field label="Target date">
              <input
                className="input"
                type="date"
                value={client.targetDate}
                onChange={(e) => setClient({ ...client, targetDate: e.target.value })}
              />
            </Field>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <Field label="Notes">
              <textarea
                className="textarea"
                rows={2}
                value={client.notes}
                onChange={(e) => setClient({ ...client, notes: e.target.value })}
                placeholder="Anything worth remembering about this quote."
              />
            </Field>
          </div>
        </div>
      </div>

      {/* ─── Summary ─────────────────────────────────────────────────── */}
      <div className="calc-summary">
        <div className="surface-tool" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="eyebrow">Quote summary</div>

          {summary && summary.lines.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {summary.lines.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>
                      {l.label}
                      {l.qty > 1 && l.unitLabel && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {' '}
                          · {l.qty} × {fmtMoney(l.unitPrice)}/{l.unitLabel}
                        </span>
                      )}
                    </div>
                    {l.detail && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent)' }}>{l.detail}</div>
                    )}
                  </div>
                  <div className="money" style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                    {fmtMoney(l.lineTotal)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              {branch === 'corporate'
                ? 'Choose a corporate product to see the price.'
                : 'Pick a package to begin.'}
            </p>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-mid)', fontWeight: 600 }}>
                Total
              </span>
              <span className="money" style={{ fontSize: '1.85rem', color: 'var(--accent)', lineHeight: 1 }}>
                {summary ? fmtMoney(summary.total) : '—'}
              </span>
            </div>

            {role === 'super_admin' && summary && branch !== 'corporate' && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Cost basis {fmtMoney(summary.costBasis)}</span>
                <span>Margin {fmtMoney(summary.total - summary.costBasis)}</span>
              </div>
            )}
          </div>

          {result?.ok ? (
            <div
              style={{
                background: 'var(--steel-dim)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
                fontSize: '0.82rem',
              }}
            >
              <strong style={{ color: 'var(--text)' }}>Quote #{result.quoteNumber} saved.</strong>{' '}
              Review it and create the client PDF.
              <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {result.id ? (
                  <Link
                    href={`/quotes/${result.id}`}
                    className="btn-ghost"
                    style={{ padding: '0.3rem 0' }}
                  >
                    Open quote →
                  </Link>
                ) : null}
                <button onClick={newQuote} className="btn-ghost" style={{ padding: '0.3rem 0' }}>
                  Start a new quote
                </button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn-primary" style={{ justifyContent: 'center' }} disabled={!canSave} onClick={onSave}>
                {saving ? 'Saving…' : 'Save quote'}
              </button>
              {result && !result.ok && (
                <p style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{result.error}</p>
              )}
            </>
          )}
        </div>

        <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.6rem', textAlign: 'center' }}>
          Stay Sharp. Stay Seen. Stay Human.
        </p>
      </div>
    </div>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.5rem 0.95rem',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-mid)',
        fontSize: '0.78rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function PackageCard({
  name,
  description,
  price,
  selected,
  onClick,
}: {
  name: string;
  description: string | null;
  price: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '0.85rem 1rem',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'var(--accent-dim)' : 'var(--surface-tool-2)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3rem',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text)' }}>{name}</span>
        <span className="money" style={{ color: 'var(--accent)', fontSize: '1rem', whiteSpace: 'nowrap' }}>
          {fmtMoney(price)}
        </span>
      </div>
      {description && (
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{description}</span>
      )}
    </button>
  );
}

function AddonRow({
  addon,
  qty,
  onChange,
}: {
  addon: CatalogAddon;
  qty: number;
  onChange: (qty: number) => void;
}) {
  const countable = !!addon.unitLabel;
  const on = qty > 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.7rem',
        padding: '0.55rem 0.65rem',
        borderRadius: 'var(--radius-sm)',
        background: on ? 'var(--accent-dim)' : 'transparent',
        border: `1px solid ${on ? 'var(--border-accent)' : 'var(--border)'}`,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked ? Math.max(1, qty) : 0)}
        style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0, cursor: 'pointer' }}
        aria-label={addon.name}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{addon.name}</div>
        {addon.description && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {addon.description}
          </div>
        )}
      </div>
      {countable && on && (
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => onChange(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="input"
          style={{ width: 58, padding: '0.3rem 0.4rem', textAlign: 'center' }}
          aria-label={`${addon.name} quantity`}
        />
      )}
      <div className="money" style={{ fontSize: '0.84rem', color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>
        {fmtMoney(addon.basePrice)}
        {addon.unitLabel ? <span style={{ color: 'var(--text-faint)' }}>/{addon.unitLabel}</span> : null}
      </div>
    </div>
  );
}

function CorporatePanel({
  available,
  mode,
  setMode,
  featured,
  setFeatured,
  standardCount,
  setStandardCount,
  featuredCount,
  setFeaturedCount,
  promo,
  setPromo,
}: {
  available: boolean;
  mode: 'single' | 'team';
  setMode: (m: 'single' | 'team') => void;
  featured: boolean;
  setFeatured: (v: boolean) => void;
  standardCount: number;
  setStandardCount: (n: number) => void;
  featuredCount: number;
  setFeaturedCount: (n: number) => void;
  promo: boolean;
  setPromo: (v: boolean) => void;
}) {
  if (!available) {
    return (
      <div className="surface-tool">
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Corporate pricing isn&apos;t configured yet. It lands on the Corporate config page.
        </p>
      </div>
    );
  }
  return (
    <div className="surface-tool" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          Corporate headshots
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Segment active={mode === 'single'} onClick={() => setMode('single')}>
            Single Executive
          </Segment>
          <Segment active={mode === 'team'} onClick={() => setMode('team')}>
            Team Day
          </Segment>
        </div>
      </div>

      {mode === 'single' ? (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Segment active={!featured} onClick={() => setFeatured(false)}>
            Standard
          </Segment>
          <Segment active={featured} onClick={() => setFeatured(true)}>
            Featured
          </Segment>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <Field label="Standard headshots">
              <input
                type="number"
                min={0}
                className="input"
                value={standardCount}
                onChange={(e) => setStandardCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            </Field>
            <Field label="Featured headshots">
              <input
                type="number"
                min={0}
                className="input"
                value={featuredCount}
                onChange={(e) => setFeaturedCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.84rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={promo}
              onChange={(e) => setPromo(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            First-time client — halve the base fee
          </label>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.45 }}>
            Volume discounts apply per rate type: a tier is earned by that type&apos;s own headcount.
          </p>
        </div>
      )}
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
