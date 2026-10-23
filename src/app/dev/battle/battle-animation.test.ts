import { describe, expect, it } from "vitest";
import type { BattleFrame } from "@/lib/battle-protocol";
import { battleAnimationCues, interpolateBattlePosition, takeUnseenBattleAnimationCues } from "./battle-animation";

const frame = (overrides: Partial<BattleFrame> = {}): BattleFrame => ({
  tick: 10,
  phase: "active",
  clockTicks: 10,
  crowns: [0, 0],
  energy: 5,
  energyProgress: 0,
  regenMult: 1,
  hand: [],
  next: null,
  abilities: [],
  troops: [],
  commanders: [],
  structures: [],
  buildings: [],
  projectiles: [],
  impacts: [],
  chaos: [],
  riftOpen: false,
  events: [],
  ...overrides,
});
describe("battle presentation animation cues", () => {
  it("maps authoritative spawn, attack and death events", () => {
    const cues = battleAnimationCues(frame({
      events: [
        { type: "deploy", tick: 10, player: 0, cardId: "choglings", entityIds: ["t0-1", "t0-2"] },
        { type: "tower_fired", tick: 10, structureId: "s1", owner: 1, targetId: "t0-1", x: 20, y: 20 },
        { type: "death", tick: 10, entityId: "t0-2", owner: 0 },
      ],
    }), null);
    expect(cues.map((cue) => [cue.kind, cue.entityId])).toEqual([
      ["spawn", "t0-1"],
      ["spawn", "t0-2"],
      ["attack", "s1"],
      ["death", "t0-2"],
    ]);
    expect(cues[2]?.targetId).toBe("t0-1");
  });

  it("derives a hit only from a real authoritative HP drop and deduplicates keys", () => {
    const previous = frame({ tick: 9, troops: [{ id: "t0-1", owner: 0, cardId: "choglings", x: 4, y: 4, hp: 60, maxHp: 60, air: false, shield: 0 }] });
    const current = frame({ troops: [{ id: "t0-1", owner: 0, cardId: "choglings", x: 4, y: 4, hp: 48, maxHp: 60, air: false, shield: 0 }] });
    const cues = battleAnimationCues(current, previous);
    expect(cues).toHaveLength(1);
    const seen = new Set<string>();
    expect(takeUnseenBattleAnimationCues([...cues, ...cues], seen)).toHaveLength(1);
  });

  it("does not replay one commander spawn when deploy and commander events share a tick", () => {
    const cues = battleAnimationCues(frame({
      events: [
        { type: "deploy", tick: 10, player: 0, cardId: "cmdr:scout", entityIds: ["c0-1"] },
        { type: "commander_deployed", tick: 10, player: 0, commanderId: "c0-1", class: "scout" },
      ],
    }), null);
    expect(cues.filter((cue) => cue.kind === "spawn")).toHaveLength(1);
  });

  it("snaps large corrections and clamps ordinary interpolation", () => {
    expect(interpolateBattlePosition({ x: 0, y: 0 }, { x: 4, y: 8 }, 0.5)).toEqual({ x: 2, y: 4 });
    expect(interpolateBattlePosition({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.2)).toEqual({ x: 20, y: 0 });
    expect(interpolateBattlePosition({ x: 0, y: 0 }, { x: 4, y: 8 }, 4)).toEqual({ x: 4, y: 8 });
  });
});
