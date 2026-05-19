import Link from 'next/link';

export const metadata = {
  title: 'Sign-in error',
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function SignInErrorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const code = params.error ?? 'Default';

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
          maxWidth: 460,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '2rem 1.75rem',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          Sign-in error
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 400,
            fontSize: '1.7rem',
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
            marginBottom: '0.75rem',
          }}
        >
          {headline(code)}
        </h1>
        <p
          style={{
            color: 'var(--text-mid)',
            fontSize: '0.875rem',
            lineHeight: 1.55,
            marginBottom: '1.5rem',
          }}
        >
          {body(code)}
        </p>
        <Link href="/signin" className="btn-primary" style={{ justifyContent: 'center', width: '100%' }}>
          Back to sign-in
        </Link>
      </div>
    </main>
  );
}

function headline(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return "That email isn't on the roster.";
    case 'Verification':
      return 'That link is expired.';
    case 'Configuration':
      return 'Server misconfiguration.';
    default:
      return 'Something went wrong.';
  }
}

function body(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'Sharp Sighted Ops is invite-only. If you should have access, ask Dean to add you to the partner roster.';
    case 'Verification':
      return 'The sign-in link has been used already or has expired. Request a fresh one and try again.';
    case 'Configuration':
      return "Auth isn't fully configured on the server. If you're a partner seeing this, please report it.";
    default:
      return "We hit an unexpected error during sign-in. Try again, and if it keeps happening, let Dean know.";
  }
}
