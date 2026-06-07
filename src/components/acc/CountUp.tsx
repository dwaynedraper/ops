'use client';

/**
 * CountUp — a number counting up when a value lands (ACC-PLAN 6D-4).
 *
 * Server-renders the FINAL formatted value (no layout shift, works without
 * JS), then on mount tweens 0 → value with GSAP (lazy-loaded). Reduced
 * motion, or a zero value, just shows the number — no theater.
 *
 * Format is by name (not a function prop) so server components can use it.
 */

import { useEffect, useRef } from 'react';
import { fmtMoney } from '@/lib/pricing';
import { loadGsap, reducedMotion } from './motion';

export interface CountUpProps {
  value: number;
  /** 'money' → fmtMoney (whole dollars) · 'money-cents' → fmtMoney with
   * cents · 'int' → plain integer */
  format?: 'money' | 'money-cents' | 'int';
  prefix?: string;
  /** seconds; the land matters more than the journey — keep it brisk */
  duration?: number;
}

function fmt(n: number, format: CountUpProps['format']): string {
  if (format === 'money') return fmtMoney(Math.round(n));
  if (format === 'money-cents') return fmtMoney(n, { cents: true });
  return String(Math.round(n));
}

export function CountUp({ value, format = 'money', prefix = '', duration = 0.9 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === 0 || reducedMotion()) return;

    let tween: { kill(): void } | undefined;
    let cancelled = false;

    loadGsap().then((gsap) => {
      if (cancelled || !ref.current) return;
      const counter = { n: 0 };
      tween = gsap.to(counter, {
        n: value,
        duration,
        ease: 'power3.out',
        onUpdate: () => {
          if (ref.current) ref.current.textContent = prefix + fmt(counter.n, format);
        },
        onComplete: () => {
          // land EXACTLY on the true formatted value, never a rounded ghost
          if (ref.current) ref.current.textContent = prefix + fmt(value, format);
        },
      });
    });

    return () => {
      cancelled = true;
      tween?.kill();
      // if the value re-renders mid-tween, snap to truth
      if (el) el.textContent = prefix + fmt(value, format);
    };
  }, [value, format, prefix, duration]);

  return <span ref={ref}>{prefix + fmt(value, format)}</span>;
}
