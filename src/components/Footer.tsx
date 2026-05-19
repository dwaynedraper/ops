/**
 * Internal-tool footer. Keeps the brand tagline (per CLAUDE.md §2 — every
 * public-facing artifact closes with the tagline) and links back to the
 * public studio so a partner who lands here by accident knows where the
 * front door is.
 */
export function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border)',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        fontSize: '0.7rem',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontWeight: 600,
        flexWrap: 'wrap',
      }}
    >
      <span>Sharp Sighted Ops</span>
      <span
        style={{
          fontFamily: 'var(--font-playfair), serif',
          fontStyle: 'italic',
          letterSpacing: '0.04em',
          textTransform: 'none',
          fontSize: '0.85rem',
          color: 'var(--brand-cyan)',
          fontWeight: 400,
        }}
      >
        Stay Sharp. Stay Seen. Stay Human.
      </span>
      <a
        href="https://sharpsighted.studio"
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        sharpsighted.studio →
      </a>
    </footer>
  );
}
