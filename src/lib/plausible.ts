/**
 * Thin wrapper around the Plausible custom-event API.
 *
 * Pageviews fire automatically from the script mounted in
 * `src/app/layout.tsx` (gated on `NEXT_PUBLIC_PLAUSIBLE_SCRIPT`). This
 * helper is for the moments where we want to attribute a discrete
 * action — "qualified a prospect", "closed a quote", "opened the
 * morning digest", and so on — without coupling components to the
 * Plausible global directly.
 *
 * Safe to call from any client component:
 *   - On the server, `window` is undefined and the call is a no-op.
 *   - In production without the env var set, the global doesn't exist
 *     and the call is a no-op.
 *   - Errors inside Plausible itself are swallowed; we never let
 *     analytics break a user interaction.
 *
 * Pattern mirrors `landing/src/lib/plausible.ts` and the sister sites,
 * so a future shared package extraction is straightforward.
 */

type PlausibleProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: PlausibleProps }) => void;
  }
}

export function plausible(event: string, options?: { props?: PlausibleProps }) {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible !== 'function') return;
  try {
    window.plausible(event, options);
  } catch {
    // Never let analytics break a user interaction.
  }
}
