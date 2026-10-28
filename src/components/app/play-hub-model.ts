/** Player-facing battle links. Keep these URLs in one place so a mode card
 * cannot drift from the route parser. */
export const PLAYER_BATTLE_HREFS = {
  practice: "/app/play/battle?mode=practice",
  unranked: "/app/play/battle?mode=unranked",
  private: "/app/play/battle?mode=private",
} as const;

export const PRACTICE_ENTRY = {
  label: "Practice Arena",
  action: "Start Practice",
  opponent: "AI Opponent",
  detail: "Practice has no rewards yet.",
} as const;
