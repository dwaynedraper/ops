import type { FunnelData } from '@/lib/reports/query';

const STAGE_LABELS: Record<string, string> = {
  researching: 'Sourced',
  qualified: 'Qualified',
  contacting: 'Contacting',
  responded: 'Responded',
  signed: 'Signed',
  client: 'Client',
};

/**
 * Card 2 · Funnel — Sourced → Qualified → Contacting → Responded →
 * Signed → Client. Each row shows entries-into-stage as a horizontal
 * bar plus the conversion % from the prior step.
 */

interface Props {
  data: FunnelData;
}

const PCT_FMT = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

export function FunnelCard({ data }: Props) {
  const max = Math.max(...data.stages.map((s) => s.entered), 1);

  return (
    <section
      className="surface-card"
      style={{ padding: '1.25rem 1.5rem' }}
    >
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
          Funnel
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
          Where it&rsquo;s leaking.
        </h3>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {data.stages.map((s) => {
          const pct = max > 0 ? s.entered / max : 0;
          const stageLabel = STAGE_LABELS[s.stage] ?? s.stage;
          return (
            <div
              key={s.stage}
              style={{
                display: 'grid',
                gridTemplateColumns: '6.5rem 1fr auto',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text)',
                  fontWeight: 600,
                }}
              >
                {stageLabel}
              </span>
              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: '0.25rem',
                  height: '0.75rem',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(pct * 100).toFixed(1)}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    borderRadius: '0.25rem',
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-playfair), serif',
                  fontSize: '0.95rem',
                  color: 'var(--text)',
                  fontWeight: 500,
                  textAlign: 'right',
                  minWidth: '4.5rem',
                }}
              >
                {s.entered.toLocaleString()}
                {s.conversionFromPrior !== null && (
                  <span
                    style={{
                      marginLeft: '0.45rem',
                      fontSize: '0.7rem',
                      color: 'var(--text-mid)',
                      fontFamily: 'var(--font-montserrat), sans-serif',
                    }}
                  >
                    {PCT_FMT.format(s.conversionFromPrior)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
