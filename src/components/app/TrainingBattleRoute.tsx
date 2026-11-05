"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BattlePanel, readResume } from "@/app/dev/battle/BattlePanel";
import { useMyOnboardingState, useOnboardingRedirect } from "@/components/app/use-onboarding-redirect";
import { useTutorialAccess } from "@/components/app/use-tutorial-access";
import { TUTORIAL_CAMP_PATH, isTutorialStage, tutorialStageRouteAllowed } from "@/lib/tutorial-camp";

export default function TrainingBattleRoute() {
  const params = useSearchParams();
  const onboarding = useMyOnboardingState();
  useOnboardingRedirect(onboarding, null);
  const router = useRouter();
  const stage = Number(params.get("stage"));
  const { read, retry } = useTutorialAccess(onboarding === "complete");
  // A hand-written or stale stage URL returns to the camp without opening a
  // room. The battle room still checks stage order itself.
  const blocked = read.state === "ready" && isTutorialStage(stage) && !tutorialStageRouteAllowed(read.tutorial, stage);
  useEffect(() => {
    if (blocked) router.replace(TUTORIAL_CAMP_PATH);
  }, [blocked, router]);

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
  // A seat waiting to reconnect stays recoverable through a failed progress read.
  if ((read.state === "unavailable" || read.state === "locked") && !readResume("practice")) {
    return (
      <main className="app-stage app-stage--gate">
        <div className="app-column app-column--gate">
          <div className="app-panel app-gate" data-testid="training-route-recovery">
            <h1 className="app-gate__title">Training Camp is unavailable</h1>
            <p className="app-gate__lead" role="alert">We couldn&apos;t check your lesson progress. Nothing was lost.</p>
            <button type="button" className="app-btn app-btn--battle" onClick={retry}>Try again</button>
            <Link href={TUTORIAL_CAMP_PATH} className="app-btn app-btn--ghost">Back to Training Camp</Link>
          </div>
        </div>
      </main>
    );
  }
  return <BattlePanel key={`training:${stage}`} publicMode initialMode="practice" tutorialStage={stage} setupReady={onboarding === "complete" && read.state !== "loading"} />;
}
