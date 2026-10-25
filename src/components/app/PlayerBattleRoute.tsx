"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BattlePanel } from "@/app/dev/battle/BattlePanel";
import { RANKED_PUBLIC_MATCHMAKING_ENABLED } from "@/lib/ranked";
import { useMyOnboardingState, useOnboardingRedirect } from "@/components/app/use-onboarding-redirect";

export default function PlayerBattleRoute() {
  useOnboardingRedirect(useMyOnboardingState());
  const params = useSearchParams();
  const raw = params.get("mode");
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
  const initialMode = raw === "private" ? "private" : raw === "ranked" ? "ranked" : "unranked";
  return <BattlePanel publicMode initialMode={initialMode} />;
}
