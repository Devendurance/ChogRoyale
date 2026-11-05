"use client";

// A tiny external store shared by the tour and the card detail sheet.
//
// The sheet must drop its focus trap and its aria-modal promise while the tour
// is explaining the sheet, because the coach controls live outside it. Reading
// a DOM attribute during render was not reactive, so both components subscribe
// to this store instead.

import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

export function getKingdomTourActive(): boolean {
  return active;
}

export function setKingdomTourActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

export function subscribeKingdomTourActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The server snapshot is always false: a tour cannot be active before hydration. */
export function useKingdomTourActive(): boolean {
  return useSyncExternalStore(subscribeKingdomTourActive, getKingdomTourActive, () => false);
}
