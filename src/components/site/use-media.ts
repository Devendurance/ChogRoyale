"use client";

import { useCallback, useSyncExternalStore } from "react";

export function useMedia(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

const noSubscribe = () => () => {};

export function useSaveData() {
  return useSyncExternalStore(
    noSubscribe,
    () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData,
    () => false
  );
}

/**
 * True once React has hydrated. The server snapshot is false and the client
 * snapshot is true, so the first client render matches the server HTML and
 * the next one carries the real value.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
}
