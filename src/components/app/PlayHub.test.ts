import { describe, expect, it } from "vitest";
import { PLAYER_BATTLE_HREFS, PRACTICE_ENTRY } from "./play-hub-model";

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
});
