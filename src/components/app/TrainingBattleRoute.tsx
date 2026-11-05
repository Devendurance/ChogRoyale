"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { BattlePanel, readResume } from "@/app/dev/battle/BattlePanel";
import { useMyOnboardingState, useOnboardingRedirect } from "@/components/app/use-onboarding-redirect";
import { useTutorialAccess } from "@/components/app/use-tutorial-access";
import BattleRouteRecoveryPanel from "@/components/app/BattleRouteRecoveryPanel";
import { battleRouteAccess } from "@/components/app/player-battle-route-model";
import { TUTORIAL_CAMP_PATH, isTutorialStage, tutorialStageRouteAllowed } from "@/lib/tutorial-camp";

export default function TrainingBattleRoute() {
  const params = useSearchParams();
  const onboarding = useMyOnboardingState();
  useOnboardingRedirect(onboarding, null);
  const router = useRouter();
  const stage = Number(params.get("stage"));
  const { read, retry } = useTutorialAccess(onboarding === "complete");
  const { logout } = usePrivy();
  // A hand-written or stale stage URL returns to the camp without opening a
  // room. The battle room still checks stage order itself.
  const blocked = read.state === "ready" && isTutorialStage(stage) && !tutorialStageRouteAllowed(read.tutorial, stage);
  useEffect(() => {
    if (blocked) router.replace(TUTORIAL_CAMP_PATH);
  }, [blocked, router]);

  // Decided once per read, so the end of a lesson can't swap its screen for a gate.
  const hasSeat = useMemo(() => read.state !== "loading" && readResume("practice") !== null, [read.state]);

  if (!isTutorialStage(stage)) {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate">
            <h1 className="app-gate__title">Training battle not found</h1>
            <p className="app-gate__lead">That lesson is not part of Training Camp. Open the camp to pick an available battle.</p>
            <Link href={TUTORIAL_CAMP_PATH} className="app-btn app-btn--battle">Back to Training Camp</Link>
          </div>
        </div>
      </main>
    );
  }
  if (blocked) {
    return <main className="app-stage app-stage--gate"><p className="app-play-battle-state" role="status">Returning to Training Camp…</p></main>;
  }
  const recoveryPanel = (kind: "retry" | "sign-in", onRetry: () => void = retry) => (
    <BattleRouteRecoveryPanel recovery={kind} backHref={TUTORIAL_CAMP_PATH} backLabel="Back to Training Camp" onRetry={onRetry} onSignIn={() => void logout()} />
  );
  if (onboarding === "unavailable") return recoveryPanel("retry", () => window.location.reload());
  // Stage order was checked above, so a ready read never locks this route.
  const access = battleRouteAccess(read, false, hasSeat);
  const recovery = access.recovery === "retry" || access.recovery === "sign-in" ? recoveryPanel(access.recovery) : undefined;
  if (!access.mountPanel) return recovery;
  return <BattlePanel key={`training:${stage}`} publicMode initialMode="practice" tutorialStage={stage} setupReady={onboarding === "complete" && access.setupReady} resumeOnlyFallback={recovery} />;
}
