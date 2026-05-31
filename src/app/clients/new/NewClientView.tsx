'use client';

/**
 * New / returning client — search-first. As the name is typed we run the
 * duplicate typeahead (searchClients); matches link straight to the
 * existing record so a returning client never becomes a duplicate. The
 * form below creates a fresh client and jumps to their page.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  clientInitials,
  CLIENT_KIND_LABEL,
  CLIENT_BRANCH_LABEL,
  type ClientKind,
  type ClientBranch,
} from '@/lib/clients';
import { createClient, searchClients, type ClientSearchHit } from '../actions';

export function NewClientView() {
  const router = useRouter();

  const [kind, setKind] = useState<ClientKind>('person');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [marketArea, setMarketArea] = useState('');
  const [relationship, setRelationship] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [branchAffinity, setBranchAffinity] = useState<ClientBranch | ''>('');

  const [hits, setHits] = useState<ClientSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live duplicate check as the name is typed (debounced + race-guarded).
  const seq = useRef(0);
  useEffect(() => {
    const q = name.trim();
    const mine = ++seq.current;
    // All setState happens inside the timer callback (never synchronously
    // in the effect body) so a short query clears via the same path.
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (seq.current === mine) setHits([]);
        return;
      }
      const results = await searchClients(q);
      if (seq.current === mine) setHits(results);
    }, 200);
    return () => clearTimeout(t);
  }, [name]);

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give them a name first.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createClient({
      kind,
      displayName: trimmed,
      email,
      phone,
      marketArea,
      relationship,
      referralSource,
      branchAffinity,
    });
    if (res.ok && res.id) {
      router.push(`/clients/${res.id}`);
    } else {
      setError(res.error ?? 'Could not create the client.');
      setBusy(false);
    }
  }

  const nameLabel = kind === 'org' ? 'Business name' : 'Full name';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Link
        href="/clients"
        className="btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '0.2rem 0' }}
      >
        ← Clients
      </Link>

      <div>
        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
          Add a client
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
          Who are we <em style={{ color: 'var(--accent)' }}>adding</em>?
        </h1>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-mid)', marginTop: '0.5rem' }}>
          Returning client? Start typing — if they&apos;re already on file you can jump
          straight to them instead of making a duplicate.
        </p>
      </div>

      <div className="surface-tool">
        {/* Person / Business toggle */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['person', 'org'] as ClientKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={kind === k ? 'btn-primary' : 'btn-outline'}
            >
              {CLIENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <Field label={nameLabel} full>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'org' ? 'Acme Title Co.' : 'Sarah Chen'}
              autoFocus
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Market area">
            <input
              className="input"
              value={marketArea}
              onChange={(e) => setMarketArea(e.target.value)}
              placeholder="Frisco"
            />
          </Field>
          <Field label="Branch">
            <select
              className="select"
              value={branchAffinity}
              onChange={(e) => setBranchAffinity(e.target.value as ClientBranch | '')}
            >
              <option value="">—</option>
              {(Object.keys(CLIENT_BRANCH_LABEL) as ClientBranch[]).map((b) => (
                <option key={b} value={b}>
                  {CLIENT_BRANCH_LABEL[b]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Relationship" full>
            <input
              className="input"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="How you know them — e.g. Past portrait client; met at the Frisco chamber mixer"
            />
          </Field>
          <Field label="Referred by">
            <input
              className="input"
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '1rem' }}>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={onCreate}>
            {busy ? 'Creating…' : 'Create client'}
          </button>
          {error && <span style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</span>}
        </div>
      </div>

      {/* Duplicate hits */}
      {hits.length > 0 && (
        <div className="surface-tool">
          <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>
            Already on file?
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>
            These look close to what you typed. Tap one to open them instead of creating a
            duplicate.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {hits.map((h) => (
              <Link
                key={h.id}
                href={`/clients/${h.id}`}
                className="surface-tool list-row-responsive"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.6rem 0.8rem',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                  }}
                >
                  {clientInitials(h.displayName)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                    {h.displayName}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {[h.relationship, h.marketArea, h.email].filter(Boolean).join(' · ') ||
                      CLIENT_KIND_LABEL[h.kind]}
                    {h.status === 'archived' ? ' · archived' : ''}
                  </span>
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--accent)', flexShrink: 0 }}>Open →</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', gridColumn: full ? '1 / -1' : 'auto' }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
