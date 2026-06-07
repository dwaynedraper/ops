import type { DateRange, PipelineVelocityData } from '@/lib/reports/query';

/**
 * Card 1 (hero) · Pipeline Velocity.
 *
 * Big-number perDay + a 30-day sparkline + % change vs. prior period.
 * Pure SVG sparkline — no charting library — to keep the bundle small.
 */

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function Sparkline({ values, accent }: { values: number[]; accent: string }) {
  const w = 320;
  const h = 56;
  const pad = 4;
  if (values.length < 2) {
    return (
      <div
        style={{
          width: w,
          height: h,
          fontSize: '0.75rem',
          color: 'var(--text-mid)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        Not enough data yet.
      </div>
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const xStep = (w - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * xStep;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label="Pipeline velocity sparkline">
      <polyline
        points={points}
        fill="none"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  data: PipelineVelocityData;
  range: DateRange;
}

export function PipelineVelocityCard({ data, range }: Props) {
  const trendUp = data.pctChange >= 0;
  const arrow = trendUp ? '▲' : '▼';
  const pctLabel = `${(Math.abs(data.pctChange) * 100).toFixed(1)}%`;
  const trendColor = trendUp ? 'var(--accent)' : 'var(--text-mid)';

  return (
    <section
      className="surface-card"
      style={{
        padding: '1.5rem 1.75rem',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: '1.5rem',
        alignItems: 'center',
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
            marginBottom: '0.4rem',
          }}
        >
          Pipeline Velocity
        </p>
        <div
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 300,
            fontSize: 'clamp(2.25rem, 5vw, 3rem)',
            lineHeight: 1,
            color: 'var(--accent)',
            letterSpacing: '-0.01em',
          }}
        >
          {USD_FMT.format(data.perDay)}
          <span
            style={{
              marginLeft: '0.4rem',
              fontFamily: 'var(--font-montserrat), sans-serif',
              fontSize: '0.85rem',
              color: 'var(--text-mid)',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            /day
          </span>
        </div>
        <p
          style={{
            marginTop: '0.45rem',
            fontSize: '0.78rem',
            color: 'var(--text-mid)',
            lineHeight: 1.4,
            maxWidth: '20rem',
          }}
        >
          Expected daily revenue from the current pipeline. Sums each
          workflow&rsquo;s active prospects × close rate × avg deal value ÷ cycle days.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Sparkline values={data.sparkline} accent="var(--accent)" />
        <p
          style={{
            marginTop: '0.4rem',
            fontSize: '0.7rem',
            color: 'var(--text-mid)',
            letterSpacing: '0.06em',
          }}
        >
          {range.label}
        </p>
      </div>

      <div style={{ textAlign: 'right' }}>
        <p
          style={{
            fontSize: '0.65rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--text-mid)',
            fontWeight: 700,
            marginBottom: '0.35rem',
          }}
        >
          vs. prior {range.label.toLowerCase()}
        </p>
        <div
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 400,
            fontSize: '1.5rem',
            color: trendColor,
            letterSpacing: '-0.005em',
          }}
        >
          <span style={{ marginRight: '0.3rem' }}>{arrow}</span>
          {pctLabel}
        </div>
      </div>
    </section>
  );
}
