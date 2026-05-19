import Link from 'next/link';

export const metadata = {
  title: 'Check your email',
};

/**
 * Shown after the user submits the sign-in form. The actual magic link
 * is in their inbox, not on this page. We just confirm we sent it.
 */
export default function VerifyRequestPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.25rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '2rem 1.75rem',
          textAlign: 'center',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: '0.75rem', justifyContent: 'center' }}>
          Check your inbox
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 400,
            fontSize: '1.85rem',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginBottom: '0.75rem',
          }}
        >
          A <em style={{ color: 'var(--accent)' }}>sign-in link</em> is on its way.
        </h1>
        <p
          style={{
            color: 'var(--text-mid)',
            fontSize: '0.85rem',
            lineHeight: 1.55,
            marginBottom: '1.5rem',
          }}
        >
          Open your inbox, click the button in the email, and you&apos;re in.
          The link is valid for 24 hours. You can close this tab.
        </p>
        <Link
          href="/signin"
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          ← Use a different email
        </Link>
      </div>
    </main>
  );
}
