"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BattlePanel } from "@/app/dev/battle/BattlePanel";
import { useMyOnboardingState, useOnboardingRedirect } from "@/components/app/use-onboarding-redirect";
import { TUTORIAL_CAMP_PATH, isTutorialStage } from "@/lib/tutorial-camp";

export default function TrainingBattleRoute() {
  const params = useSearchParams();
  const onboarding = useMyOnboardingState();
  useOnboardingRedirect(onboarding, null);
  const stage = Number(params.get("stage"));
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
  return <BattlePanel key={`training:${stage}`} publicMode initialMode="practice" tutorialStage={stage} setupReady={onboarding === "complete"} />;
}
