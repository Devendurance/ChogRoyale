// Shared onboarding routing. One Privy provider only (the /app layout).
// Pages map their own loaded state to a tri-state; nothing redirects while
// loading, and account switches reset because callers key on the session.
"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";

export type OnboardingGateState = "loading" | "complete" | "incomplete" | "unavailable";

export function useOnboardingRedirect(state: OnboardingGateState, inviteReturn: string | null = null): void {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (state !== "incomplete") return;
    if (pathname === "/app/onboarding") return;
    router.replace(inviteReturn ? `/app/onboarding?invite=${encodeURIComponent(inviteReturn)}` : "/app/onboarding");
  }, [state, pathname, router, inviteReturn]);
}

/**
 * Minimal authenticated onboarding state for routes that do not otherwise
 * read the player profile. Returns loading until the session and the read
 * settle, so no redirect fires early and account switches re-resolve.
 */
export function useMyOnboardingState(): OnboardingGateState {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const sessionKey = ready && authenticated ? user?.id ?? null : null;
  const [result, setResult] = useState<{ sessionKey: string; state: OnboardingGateState } | null>(null);
  useEffect(() => {
    if (!ready || !authenticated || !user) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (cancelled) return;
        if (!token) { setResult({ sessionKey: user.id, state: "unavailable" }); return; }
        const res = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
        const body = (await res.json()) as {
          success: boolean;
          data?: { player: { onboarding?: { complete?: boolean } } };
        };
        if (!cancelled) setResult({ sessionKey: user.id, state: res.status === 404 ? "incomplete" : body.success && body.data?.player ? (body.data.player.onboarding?.complete === true ? "complete" : "incomplete") : "unavailable" });
      } catch {
        if (!cancelled) setResult({ sessionKey: user.id, state: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user, getAccessToken]);
  return sessionKey && result?.sessionKey === sessionKey ? result.state : "loading";
}
