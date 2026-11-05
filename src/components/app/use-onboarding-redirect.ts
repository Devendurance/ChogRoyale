// Shared onboarding routing. One Privy provider only (the /app layout).
// Pages map their own loaded state to a tri-state; nothing redirects while
// loading, and account switches reset because callers key on the session.
"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";

export type OnboardingGateState = "loading" | "complete" | "incomplete" | "unavailable";

/** Pure so the one-redirect-per-reading rule is testable. */
export function onboardingRedirectStep(state: OnboardingGateState, pathname: string, redirected: boolean): { go: boolean; redirected: boolean } {
  if (state !== "incomplete") return { go: false, redirected: false };
  if (pathname === "/app/onboarding" || redirected) return { go: false, redirected };
  return { go: true, redirected: true };
}

export function useOnboardingRedirect(state: OnboardingGateState, inviteReturn: string | null = null): void {
  const router = useRouter();
  const pathname = usePathname();
  // Cache Components keeps a left route mounted but hidden. Its effects rerun
  // when it is revealed, still holding the "incomplete" snapshot it left with.
  // Redirecting on that snapshot bounces a finished player back to setup, and
  // setup sends them forward again, which loops until the browser rejects the
  // history calls. One redirect per incomplete reading, so a route has to see
  // a new read before it can redirect again.
  const redirected = useRef(false);
  useEffect(() => {
    const step = onboardingRedirectStep(state, pathname, redirected.current);
    redirected.current = step.redirected;
    if (!step.go) return;
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
  const userId = user?.id ?? null;
  const sessionKey = ready && authenticated ? userId : null;
  const [result, setResult] = useState<{ sessionKey: string; state: OnboardingGateState } | null>(null);
  useEffect(() => {
    if (!ready || !authenticated || !userId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (cancelled) return;
        if (!token) { setResult({ sessionKey: userId, state: "unavailable" }); return; }
        const res = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
        const body = (await res.json()) as {
          success: boolean;
          data?: { player: { onboarding?: { complete?: boolean } } };
        };
        if (!cancelled) setResult({ sessionKey: userId, state: res.status === 404 ? "incomplete" : body.success && body.data?.player ? (body.data.player.onboarding?.complete === true ? "complete" : "incomplete") : "unavailable" });
      } catch {
        if (!cancelled) setResult({ sessionKey: userId, state: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
      // Hidden routes rerun this effect on reveal. Forget the old answer so the
      // route waits for the new read instead of acting on a stale one.
      setResult(null);
    };
  }, [ready, authenticated, userId, getAccessToken]);
  return sessionKey && result?.sessionKey === sessionKey ? result.state : "loading";
}
