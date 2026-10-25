import { Suspense } from "react";
import OnboardingScreen from "@/components/app/OnboardingScreen";

export default function AppOnboardingPage() {
  return (
    <Suspense fallback={<main className="app-stage app-stage--gate"><p className="app-play-battle-state">Opening setup…</p></main>}>
      <OnboardingScreen />
    </Suspense>
  );
}
