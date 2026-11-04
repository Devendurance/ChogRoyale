/** Player-facing battle links. Keep these URLs in one place so a mode card
 * cannot drift from the route parser. */
import type { TutorialProgressView } from "@/lib/tutorial-camp";

export const PLAYER_BATTLE_HREFS = {
  practice: "/app/play/battle?mode=practice",
  unranked: "/app/play/battle?mode=unranked",
  private: "/app/play/battle?mode=private",
} as const;

/** UI lock only when the server says admission is actually training-gated.
 * Gate-off, missing-release, schema-unavailable, graduation and grandfathering
 * all keep the existing authorized modes visible. */
export function tutorialLocksBattleModes(tutorial: TutorialProgressView | null | undefined): boolean {
  return tutorial?.access === "training-required";
}

export const PRACTICE_ENTRY = {
  label: "Practice Arena",
  action: "Start Practice",
  opponent: "AI Opponent",
  detail: "Practice has no rewards yet.",
} as const;
