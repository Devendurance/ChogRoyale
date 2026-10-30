"use client";

import { useCallback, useSyncExternalStore } from "react";

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function mediaQuery(query: string): LegacyMediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

export function subscribeMediaQuery(query: string, onChange: () => void): () => void {
  const media = mediaQuery(query);
  if (!media) return () => undefined;
  const listener = () => onChange();
  if (typeof media.addEventListener === "function") media.addEventListener("change", listener);
  else media.addListener?.(listener);
  return () => {
    if (typeof media.removeEventListener === "function") media.removeEventListener("change", listener);
    else media.removeListener?.(listener);
  };
}

export function mediaQueryMatches(query: string): boolean {
  return mediaQuery(query)?.matches ?? false;
}

export function useMedia(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeMediaQuery(query, onChange),
    [query]
  );
  return useSyncExternalStore(subscribe, () => mediaQueryMatches(query), () => false);
}

const noSubscribe = () => () => {};

export function useSaveData() {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      if (typeof navigator === "undefined") return false;
      try {
        return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
      } catch {
        return false;
      }
    },
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
