import { describe, expect, it } from "vitest";
import type { BattleFrame, StructureView } from "@/lib/battle-protocol";
import { crownCues, crownScreenPoint, unseenCrownCues } from "./crown-presentation";

const tower: StructureView = { id: "enemy-tower", owner: 1, kind: "tower", x: 25, y: 140, hp: 100, maxHp: 100, alive: true };
const core: StructureView = { ...tower, id: "enemy-core", kind: "core", x: 50, y: 152 };
const frame = (overrides: Partial<BattleFrame> = {}): BattleFrame => ({ tick: 10, phase: "active", clockTicks: 10, crowns: [0, 0], energy: 5, energyProgress: 0, regenMult: 1, hand: [], next: null, abilities: [], troops: [], commanders: [], structures: [tower, core], buildings: [], projectiles: [], impacts: [], chaos: [], riftOpen: false, events: [], ...overrides });
const down = (s: StructureView) => ({ ...s, hp: 0, alive: false });

describe("confirmed crown presentation", () => {
  it("needs both a confirmed score gain and a matching enemy structure transition", () => {
    const previous = frame();
    const current = frame({ tick: 11, crowns: [1, 0], structures: [down(tower), core] });
    expect(crownCues(current, previous).map((c) => [c.scorer, c.ordinal, c.structure.id])).toEqual([[0, 1, tower.id]]);
    expect(crownCues({ ...current, crowns: [0, 0] }, previous)).toEqual([]);
    expect(crownCues({ ...current, structures: [tower, core] }, previous)).toEqual([]);
    expect(crownCues({ ...current, crowns: [0, 1] }, previous)).toEqual([]);
  });
  it("suppresses initial, resume, duplicate, stale and already-dead snapshots", () => {
    const current = frame({ tick: 11, crowns: [1, 0], structures: [down(tower), core] });
    expect(crownCues(current, null)).toEqual([]);
    expect(crownCues(current, frame(), true)).toEqual([]);
    expect(crownCues(current, current)).toEqual([]);
    expect(crownCues(frame(), current)).toEqual([]);
    expect(crownCues({ ...current, tick: 12, crowns: [2, 0] }, current)).toEqual([]);
  });
  it("uses the confirmed Core delta, including a partial prior score", () => {
    const current = frame({ tick: 11, crowns: [3, 0], structures: [tower, down(core)] });
    expect(crownCues(current, frame()).map((c) => c.ordinal)).toEqual([1, 2, 3]);
    expect(crownCues(current, frame({ crowns: [1, 0] })).map((c) => c.ordinal)).toEqual([2, 3]);
    expect(crownCues({ ...current, crowns: [2, 0] }, frame()).map((c) => c.ordinal)).toEqual([1, 2]);
  });
  it("maps both seats without awarding the structure owner", () => {
    const friendly = { ...tower, id: "own-tower", owner: 0 as const, y: 20 };
    const cues = crownCues(frame({ tick: 11, crowns: [0, 1], structures: [down(friendly)] }), frame({ structures: [friendly] }));
    expect(cues[0]?.scorer).toBe(1);
    const rect = { left: 100, top: 20, width: 200, height: 320 };
    expect(crownScreenPoint(friendly, rect, 0)).toEqual({ x: 150, y: 300 });
    expect(crownScreenPoint(friendly, rect, 1)).toEqual({ x: 150, y: 60 });
  });
  it("can present both confirmed three-crown sides on a simultaneous Core draw", () => {
    const ownCore = { ...core, id: "own-core", owner: 0 as const, y: 8 };
    const cues = crownCues(frame({ tick: 11, crowns: [3, 3], structures: [down(core), down(ownCore)] }), frame({ structures: [core, ownCore] }));
    expect(cues.filter((c) => c.scorer === 0)).toHaveLength(3);
    expect(cues.filter((c) => c.scorer === 1)).toHaveLength(3);
  });
  it("bounds identity history and drops re-delivered scoring transitions", () => {
    const cues = crownCues(frame({ tick: 11, crowns: [1, 0], structures: [down(tower), core] }), frame());
    const seen = new Set<string>();
    expect(unseenCrownCues([...cues, ...cues], seen)).toHaveLength(1);
    expect(unseenCrownCues(cues, seen)).toEqual([]);
    unseenCrownCues(Array.from({ length: 200 }, (_, i) => ({ ...cues[0]!, key: `fixture:${i}` })), seen);
    expect(seen.size).toBe(64);
  });
  it("doesn't turn malformed or rolled-back counts into crowns", () => {
    const current = frame({ tick: 11, structures: [down(core)] });
    expect(crownCues({ ...current, crowns: [4, 0] }, frame())).toEqual([]);
    expect(crownCues({ ...current, crowns: [1.5, 0] }, frame())).toEqual([]);
    expect(crownCues({ ...current, crowns: [0, 0] }, frame({ crowns: [1, 0] }))).toEqual([]);
  });
});
