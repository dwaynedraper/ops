import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signIn, auth } from '@/auth';

export const metadata = {
  title: 'Sign in',
};

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

/**
 * Branded sign-in page. Renders a single email input that posts to the
 * server action below, which kicks off the Resend magic-link flow.
 *
 * If the user is already signed in, redirect them straight in. The auth()
 * helper does the cookie + DB lookup; cost is one indexed query.
 */
export default async function SignInPage({ searchParams }: PageProps) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = sanitizeCallback(params.callbackUrl) ?? '/';
  if (session) redirect(callbackUrl);

  const error = params.error;

  async function startSignIn(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const redirectTo = String(formData.get('callbackUrl') ?? '/');
    if (!email) return;
    await signIn('resend', {
      email,
      redirectTo,
    });
  }

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
          padding: '2rem 1.75rem 1.75rem',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          Sharp Sighted · Ops
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 400,
            fontSize: '1.85rem',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginBottom: '0.5rem',
          }}
        >
          Sign in to <em style={{ color: 'var(--accent)' }}>ops</em>.
        </h1>
        <p
          style={{
            color: 'var(--text-mid)',
            fontSize: '0.85rem',
            lineHeight: 1.5,
            marginBottom: '1.5rem',
          }}
        >
          Enter your email. We&apos;ll send a magic link that signs you in for
          24 hours. No passwords to remember, no support to call.
        </p>

        {error && <SignInError code={error} />}

        <form action={startSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="input"
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary" style={{ justifyContent: 'center' }}>
            Send magic link
          </button>
        </form>

        <p
          style={{
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          Not a partner?{' '}
          <Link
            href="https://sharpsighted.studio"
            style={{ color: 'var(--text-mid)', textDecoration: 'underline', textUnderlineOffset: 2 }}
          >
            Visit the public studio →
          </Link>
        </p>
      </div>
    </main>
  );
}

function SignInError({ code }: { code: string }) {
  const message = errorMessage(code);
  return (
    <div
      role="alert"
      style={{
        marginBottom: '1rem',
        padding: '0.7rem 0.9rem',
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.30)',
        borderRadius: 'var(--radius-sm)',
        color: '#fca5a5',
        fontSize: '0.8rem',
      }}
    >
      {message}
    </div>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'That email is not on the partner roster. If you should have access, ask Dean to add you.';
    case 'Verification':
      return 'That sign-in link is expired or already used. Request a fresh one below.';
    case 'EmailCreateAccount':
    case 'EmailSignin':
      return 'We couldn\'t send the magic link. Check the email and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/**
 * Refuse callback URLs that aren't same-host relative paths. Auth.js
 * does this on its end too, but the page reads the param into a hidden
 * field, so we sanitize before render to prevent reflected open-redirect
 * weirdness in the form itself.
 */
function sanitizeCallback(url: string | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/')) return null;
  if (url.startsWith('//')) return null;
  return url;
}
