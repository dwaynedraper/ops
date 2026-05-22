import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';

/**
 * The access gate.
 *
 * Where proxy.ts sends a signed-in rep whose status isn't 'active' —
 * invited (awaiting activation), suspended, or disabled. They have a
 * valid session but no access to the app itself; this page tells them
 * why and offers a sign-out. An active rep is redirected away.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Account status' };

const COPY: Record<
  string,
  { eyebrow: string; heading: string; body: string }
> = {
  invited: {
    eyebrow: 'Almost there',
    heading: 'Your account is awaiting activation.',
    body: 'You’re signed in, but Sharp Sighted Ops stays locked until an administrator activates your account — a quick step once your onboarding paperwork is squared away. You’ll have full access the moment that’s done.',
  },
  suspended: {
    eyebrow: 'Access paused',
    heading: 'Your access is on hold.',
    body: 'Your Sharp Sighted Ops account is temporarily suspended. Your records are untouched. Reach out to your administrator if you believe this is a mistake.',
  },
  disabled: {
    eyebrow: 'Access ended',
    heading: 'Your access has ended.',
    body: 'Your Sharp Sighted Ops account is no longer active. Your records are retained in full. Reach out to your administrator with any questions.',
  },
};

export default async function AwaitingPage() {
  const session = await auth();
  const user = session?.user;

  if (!user) redirect('/signin?callbackUrl=/awaiting');
  if (user.status === 'active') redirect('/');

  const copy = COPY[user.status] ?? COPY.invited;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.25rem',
        gap: '1.5rem',
      }}
    >
      <div className="surface-card" style={{ maxWidth: 440, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>
          {copy.eyebrow}
        </div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 400,
            letterSpacing: '-0.01em',
            marginBottom: '0.75rem',
          }}
        >
          {copy.heading}
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-mid)', lineHeight: 1.6 }}>
          {copy.body}
        </p>
        <p
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-faint)',
            marginTop: '0.85rem',
          }}
        >
          Signed in as {user.email}.
        </p>

        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/signin' });
          }}
        >
          <button
            type="submit"
            className="btn-outline"
            style={{ marginTop: '1.1rem' }}
          >
            Sign out
          </button>
        </form>
      </div>

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}
