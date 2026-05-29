import type { RepLeaderboardData } from '@/lib/reports/query';

/**
 * Card 4 · Rep Leaderboard — per rep, last 30 days. Sourced, replied,
 * closed, reply rate, close rate. Active Partner badge driven by
 * rolling-6-month rule.
 */

const PCT_FMT = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

interface Props {
  data: RepLeaderboardData;
}

export function RepLeaderboardCard({ data }: Props) {
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
          Rep Leaderboard
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
          Who&rsquo;s producing.
        </h3>
      </header>

      {data.rows.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)' }}>
          No active reps with activity in this range yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {data.rows.map((r) => (
            <div
              key={r.repId}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: '0.85rem',
                alignItems: 'center',
                padding: '0.55rem 0',
                borderBottom: '1px dashed var(--border)',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      color: 'var(--text)',
                    }}
                  >
                    {r.name}
                  </span>
                  {r.activePartner && (
                    <span
                      style={{
                        fontSize: '0.6rem',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        padding: '0.1rem 0.4rem',
                        borderRadius: '0.2rem',
                        background: 'var(--accent)',
                        color: 'var(--surface)',
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-mid)',
                    marginTop: '0.15rem',
                  }}
                >
                  Sourced {r.sourced} · Contacted {r.contacted} · Replied {r.replied}
                </div>
              </div>

              <div style={{ textAlign: 'right', minWidth: '3.5rem' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-playfair), serif',
                    fontSize: '1.1rem',
                    fontWeight: 500,
                    color: 'var(--accent)',
                    lineHeight: 1,
                  }}
                >
                  {r.closed}
                </div>
                <div
                  style={{
                    fontSize: '0.62rem',
                    color: 'var(--text-mid)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    marginTop: '0.15rem',
                  }}
                >
                  closes
                </div>
              </div>

              <div style={{ textAlign: 'right', minWidth: '3rem' }}>
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text)',
                    fontWeight: 600,
                  }}
                >
                  {PCT_FMT.format(r.replyRate)}
                </div>
                <div
                  style={{
                    fontSize: '0.6rem',
                    color: 'var(--text-mid)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                  }}
                >
                  reply
                </div>
              </div>

              <div style={{ textAlign: 'right', minWidth: '3rem' }}>
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text)',
                    fontWeight: 600,
                  }}
                >
                  {PCT_FMT.format(r.closeRate)}
                </div>
                <div
                  style={{
                    fontSize: '0.6rem',
                    color: 'var(--text-mid)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                  }}
                >
                  close
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
