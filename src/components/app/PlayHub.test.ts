import { describe, expect, it } from "vitest";
import { PLAYER_BATTLE_HREFS, PRACTICE_ENTRY, tutorialLocksBattleModes } from "./play-hub-model";
import type { TutorialAccess, TutorialProgressView } from "@/lib/tutorial-camp";

const tutorial = (access: TutorialAccess): TutorialProgressView => ({
  stage: access === "training-required" ? 1 : 3,
  completedStages: access === "training-required" ? 1 : 3,
  graduated: access === "graduated",
  grandfathered: access === "grandfathered",
  nextStage: access === "training-required" ? 2 : null,
  enforcement: access !== "gate-off",
  access,
});

describe("player battle hub practice entry", () => {
  it("offers Practice with an AI opponent and the no-reward copy", () => {
    expect(PRACTICE_ENTRY).toMatchObject({ label: "Practice Arena", action: "Start Practice", opponent: "AI Opponent" });
    expect(PRACTICE_ENTRY.detail).toContain("no rewards");
    expect(PLAYER_BATTLE_HREFS.practice).toBe("/app/play/battle?mode=practice");
  });

  it("keeps the existing human modes and ranked closure alongside Practice", () => {
    expect(PLAYER_BATTLE_HREFS.unranked).toBe("/app/play/battle?mode=unranked");
    expect(PLAYER_BATTLE_HREFS.private).toBe("/app/play/battle?mode=private");
    expect(PLAYER_BATTLE_HREFS).not.toHaveProperty("ranked");
  });

  it("locks UI modes only for an actual training-required server decision", () => {
    expect(tutorialLocksBattleModes(tutorial("training-required"))).toBe(true);
    for (const access of ["gate-off", "no-release", "schema-unavailable", "graduated", "grandfathered"] as const) {
      expect(tutorialLocksBattleModes(tutorial(access))).toBe(false);
    }
    expect(tutorialLocksBattleModes(null)).toBe(false);
  });
});
