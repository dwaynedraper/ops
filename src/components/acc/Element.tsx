'use client';

/**
 * Element — the ACC glass-widget primitive (ACC-PLAN §4b/§5).
 *
 * Three states (6D-2), all driven by ONE accent role:
 *   • Rest   — GLASS: translucent dark, faint border, no glow, slightly
 *              receded. Calm. Recedes a touch more when something else is
 *              pinned, so the active one stands out.
 *   • Hover  — THE LANTERN: a partial wake. Border + glow brighten, the dark
 *              screen firms up a little. Pure CSS (.acc-element:hover in
 *              globals.css) so it never triggers a React render. Fades on
 *              mouse-out. Lighting, not selecting.
 *   • Pinned — ACTIVE: full near-opaque dark screen + full accent border +
 *              bright glow + slight grow. The look Dean approved on the cash
 *              strip. Click to pin; click again / click canvas to release.
 *
 * Readability law (ACC-PLAN guardrail): the accent only ever colors the
 * border, glow, and header — the readable CONTENT sits on a dark screen at
 * full opacity, never depending on the glass behind it.
 */

import type { CSSProperties, ReactNode } from 'react';
import { useId } from 'react';
import { setPinned, clearPinned, useIsPinned, useAnyPinned } from './focus-store';

export type AccentRole =
  | 'keyword'
  | 'fn'
  | 'struct'
  | 'const'
  | 'string'
  | 'urgent'
  | 'danger'
  | 'neutral';

const ACCENT_VAR: Record<AccentRole, string> = {
  keyword: 'var(--acc-keyword)',
  fn: 'var(--acc-fn)',
  struct: 'var(--acc-struct)',
  const: 'var(--acc-const)',
  string: 'var(--acc-string)',
  urgent: 'var(--acc-urgent)',
  danger: 'var(--acc-danger)',
  neutral: 'var(--acc-ink-dim)',
};

export interface ElementProps {
  accent: AccentRole;
  title?: ReactNode;
  headerRight?: ReactNode;
  span?: 1 | 2 | 3;
  children?: ReactNode;
  style?: CSSProperties;
  /** Interactive elements participate in hover/pin focus. Static ones (pure
   * display) can opt out and stay always-lit by passing interactive={false}. */
  interactive?: boolean;
  /** Force the active/pinned look regardless of focus state (e.g. the cash
   * strip proof, or a single-element page). */
  alwaysActive?: boolean;
}

export function Element({
  accent,
  title,
  headerRight,
  span,
  children,
  style,
  interactive = true,
  alwaysActive = false,
}: ElementProps) {
  const id = useId();
  const isPinned = useIsPinned(id);
  const anyPinned = useAnyPinned();
  const color = ACCENT_VAR[accent];

  const active = alwaysActive || isPinned;
  // When something ELSE is pinned, a resting interactive element recedes a
  // little more so the active one wins the eye.
  const recede = interactive && !active && anyPinned;

  // Inline drives the rest/active base; the :hover "lantern" is CSS (below in
  // globals.css) so it animates without React.
  const innerScreen = active ? 'rgba(15, 17, 21, 0.92)' : 'rgba(20, 22, 27, 0.55)';
  const borderPct = active ? 75 : 32;
  const glow = active
    ? `0 0 0 1px ${color}, 0 0 24px 2px color-mix(in srgb, ${color} 55%, transparent)`
    : 'none';

  const canFocus = interactive && !alwaysActive;

  return (
    <section
      data-acc-element
      data-accent={accent}
      data-active={active ? '' : undefined}
      data-interactive={canFocus ? '' : undefined}
      className="acc-element"
      role={canFocus ? 'button' : undefined}
      aria-pressed={canFocus ? active : undefined}
      tabIndex={canFocus ? 0 : undefined}
      onClick={
        canFocus
          ? (e) => {
              e.stopPropagation(); // canvas click clears; this one pins
              setPinned(id);
            }
          : undefined
      }
      onKeyDown={
        canFocus
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setPinned(id);
              } else if (e.key === 'Escape') {
                clearPinned(); // release whatever is pinned
              }
            }
          : undefined
      }
      style={
        {
          gridColumn: span ? `span ${span}` : undefined,
          borderRadius: 'var(--radius-lg)',
          padding: '1rem 1.1rem',
          // expose the accent to the CSS :hover rules
          ['--el-accent' as string]: color,
          border: `1px solid color-mix(in srgb, ${color} ${borderPct}%, transparent)`,
          background: innerScreen,
          boxShadow: glow,
          opacity: recede ? 0.7 : 1,
          transform: active ? 'translateZ(0) scale(1.012)' : 'none',
          transition: 'box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease, transform 0.18s ease',
          cursor: interactive && !alwaysActive ? 'pointer' : 'default',
          ...style,
        } as CSSProperties
      }
    >
      {(title || headerRight) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.7rem',
          }}
        >
          {title && (
            <h2
              style={{
                margin: 0,
                fontSize: '0.7rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color,
              }}
            >
              {title}
            </h2>
          )}
          {headerRight}
        </header>
      )}
      {children}
    </section>
  );
}
