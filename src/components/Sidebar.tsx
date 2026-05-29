'use client';

/**
 * App-shell sidebar — V2 layout (D-066, D-067).
 *
 * Four sections, separated by section headers with top borders:
 *   1. Dashboard (single link, no header)
 *   2. TOOLS — Quote Calculator, Tutorials
 *   3. SALES — Sourcing, Qualify, Contact, Client List
 *   4. PRICING & ADMIN — super-admin only
 *
 * The aside uses `.app-shell-aside` (position: sticky, height: 100vh)
 * so it stays pinned at the top of the viewport regardless of how
 * tall the page is. The middle nav region scrolls internally if it
 * overflows; the wordmark at the top and the theme-toggle + sign-out
 * at the bottom stay pinned at all times.
 */

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

const TOOLS_LINKS: NavLink[] = [
  { href: '/calculator', label: 'Quote Calculator' },
  { href: '/tutorials', label: 'Tutorials' },
];

const SALES_LINKS: NavLink[] = [
  { href: '/sourcing', label: 'Sourcing' },
  { href: '/qualify', label: 'Qualify' },
  { href: '/contact', label: 'Contact' },
  { href: '/clients', label: 'Client List' },
];

// Pricing & Admin — super_admin only (also re-checked server-side on
// each of these routes; the gate is not just menu-level).
const ADMIN_LINKS: NavLink[] = [
  { href: '/reports', label: 'Reports', gated: 'super_admin' },
  { href: '/rates', label: 'Rates & Globals', gated: 'super_admin' },
  { href: '/packages', label: 'Packages', gated: 'super_admin' },
  { href: '/corporate', label: 'Corporate', gated: 'super_admin' },
  { href: '/rank-factors', label: 'Rank Factors', gated: 'super_admin' },
  { href: '/scripts', label: 'Scripts', gated: 'super_admin' },
  { href: '/team', label: 'Team', gated: 'super_admin' },
];

/** Pathname matcher. `/` only matches the dashboard exactly; everything
 * else matches itself or any nested route (e.g. `/qualify` matches
 * `/qualify/abc-123`). */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function Sidebar({ role = 'partner' }: { role?: OpsRole }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <aside
      className="app-shell-aside"
      style={{
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '1.25rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Wordmark — pinned top */}
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
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            fontSize: '0.6rem',
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            fontFamily: 'var(--font-montserrat), sans-serif',
            fontWeight: 700,
            marginBottom: '0.25rem',
          }}
        >
          Sharp Sighted
        </span>
        <em style={{ color: 'var(--text)', fontStyle: 'italic' }}>Ops</em>
      </Link>

      {/* Scrollable middle — sections + links */}
      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          paddingTop: '0.85rem',
          gap: '0.1rem',
        }}
      >
        {/* Dashboard — no section header */}
        <NavItem
          link={{ href: '/', label: 'Dashboard' }}
          active={isActive(pathname, '/')}
        />

        <SectionHeader>Tools</SectionHeader>
        {TOOLS_LINKS.map((link) => (
          <NavItem key={link.href} link={link} active={isActive(pathname, link.href)} />
        ))}

        <SectionHeader>Sales</SectionHeader>
        {SALES_LINKS.map((link) => (
          <NavItem key={link.href} link={link} active={isActive(pathname, link.href)} />
        ))}

        {role === 'super_admin' && (
          <>
            <SectionHeader>Pricing &amp; Admin</SectionHeader>
            {ADMIN_LINKS.map((link) => (
              <NavItem
                key={link.href}
                link={link}
                active={isActive(pathname, link.href)}
              />
            ))}
          </>
        )}
      </nav>

      {/* Footer — pinned bottom, never scrolls */}
      <div
        style={{
          paddingTop: '0.85rem',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          flexShrink: 0,
        }}
      >
        <button
          onClick={toggle}
          className="btn-ghost"
          style={{ justifyContent: 'flex-start' }}
        >
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.6rem',
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'var(--text-faint)',
        fontWeight: 600,
        padding: '0.95rem 0.75rem 0.35rem',
        marginTop: '0.4rem',
        borderTop: '1px solid var(--border)',
      }}
    >
      {children}
    </div>
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
