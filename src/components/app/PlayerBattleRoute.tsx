"use client";

import { useSearchParams } from "next/navigation";
import { BattlePanel } from "@/app/dev/battle/BattlePanel";

export default function PlayerBattleRoute() {
  const params = useSearchParams();
  const initialMode = params.get("mode") === "private" ? "private" : "unranked";
  return <BattlePanel publicMode initialMode={initialMode} />;
}
