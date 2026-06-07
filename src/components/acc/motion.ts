'use client';

/**
 * ACC motion kit (6D-4) — GSAP, lazy-loaded, only where it earns it.
 *
 * Hard rules (ACC-PLAN 6D-4):
 *   • GSAP never blocks first paint — dynamic import on first use, cached.
 *   • Only two jobs: the panel WAKE on pin, and numbers COUNTING UP when a
 *     value lands. Everything else stays CSS.
 *   • prefers-reduced-motion → no GSAP at all; CSS fallbacks carry the state.
 *   • Smooth + responsive > flourish. If it ever janks, cut it.
 */

let gsapPromise: Promise<typeof import('gsap').gsap> | null = null;

/** Lazy, cached GSAP. First call kicks off the import; later calls reuse. */
export function loadGsap(): Promise<typeof import('gsap').gsap> {
  gsapPromise ??= import('gsap').then((m) => m.gsap);
  return gsapPromise;
}

/** True when the user asked the OS for less motion. Checked at call time so
 * a mid-session OS change is respected on the next animation. */
export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
