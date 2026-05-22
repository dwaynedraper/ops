'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useTheme } from '@/app/providers';

type OpsRole = 'super_admin' | 'partner';

interface NavLink {
  href: string;
  label: string;
  /** Only show this link to the listed role */
  gated?: OpsRole | null;
}

const NAV: NavLink[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/calculator', label: 'Calculator' },
  { href: '/quotes', label: 'Quotes' },
  { href: '/prospects', label: 'Research' },
  { href: '/tracking', label: 'Tracking' },
  { href: '/today', label: 'Today' },
];

// Pricing config — super_admin only.
const NAV_ADMIN: NavLink[] = [
  { href: '/rates', label: 'Rates & Globals', gated: 'super_admin' },
  { href: '/packages', label: 'Packages', gated: 'super_admin' },
  { href: '/corporate', label: 'Corporate', gated: 'super_admin' },
  { href: '/team', label: 'Team', gated: 'super_admin' },
];

/**
 * App-shell sidebar. Persistent on desktop, collapses to a top bar on
 * mobile (handled in layout). Reads role from the session.
 */
export function Sidebar({ role = 'partner' }: { role?: OpsRole }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <aside
      style={{
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '1.25rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      {/* Wordmark */}
      <Link
        href="/"
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'var(--text)',
          fontFamily: 'var(--font-playfair), serif',
          fontSize: '1.15rem',
          letterSpacing: '-0.01em',
          lineHeight: 1.1,
          paddingBottom: '0.75rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ display: 'block', fontSize: '0.6rem', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--accent)', fontFamily: 'var(--font-montserrat), sans-serif', fontWeight: 700, marginBottom: '0.25rem' }}>
          Sharp Sighted
        </span>
        <em style={{ color: 'var(--text)', fontStyle: 'italic' }}>Ops</em>
      </Link>

      {/* Main nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 }}>
        {NAV.map((link) => (
          <NavItem key={link.href} link={link} active={pathname === link.href} />
        ))}

        {role === 'super_admin' && (
          <>
            <div
              style={{
                fontSize: '0.6rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'var(--text-faint)',
                fontWeight: 600,
                padding: '1rem 0.75rem 0.4rem',
              }}
            >
              Pricing &amp; Admin
            </div>
            {NAV_ADMIN.map((link) => (
              <NavItem key={link.href} link={link} active={pathname === link.href} />
            ))}
          </>
        )}
      </nav>

      {/* Footer — theme toggle + sign out */}
      <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <button onClick={toggle} className="btn-ghost" style={{ justifyContent: 'flex-start' }}>
          {theme === 'dark' ? '☾  Dark' : '☀  Light'}
        </button>
        <button
          onClick={() => signOut({ callbackUrl: '/signin' })}
          className="btn-ghost"
          style={{ justifyContent: 'flex-start' }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      style={{
        display: 'block',
        padding: '0.5rem 0.75rem',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
        fontSize: '0.85rem',
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--text)' : 'var(--text-mid)',
        background: active ? 'var(--accent-dim)' : 'transparent',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'color 0.15s, background 0.15s',
      }}
    >
      {link.label}
    </Link>
  );
}
