import { Suspense } from "react";
import TrainingBattleRoute from "@/components/app/TrainingBattleRoute";

export default function TrainingBattlePage() {
  return (
    <Suspense fallback={<main className="app-stage app-stage--gate"><p className="app-play-battle-state">Opening your training battle…</p></main>}>
      <TrainingBattleRoute />
    </Suspense>
  );
}
