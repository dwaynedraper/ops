import type { WorkflowRoiData } from '@/lib/reports/query';

/**
 * Card 3 · Workflow ROI — per workflow, the avg deal value, close
 * rate, cycle days, and expected $/close, sorted by $/close desc.
 */

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const PCT_FMT = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

interface Props {
  data: WorkflowRoiData;
}

export function WorkflowRoiCard({ data }: Props) {
  return (
    <section className="surface-card" style={{ padding: '1.25rem 1.5rem' }}>
      <header style={{ marginBottom: '0.85rem' }}>
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
          Workflow ROI
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
          Where to push.
        </h3>
      </header>

      {data.rows.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)' }}>
          No closed engagements in this range yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {data.rows.map((r) => (
            <div
              key={r.workflowKey}
              style={{
                borderLeft: `3px solid ${r.workflowAccent}`,
                paddingLeft: '0.75rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  {r.workflowName}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-playfair), serif',
                    fontSize: '1.05rem',
                    fontWeight: 500,
                    color: 'var(--accent)',
                  }}
                >
                  {USD_FMT.format(r.expectedPerClose)}
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-mid)',
                      marginLeft: '0.25rem',
                      fontFamily: 'var(--font-montserrat), sans-serif',
                    }}
                  >
                    /close
                  </span>
                </span>
              </div>
              <div
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--text-mid)',
                  marginTop: '0.15rem',
                  display: 'flex',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <span>Deal: {USD_FMT.format(r.avgDealValue)}</span>
                <span>Close: {PCT_FMT.format(r.closeRate)}</span>
                <span>
                  Cycle: {r.avgCycleDays !== null ? `${r.avgCycleDays.toFixed(1)}d` : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
