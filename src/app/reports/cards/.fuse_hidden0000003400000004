import Link from 'next/link';
import type { StalePipelineData } from '@/lib/reports/query';

/**
 * Card 6 · Stale Pipeline — prospects in `contacting` or `responded`
 * stage with no contact activity in ≥14 days. Each row links to the
 * prospect's Qualify page so Dean can push the rep to act or close it
 * out himself.
 *
 * Reads live from `prospects` + `prospect_contacts` — the only card
 * that doesn't read from the snapshot.
 */

interface Props {
  data: StalePipelineData;
}

export function StalePipelineCard({ data }: Props) {
  return (
    <section className="surface-card" style={{ padding: '1.25rem 1.5rem' }}>
      <header
        style={{
          marginBottom: '0.85rem',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p
            style={{
              fontSize: '0.65rem',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              fontWeight: 700,
              marginBottom: '0.3rem',
            }}
          >
            Stale Pipeline
          </p>
          <h3
            style={{
              fontFamily: 'var(--font-playfair), serif',
              fontWeight: 400,
              fontSize: '1.2rem',
              color: 'var(--text)',
              letterSpacing: '-0.005em',
            }}
          >
            14+ days, no activity.
          </h3>
        </div>
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-mid)',
            fontStyle: 'italic',
          }}
        >
          {data.rows.length === 50 ? 'Top 50 shown.' : `${data.rows.length} total.`}
        </span>
      </header>

      {data.rows.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)' }}>
          No stale prospects. Pipeline is current.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
            maxHeight: '24rem',
            overflowY: 'auto',
          }}
        >
          {data.rows.map((r) => (
            <Link
              key={r.prospectId}
              href={`/qualify/${r.prospectId}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '4pt 1fr auto auto',
                gap: '0.75rem',
                alignItems: 'center',
                padding: '0.5rem 0.6rem',
                borderRadius: '0.3rem',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  width: '4px',
                  height: '1.5rem',
                  borderRadius: '2px',
                  background: r.workflowAccent,
                }}
              />
              <div>
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text)',
                    fontWeight: 600,
                  }}
                >
                  {r.prospectName}
                </div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-mid)',
                    marginTop: '0.1rem',
                  }}
                >
                  {r.repName} · last touch {r.lastTouchLabel}
                </div>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-playfair), serif',
                  fontSize: '0.95rem',
                  fontWeight: 500,
                  color: r.daysStale >= 30 ? 'var(--accent)' : 'var(--text-mid)',
                }}
              >
                {r.daysStale}d
              </span>
              <span style={{ color: 'var(--text-mid)', fontSize: '0.85rem' }}>→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
