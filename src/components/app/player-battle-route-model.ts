export type PlayerBattleMode = "private" | "unranked" | "ranked" | "practice";

/** Map the player-facing URL to the server-owned battle mode. Unknown modes
 * keep the existing casual default instead of opening a new queue. */
export function resolvePlayerBattleMode(raw: string | null): PlayerBattleMode {
  if (raw === "private" || raw === "ranked" || raw === "practice") return raw;
  return "unranked";
}
