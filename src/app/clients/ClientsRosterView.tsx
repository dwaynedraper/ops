'use client';

/**
 * Clients roster — interactive. Search by name / email / market area, and
 * a "Show archived" toggle. All client-side over the rows the server
 * already scoped to the viewer (same list dialect as the Pipeline).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  clientInitials,
  clientMatches,
  clientSubtitle,
  CLIENT_KIND_LABEL,
  type ClientListItem,
} from '@/lib/clients';

export function ClientsRosterView({
  clients,
  isAdmin,
}: {
  clients: ClientListItem[];
  isAdmin: boolean;
}) {
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(
    () =>
      clients.filter((c) => {
        if (!showArchived && c.status === 'archived') return false;
        return clientMatches(search, {
          displayName: c.displayName,
          email: c.email,
          marketArea: c.marketArea,
        });
      }),
    [clients, search, showArchived],
  );

  const archivedCount = clients.filter((c) => c.status === 'archived').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Search + filter */}
      <div
        className="filter-bar-responsive"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or market…"
          style={{ flex: '1 1 240px', minWidth: 0 }}
        />
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.74rem',
            color: 'var(--text-mid)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span>
            Show archived
            {!showArchived && archivedCount > 0 && (
              <span style={{ color: 'var(--text-faint)' }}> ({archivedCount} hidden)</span>
            )}
          </span>
        </label>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
          {filtered.length} of {clients.length}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="surface-card">
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            {clients.length === 0
              ? 'No clients yet — add your first, or one appears here the moment a prospect signs.'
              : 'Nobody matches that search.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {filtered.map((c) => {
            const archived = c.status === 'archived';
            return (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="list-row-responsive"
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.7rem 0.9rem',
                  textDecoration: 'none',
                  color: 'inherit',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  opacity: archived ? 0.55 : 1,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                  }}
                >
                  {clientInitials(c.displayName)}
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
                    {c.displayName}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.73rem',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {clientSubtitle({
                      relationship: c.relationship,
                      marketArea: c.marketArea,
                      email: c.email,
                    })}
                    {isAdmin && c.ownerName ? `  ·  ${c.ownerName}` : ''}
                  </span>
                </span>

                <span
                  className="list-row-trail"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}
                >
                  <span
                    style={{
                      fontSize: '0.6rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: 'var(--text-faint)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.18rem 0.45rem',
                    }}
                  >
                    {archived ? 'Archived' : CLIENT_KIND_LABEL[c.kind]}
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-faint)',
                      minWidth: '3.2rem',
                      textAlign: 'right',
                    }}
                  >
                    {c.updatedAtLabel}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
