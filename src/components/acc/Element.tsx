'use client';

/**
 * Element — the ACC glass-widget primitive (ACC-PLAN §4b/§5).
 *
 * Three states, ONE accent role. ALL state styling lives in CSS
 * (.acc-element in globals.css) — the component only hands CSS the accent
 * (via --el-accent) and the current state (via data-* attributes). This is
 * deliberate: inline styles beat CSS :hover, so if the base look were inline
 * the lantern hover could never fire. Keep it in CSS.
 *
 *   • Rest   — GLASS, COLORLESS. Real frosted blur over the wallpaper, a
 *              faint neutral edge, no hue, no glow. This is the whole point:
 *              the colorlessness tells Dean's brain "not important right now."
 *              Selectable any time.
 *   • Hover  — THE LANTERN. The accent begins to bleed in: edge tints, a soft
 *              glow lifts, the title takes the hue. A wake, not a selection —
 *              fades the instant the mouse leaves. Pure CSS.
 *   • Pinned — ACTIVE. Full accent edge + bright glow + near-opaque screen +
 *              slight grow + the title in full color. The cash-strip look.
 *              Click to pin; click again / click canvas / Esc to release.
 */

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { setPinned, clearPinned, useIsPinned, useAnyPinned } from './focus-store';
import { loadGsap, reducedMotion } from './motion';

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
  /** Interactive elements participate in hover/pin focus. Static display-only
   * ones can opt out with interactive={false}. */
  interactive?: boolean;
  /** Force the active look regardless of focus state (single-element pages). */
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
  const canFocus = interactive && !alwaysActive;
  // When something ELSE is pinned, a resting interactive element recedes a
  // little further so the active one wins the eye.
  const recede = interactive && !active && anyPinned;

  // ── 6D-4: the WAKE — a tiny GSAP overshoot when a panel is pinned. ──
  // GSAP is lazy-loaded on the first pin (never blocks paint); reduced
  // motion skips it entirely and the CSS color/glow transition carries the
  // state change alone. The end scale matches the CSS [data-active] value,
  // so with or without GSAP the panel settles in the same place.
  const sectionRef = useRef<HTMLElement>(null);
  const wasPinned = useRef(false);
  useEffect(() => {
    const was = wasPinned.current;
    wasPinned.current = isPinned;
    if (was === isPinned || reducedMotion()) return;
    loadGsap().then((gsap) => {
      const el = sectionRef.current;
      if (!el) return;
      if (isPinned) {
        // wake: overshoot past the resting-active scale, settle back
        gsap.fromTo(
          el,
          { scale: 1 },
          { scale: 1.012, duration: 0.45, ease: 'back.out(2.8)', overwrite: 'auto' },
        );
      } else {
        // release: ease home, then hand the transform back to CSS
        gsap.to(el, {
          scale: 1,
          duration: 0.2,
          ease: 'power2.out',
          overwrite: 'auto',
          onComplete: () => {
            if (sectionRef.current) gsap.set(sectionRef.current, { clearProps: 'transform' });
          },
        });
      }
    });
  }, [isPinned]);

  return (
    <section
      ref={sectionRef}
      data-acc-element
      data-accent={accent}
      data-active={active ? '' : undefined}
      data-interactive={canFocus ? '' : undefined}
      data-recede={recede ? '' : undefined}
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
                clearPinned();
              }
            }
          : undefined
      }
      style={
        {
          gridColumn: span ? `span ${span}` : undefined,
          ['--el-accent' as string]: color,
          ...style,
        } as CSSProperties
      }
    >
      {(title || headerRight) && (
        <header className="acc-element-header">
          {title && <h2 className="acc-element-title">{title}</h2>}
          {headerRight}
        </header>
      )}
      {children}
    </section>
  );
}
