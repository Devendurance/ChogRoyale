// The one authenticated read of server-owned Training Camp access for route
// decisions. It never infers progress: a failed read is reported as failed.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { TutorialProgressView } from "@/lib/tutorial-camp";

export type TutorialRead =
  | { state: "session" }
  | { state: "locked"; message: string }
  | { state: "unavailable"; message: string }
  | { state: "ready"; tutorial: TutorialProgressView };

export type TutorialAccessState = TutorialRead | { state: "loading" };

export async function readTutorialProgress(token: string, fetcher: typeof fetch = fetch): Promise<TutorialRead> {
  try {
    const response = await fetcher("/api/players/me/tutorial", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: { tutorial?: TutorialProgressView }; error?: { message?: string } }
      | null;
    if (response.status === 401) return { state: "session" };
    if (response.status === 403) return { state: "locked", message: "Finish your player profile setup to open Training Camp." };
    if (!response.ok || !body?.success || !body.data?.tutorial) {
      return { state: "unavailable", message: body?.error?.message ?? "Training Camp progress could not be loaded." };
    }
    return { state: "ready", tutorial: body.data.tutorial };
  } catch {
    return { state: "unavailable", message: "Training Camp progress could not be loaded. Check your connection and try again." };
  }
}

/**
 * Reads access once per visit and per Privy account. Hidden routes rerun the
 * effect on reveal, so a mandatory answer is always read again before it is
 * used. An answer that is not mandatory can't become mandatory again, so it is
 * kept and returning to a route doesn't flash a loading gate.
 */
export function useTutorialAccess(enabled: boolean): { read: TutorialAccessState; retry: () => void } {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const sessionKey = ready && authenticated ? user?.id ?? null : null;
  const [result, setResult] = useState<{ sessionKey: string; read: TutorialRead } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const settledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionKey || settledFor.current === sessionKey) return;
    let cancelled = false;
    void (async () => {
      let read: TutorialRead;
      try {
        const token = await getAccessToken();
        if (cancelled) return;
        read = token ? await readTutorialProgress(token) : { state: "session" };
      } catch {
        read = { state: "unavailable", message: "Training Camp progress could not be loaded." };
      }
      if (cancelled) return;
      if (read.state === "ready" && read.tutorial.access !== "training-required") settledFor.current = sessionKey;
      setResult({ sessionKey, read });
    })();
    return () => {
      cancelled = true;
      if (settledFor.current !== sessionKey) setResult(null);
    };
  }, [enabled, sessionKey, getAccessToken, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const read: TutorialAccessState = enabled && sessionKey && result?.sessionKey === sessionKey ? result.read : { state: "loading" };
  return { read, retry };
}
