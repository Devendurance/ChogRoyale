"use client";

import { battleInvitePath, hasMatchingInviteResume, validRoomCode } from "@/lib/battle-invite";
import Link from "next/link";
import { useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSearchParams } from "next/navigation";
import { BattlePanel, readResume } from "@/app/dev/battle/BattlePanel";
import { RANKED_PUBLIC_MATCHMAKING_ENABLED } from "@/lib/ranked";
import { useMyOnboardingState, useOnboardingRedirect } from "@/components/app/use-onboarding-redirect";
import { useTutorialAccess } from "@/components/app/use-tutorial-access";
import { TUTORIAL_CAMP_PATH, tutorialProgressLabel } from "@/lib/tutorial-camp";
import BattleRouteRecoveryPanel from "./BattleRouteRecoveryPanel";
import { tutorialLocksBattleModes } from "./play-hub-model";
import { battleRouteAccess, resolvePlayerBattleMode } from "./player-battle-route-model";

export { resolvePlayerBattleMode } from "./player-battle-route-model";
export type { PlayerBattleMode } from "./player-battle-route-model";

export default function PlayerBattleRoute() {
  const params = useSearchParams();
  const onboarding = useMyOnboardingState();
  const room = params.get("mode") === "private" ? validRoomCode(params.get("room")) : null;
  useOnboardingRedirect(onboarding, room ? battleInvitePath(room) : null);
  const { read: tutorialRead, retry } = useTutorialAccess(onboarding === "complete");
  const { logout } = usePrivy();
  const raw = params.get("mode");
  const initialMode = resolvePlayerBattleMode(raw);
  // Decided once per read, because a match clears this slot when it ends and
  // that must not swap the result screen for a gate.
  const hasSeat = useMemo(() => {
    if (tutorialRead.state === "loading") return false;
    const stored = readResume(initialMode);
    return Boolean(stored && (!room || hasMatchingInviteResume(room, stored)));
  }, [tutorialRead.state, initialMode, room]);
  // The player route never mounts the battle session for ranked. This keeps a
  // hand-written URL from turning the existing ranked queue contract into a
  // public activation bypass while production gates are still closed.
  if (raw === "ranked" && !RANKED_PUBLIC_MATCHMAKING_ENABLED) {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate app-rise">
            <span className="app-gate__mark" aria-hidden="true">✦</span>
            <h1 className="app-gate__title">Ranked is closed</h1>
            <p className="app-gate__lead">Season 1 standings are read-only while public ranked matchmaking, settlement and deployment remain gated.</p>
            <Link href="/app/play" className="app-btn app-btn--battle">Back to battle hall</Link>
          </div>
        </div>
      </main>
    );
  }
  if (onboarding === "unavailable") {
    return <main className="app-stage app-stage--gate"><div className="app-column app-column--gate"><section className="app-panel app-gate">
      <h1 className="app-gate__title">Player setup unavailable</h1>
      <p className="app-gate__lead" role="alert">We couldn&apos;t check your player setup. Your invitation is still in this address.</p>
      <button type="button" className="app-btn app-btn--battle" onClick={() => window.location.reload()}>Try again</button>
      <Link href="/app/play" className="app-btn app-btn--ghost">Back to battle hall</Link>
    </section></div></main>;
  }
  const access = battleRouteAccess(tutorialRead, tutorialRead.state === "ready" && tutorialLocksBattleModes(tutorialRead.tutorial), hasSeat);
  const recovery = access.recovery && (
    <BattleRouteRecoveryPanel
      recovery={access.recovery}
      progress={tutorialRead.state === "ready" ? tutorialProgressLabel(tutorialRead.tutorial.completedStages) : null}
      invite={room !== null}
      backHref={access.recovery === "training-required" ? TUTORIAL_CAMP_PATH : "/app/play"}
      backLabel={access.recovery === "training-required" ? "Continue Training" : "Back to battle hall"}
      onRetry={retry}
      onSignIn={() => void logout()}
    />
  );
  if (!access.mountPanel) return recovery;
  return <BattlePanel key={`${initialMode}:${params.get("room") ?? ""}`} publicMode initialMode={initialMode} initialRoom={room} invalidInvite={params.has("room") && !room} setupReady={onboarding === "complete" && access.setupReady} resumeOnlyFallback={recovery || undefined} />;
}
