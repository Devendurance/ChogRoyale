import { Suspense } from "react";
import PlayerBattleRoute from "@/components/app/PlayerBattleRoute";

export default function PlayerBattlePage() {
  return (
    <Suspense fallback={<main className="app-stage app-stage--gate"><p className="app-play-battle-state">Opening the battle room…</p></main>}>
      <PlayerBattleRoute />
    </Suspense>
  );
}
