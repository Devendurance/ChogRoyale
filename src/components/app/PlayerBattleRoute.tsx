"use client";

import { useSearchParams } from "next/navigation";
import { BattlePanel } from "@/app/dev/battle/BattlePanel";

export default function PlayerBattleRoute() {
  const params = useSearchParams();
  const raw = params.get("mode");
  // Ranked resolves here so the queue contract exists end to end, but the
  // Play Hub never links it: the panel renders an unavailable note instead
  // of a queue button until the rating/trophy pipeline lands in P1b.2.
  const initialMode = raw === "private" ? "private" : raw === "ranked" ? "ranked" : "unranked";
  return <BattlePanel publicMode initialMode={initialMode} />;
}
