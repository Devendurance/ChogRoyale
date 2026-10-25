// Shared onboarding routing. One Privy provider only (the /app layout).
// Pages map their own loaded state to a tri-state; nothing redirects while
// loading, and account switches reset because callers key on the session.
"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";

export type OnboardingGateState = "loading" | "complete" | "incomplete";

export function useOnboardingRedirect(state: OnboardingGateState): void {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (state !== "incomplete") return;
    if (pathname === "/app/onboarding") return;
    router.replace("/app/onboarding");
  }, [state, pathname, router]);
}

/**
 * Minimal authenticated onboarding state for routes that do not otherwise
 * read the player profile. Returns loading until the session and the read
 * settle, so no redirect fires early and account switches re-resolve.
 */
export function useMyOnboardingState(): OnboardingGateState {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const [state, setState] = useState<OnboardingGateState>("loading");
  useEffect(() => {
    if (!ready || !authenticated || !user) {
      setState("loading");
      return;
    }
    let cancelled = false;
    void (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;
      try {
        const res = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
        const body = (await res.json()) as {
          success: boolean;
          data?: { player: { onboarding?: { complete?: boolean } } };
        };
        if (!cancelled) setState(body.success && body.data ? (body.data.player.onboarding?.complete === true ? "complete" : "incomplete") : "loading");
      } catch {
        if (!cancelled) setState("loading");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user, getAccessToken]);
  return state;
}
