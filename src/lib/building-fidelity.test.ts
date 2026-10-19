// B2.8a building targeting fidelity (ruleset v15, no rules change). Full
// smart-bot matches against the building-counter deck: whenever an enemy
// deployable building is in a Riftbreaker's sight, the Riftbreaker must be
// targeting an enemy building that tick (demolition priority, never stuck on
// a tower or troop lock).

import { describe, it, expect } from "vitest";
import { initMatch, stepMatch, type CombatCommand } from "@/lib/combat";
import { botMatch, deckWith, riftSchedule, scenarioConfig } from "@/lib/arena-scenarios";
import { smartMove } from "@/lib/smart-bot";

const SPAWNER = deckWith("chog_burrow", "chog_guardian", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt", "cmdr:free-warden");
const BUILDING_COUNTER = deckWith("riftbreaker", "chaos_comet", "rift_sentry", "gale_netter", "chog_guardian", "chaos_archer", "sparkcaster", "cmdr:free-scout");

describe("B2.8a Riftbreaker building priority in full matches", () => {
  it("targets an enemy building on every tick one is in sight, on both seats", () => {
    let inSight = 0;
    for (const [seat, seed] of [[0, "c1"], [1, "c2"]] as const) {
      const decks: [string[], string[]] = seat === 0 ? [SPAWNER, BUILDING_COUNTER] : [BUILDING_COUNTER, SPAWNER];
      const cfg = () => scenarioConfig(decks[0], decks[1], riftSchedule(seed), seed);
      const { commands } = botMatch(cfg(), 3100, 20, { policies: [smartMove, smartMove] });
      const s = initMatch(cfg());
      while (s.phase !== "final") {
        stepMatch(s, (commands as CombatCommand[]).filter((c) => c.tick === s.tick + 1));
        for (const t of s.troops) {
          if (t.cardId !== "riftbreaker") continue;
          const enemy = s.buildings.filter((b) => b.alive && b.owner !== t.owner);
          if (!enemy.some((b) => (b.x - t.x) ** 2 + (b.y - t.y) ** 2 <= t.sight * t.sight)) continue;
          inSight += 1;
          expect(enemy.some((b) => b.id === t.targetId)).toBe(true);
        }
      }
    }
    expect(inSight).toBeGreaterThan(50);
  }, 60_000);
});
