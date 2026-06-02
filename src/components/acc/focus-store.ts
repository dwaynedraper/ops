'use client';

/**
 * ACC focus store (6D-2) — which Element is pinned "active".
 *
 * Module-level + useSyncExternalStore, the same pattern as the theme store:
 * one pinned id at a time, shared across every Element without prop-drilling.
 * Click an element to pin it (full color + glow + grow); click it again or
 * click empty canvas to release; clicking another moves the pin.
 *
 * Hover ("the lantern") is pure CSS on the element itself — not state — so it
 * stays GPU-cheap and never triggers React renders. Only the pin lives here.
 */

import { useSyncExternalStore } from 'react';

let pinnedId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Pin an id (or toggle off if it's already pinned). */
export function setPinned(id: string | null): void {
  pinnedId = pinnedId === id ? null : id;
  emit();
}

/** Release any pin — wired to a canvas-level click. */
export function clearPinned(): void {
  if (pinnedId !== null) {
    pinnedId = null;
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function snapshot(): string | null {
  return pinnedId;
}
function serverSnapshot(): string | null {
  return null; // nothing pinned on the server / first paint
}

/** True when this id is the pinned (active) element. */
export function useIsPinned(id: string): boolean {
  const pinned = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return pinned === id;
}

/** Whether ANYTHING is pinned (lets resting elements dim slightly when one
 * is active, so the active one stands out more). */
export function useAnyPinned(): boolean {
  const pinned = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return pinned !== null;
}
