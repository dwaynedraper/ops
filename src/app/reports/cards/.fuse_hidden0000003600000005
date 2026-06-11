import type { ScoreValidationData } from '@/lib/reports/query';

/**
 * Card 5 · Score Validation — score buckets on the x-axis, with two
 * stacked bars per bucket: closed vs. rejected. Tells you if the
 * rank-factor rubric is calibrated.
 *
 * The ideal pattern: closes lean right (high scores), rejects lean
 * left (low scores). If they're flat, the rubric isn't earning its
 * keep.
 */

interface Props {
  data: ScoreValidationData;
}

export function ScoreValidationCard({ data }: Props) {
  const max = Math.max(
    ...data.buckets.map((b) => Math.max(b.closedCount, b.rejectedCount)),
    1,
  );
  const totalCloses = data.buckets.reduce((s, b) => s + b.closedCount, 0);
  const totalRejects = data.buckets.reduce((s, b) => s + b.rejectedCount, 0);

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
          Score Validation
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
          Is the rubric earning its keep?
        </h3>
      </header>

      {totalCloses === 0 && totalRejects === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)' }}>
          No closes or rejects in this range yet.
        </p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '0.5rem',
              alignItems: 'end',
              height: '7rem',
              marginBottom: '0.4rem',
            }}
          >
            {data.buckets.map((b) => {
              const closedH = (b.closedCount / max) * 100;
              const rejectH = (b.rejectedCount / max) * 100;
              return (
                <div
                  key={b.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    justifyContent: 'flex-end',
                    gap: '0.15rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.15rem', height: '100%', alignItems: 'flex-end' }}>
                    <div
                      title={`Closed: ${b.closedCount}`}
                      style={{
                        flex: 1,
                        height: `${closedH}%`,
                        background: 'var(--accent)',
                        borderRadius: '0.2rem 0.2rem 0 0',
                      }}
                    />
                    <div
                      title={`Rejected: ${b.rejectedCount}`}
                      style={{
                        flex: 1,
                        height: `${rejectH}%`,
                        background: 'var(--text-mid)',
                        opacity: 0.55,
                        borderRadius: '0.2rem 0.2rem 0 0',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '0.5rem',
              fontSize: '0.68rem',
              color: 'var(--text-mid)',
              textAlign: 'center',
              fontFamily: 'var(--font-playfair), serif',
              fontStyle: 'italic',
              borderTop: '1px solid var(--border)',
              paddingTop: '0.4rem',
            }}
          >
            {data.buckets.map((b) => (
              <span key={b.label}>{b.label}</span>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '0.85rem',
              fontSize: '0.7rem',
              color: 'var(--text-mid)',
              marginTop: '0.6rem',
              justifyContent: 'center',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: '0.7rem', height: '0.7rem', background: 'var(--accent)', borderRadius: '0.15rem' }} />
              Closed ({totalCloses})
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: '0.7rem', height: '0.7rem', background: 'var(--text-mid)', opacity: 0.55, borderRadius: '0.15rem' }} />
              Rejected ({totalRejects})
            </span>
          </div>
        </>
      )}
    </section>
  );
}
