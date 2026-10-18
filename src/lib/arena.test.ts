// B2.5 arena geometry, navigation, deployment territory and RIFT_SHIFT tests.

import { describe, it, expect } from "vitest";
import {
  ARENA_V2,
  ARENA_VERSION,
  COMBAT_RULESET_VERSION,
  initMatch,
  planGroundRoute,
  moveUnit,
  isWalkable,
  inRiver,
  sideOf,
  troopDeployCheck,
  laneObjective,
  combatRulesetSummary,
  type StructureEntity,
} from "@/lib/combat";
import {
  traceMatch,
  botMatch,
  scenarioConfig,
  deckWith,
  crossingUse,
  riftSchedule,
  scenarioBridge,
  scenarioBlockedRiver,
  scenarioAirVsGround,
  scenarioRush,
  scenarioPush,
  scenarioDistraction,
  scenarioTwoLanes,
  scenarioRiftShift,
  scenarioVictories,
  scenarioPocket,
  scenarioReplay,
} from "@/lib/arena-scenarios";

const structures = (): StructureEntity[] => initMatch(scenarioConfig(deckWith(), deckWith())).structures;

describe("arena-v2 geometry", () => {
  it("is versioned and bounded", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v14");
    expect(ARENA_VERSION).toBe("arena-v2");
    expect(combatRulesetSummary().arena.version).toBe("arena-v2");
    expect([ARENA_V2.minX, ARENA_V2.maxX, ARENA_V2.minY, ARENA_V2.maxY]).toEqual([0, 100, 0, 160]);
    expect(isWalkable(-1, 40, false)).toBe(false);
    expect(isWalkable(30, 161, false)).toBe(false);
  });
  it("has a river band and two bridges, mirror-symmetric", () => {
    const { river, bridges, riftFord, midY } = ARENA_V2;
    expect(river.minY + river.maxY).toBe(2 * midY);
    expect(bridges[0]!.minX + bridges[1]!.maxX).toBe(100);
    expect(bridges[0]!.maxX + bridges[1]!.minX).toBe(100);
    expect(riftFord.minX + riftFord.maxX).toBe(100);
    for (const t of ARENA_V2.towers) {
      expect(ARENA_V2.towers.some((m) => m.x === t.x && m.y === 160 - t.y && m.owner !== t.owner)).toBe(true);
    }
    for (let x = 0; x <= 100; x++) {
      for (let y = 0; y <= 160; y++) {
        expect(isWalkable(x, y, false)).toBe(isWalkable(x, 160 - y, false));
        expect(isWalkable(x, y, false)).toBe(isWalkable(100 - x, y, false));
      }
    }
  });
  it("blocks water, opens bridges, and opens the Rift Ford only while active", () => {
    expect(sideOf(73)).toBe(0);
    expect(sideOf(87)).toBe(1);
    expect(inRiver(74) && inRiver(86) && !inRiver(73) && !inRiver(87)).toBe(true);
    expect(isWalkable(50, 80, false)).toBe(false);
    expect(isWalkable(10, 80, false)).toBe(false);
    expect(isWalkable(24, 80, false) && isWalkable(36, 80, false)).toBe(true);
    expect(isWalkable(23, 80, false) || isWalkable(37, 80, false)).toBe(false);
    expect(isWalkable(64, 80, false) && isWalkable(76, 80, false)).toBe(true);
    expect(isWalkable(50, 80, true)).toBe(true);
    expect(isWalkable(43, 80, true) || isWalkable(57, 80, true)).toBe(false);
  });
});

describe("ground navigation", () => {
  it("routes across a bridge with exact waypoints and cost", () => {
    const r = planGroundRoute({ x: 30, y: 60 }, { x: 30, y: 120 }, false)!;
    expect(r.crossing).toBe("left");
    expect(r.waypoints).toEqual([{ x: 30, y: 73 }, { x: 30, y: 87 }, { x: 30, y: 120 }]);
    expect(r.cost).toBe(600);
    expect(planGroundRoute({ x: 70, y: 60 }, { x: 70, y: 120 }, false)!.crossing).toBe("right");
  });
  it("same-side goals go straight", () => {
    expect(planGroundRoute({ x: 10, y: 10 }, { x: 60, y: 50 }, false)).toEqual({ crossing: null, cost: 660, waypoints: [{ x: 60, y: 50 }], stranded: false });
  });
  it("breaks ties deterministically and mirror-equivalently", () => {
    const a = planGroundRoute({ x: 50, y: 60 }, { x: 50, y: 100 }, false)!;
    const b = planGroundRoute({ x: 50, y: 100 }, { x: 50, y: 60 }, false)!;
    expect(a.crossing).toBe("left");
    expect(b.crossing).toBe("left");
    expect(a.cost).toBe(b.cost);
    expect(planGroundRoute({ x: 50, y: 50 }, { x: 30, y: 120 }, true)!.crossing).toBe("rift");
    expect(planGroundRoute({ x: 50, y: 50 }, { x: 30, y: 120 }, false)!.crossing).toBe("left");
  });
  it("rejects targets standing in open water and handles targets on a bridge", () => {
    expect(planGroundRoute({ x: 30, y: 60 }, { x: 50, y: 80 }, false)).toBeNull();
    const onBridge = planGroundRoute({ x: 30, y: 60 }, { x: 30, y: 80 }, false)!;
    expect(onBridge.crossing).toBe("left");
    expect(onBridge.waypoints.at(-1)).toEqual({ x: 30, y: 80 });
  });
  it("reroutes when the goal changes", () => {
    expect(planGroundRoute({ x: 40, y: 60 }, { x: 30, y: 120 }, false)!.crossing).toBe("left");
    expect(planGroundRoute({ x: 60, y: 60 }, { x: 70, y: 120 }, false)!.crossing).toBe("right");
  });
  it("walks stranded units straight out of closed water", () => {
    const r = planGroundRoute({ x: 50, y: 78 }, { x: 30, y: 120 }, false)!;
    expect(r.stranded).toBe(true);
    expect(r.waypoints[0]).toEqual({ x: 50, y: 87 });
  });
  it("never steps into water while moving, ground vs air", () => {
    const g = { x: 50, y: 60, moveType: "ground" as const };
    const a = { x: 50, y: 60, moveType: "air" as const };
    let airOverWater = false;
    for (let i = 0; i < 60; i++) {
      moveUnit(g, { x: 50, y: 120 }, 3, false);
      moveUnit(a, { x: 50, y: 120 }, 3, false);
      expect(isWalkable(g.x, g.y, false)).toBe(true);
      if (inRiver(a.y) && !isWalkable(a.x, a.y, false)) airOverWater = true;
    }
    expect(g).toMatchObject({ x: 50, y: 120 });
    expect(airOverWater).toBe(true);
  });
  it("lane objective follows the unit's current lane, then the Core", () => {
    const s = structures();
    expect(laneObjective({ owner: 0, x: 30 }, s)!.id).toBe("s-p1-tower-30");
    expect(laneObjective({ owner: 0, x: 50 }, s)!.id).toBe("s-p1-tower-30");
    expect(laneObjective({ owner: 0, x: 51 }, s)!.id).toBe("s-p1-tower-70");
    s.find((x) => x.id === "s-p1-tower-30")!.alive = false;
    expect(laneObjective({ owner: 0, x: 30 }, s)!.id).toBe("s-p1-core");
  });
});

describe("deployment territory", () => {
  it("allows own territory and rejects river, bridges and enemy side", () => {
    const s = structures();
    expect(troopDeployCheck(s, 0, 30, 73)).toEqual({ ok: true, zone: "own" });
    expect(troopDeployCheck(s, 1, 30, 87)).toEqual({ ok: true, zone: "own" });
    expect(troopDeployCheck(s, 0, 30, 74)).toEqual({ ok: false, reason: "Deployment on river or bridge" });
    expect(troopDeployCheck(s, 0, 30, 80)).toMatchObject({ ok: false });
    expect(troopDeployCheck(s, 1, 70, 86)).toMatchObject({ ok: false });
    expect(troopDeployCheck(s, 0, 30, 95)).toEqual({ ok: false, reason: "Deployment outside own territory" });
    expect(troopDeployCheck(s, 0, 4, 40)).toEqual({ ok: false, reason: "Deployment outside arena territory" });
  });
  it("unlocks only the fallen lane's pocket with exact geometry, mirrored", () => {
    const s = structures();
    s.find((x) => x.id === "s-p1-tower-30")!.alive = false;
    s.find((x) => x.id === "s-p0-tower-70")!.alive = false;
    expect(troopDeployCheck(s, 0, 5, 87)).toEqual({ ok: true, zone: "pocket-left" });
    expect(troopDeployCheck(s, 0, 49, 106)).toEqual({ ok: true, zone: "pocket-left" });
    expect(troopDeployCheck(s, 0, 49, 107).ok).toBe(false);
    expect(troopDeployCheck(s, 0, 50, 95).ok).toBe(false);
    expect(troopDeployCheck(s, 0, 51, 95).ok).toBe(false);
    expect(troopDeployCheck(s, 1, 51, 73)).toEqual({ ok: true, zone: "pocket-right" });
    expect(troopDeployCheck(s, 1, 95, 54)).toEqual({ ok: true, zone: "pocket-right" });
    expect(troopDeployCheck(s, 1, 95, 53).ok).toBe(false);
    expect(troopDeployCheck(s, 1, 30, 60).ok).toBe(false);
  });
  it("rejects illegal deploys as deterministic events and keeps spawns off water", () => {
    const cfg = scenarioConfig(deckWith("choglings"), deckWith("choglings"));
    const { state } = traceMatch(cfg, [
      { seq: 1, player: 0, tick: 2, cardId: "choglings", x: 30, y: 80 },
      { seq: 2, player: 0, tick: 3, cardId: "choglings", x: 50, y: 73 },
    ], 4);
    const rej = state.events.filter((e) => e.type === "command_rejected");
    expect(rej).toEqual([{ type: "command_rejected", tick: 2, seq: 1, reason: "Deployment on river or bridge" }]);
    const spawned = state.troops.filter((t) => t.cardId === "choglings");
    expect(spawned).toHaveLength(3);
    for (const t of spawned) expect(inRiver(t.y)).toBe(false);
  });
  it("pocket unlock is proven through real deploy commands", () => {
    const p = scenarioPocket();
    expect(p.fell).not.toBeNull();
    expect(p.before).toBe("Deployment outside own territory");
    expect(p.left).toBe("accepted");
    expect(p.right).toBe("Deployment outside own territory");
    expect(p.tooDeep).toBe("Deployment outside own territory");
  });
});

describe("b2.5 headless scenarios", () => {
  it("A: ground troop uses the left bridge (both players, mirrored)", () => {
    const p0 = scenarioBridge("left", 0);
    const p1 = scenarioBridge("left", 1);
    expect(p0.crossings).toEqual(["left"]);
    expect(p1.crossings).toEqual(["left"]);
    expect(p0.enemyTowerHp).toBeLessThan(600);
    expect(p0.enemyTowerHp).toBe(p1.enemyTowerHp);
    for (let i = 0; i < p0.trace.length; i++) {
      expect(p1.trace[i]!.x).toBe(p0.trace[i]!.x);
      expect(p1.trace[i]!.y).toBe(160 - p0.trace[i]!.y);
    }
  });
  it("B: ground troop uses the right bridge", () => {
    const r = scenarioBridge("right");
    expect(r.crossings).toEqual(["right"]);
    expect(r.finalTarget).toBe("s-p1-tower-70");
    expect(r.enemyTowerHp).toBeLessThan(600);
  });
  it("C: ground troops never cross the blocked river", () => {
    const r = scenarioBlockedRiver();
    expect(r.samples).toBeGreaterThan(100);
    expect(r.waterSteps).toBe(0);
    expect(r.crossings).toEqual(["left", "right"]);
  });
  it("D: flying troop crosses open water while ground takes a bridge", () => {
    const r = scenarioAirVsGround();
    expect(r.airCrossings).toContain("water");
    expect(r.groundCrossings).toEqual(["left"]);
    expect(r.airObjective).toBe(r.groundObjective);
    expect(r.airFirstSouthTick!).toBeLessThan(r.groundFirstSouthTick!);
  });
  it("E: rush unit reaches and hits a structure despite defenders in sight", () => {
    const r = scenarioRush();
    expect(r.crossings).toEqual(["right"]);
    expect(r.towerTargetWhileDefended).toBe(true);
    expect(r.towerHp).toBeLessThan(600);
  });
  it("F: tank plus ranged support travel as a push and out-trade the solo tank", () => {
    const r = scenarioPush();
    expect(r.tankCrossings).toEqual(["left"]);
    expect(r.archerCrossings).toEqual(["left"]);
    expect(r.archersBehindTank).toBe(true);
    expect(r.soloDestroyedAt).toBeNull();
    expect(r.pushDestroyedAt).not.toBeNull();
    expect(r.pushCrowns).toEqual([1, 0]);
  });
  it("G: defensive placement redirects the attacker (kiting)", () => {
    const r = scenarioDistraction();
    expect(r.baseMaxX).toBe(30);
    expect(r.kitedMaxX).toBeGreaterThan(r.baseMaxX);
    expect(r.kitedTargets.some((t) => t !== null && t.startsWith("t"))).toBe(true);
    expect(r.kitedReachTick!).toBeGreaterThan(r.baseReachTick!);
    expect(r.kitedTowerHp).toBeGreaterThan(r.baseTowerHp);
  });
  it("H: both lanes carry independent pressure", () => {
    const r = scenarioTwoLanes();
    expect(r.leftCrossings).toEqual(["left"]);
    expect(r.rightCrossings).toEqual(["right"]);
    expect(r.leftTowerHp).toBeLessThan(600);
    expect(r.rightTowerHp).toBeLessThan(600);
  });
  it("I: RIFT_SHIFT opens real routing, respects warning, strands nobody, and restores", () => {
    const r = scenarioRiftShift();
    expect(r.family).toBe("rift_shift");
    expect(r.warningCrossings).toEqual(["left"]);
    expect(r.activeCrossings).toEqual(["rift"]);
    expect(r.controlCrossings).toEqual(["left"]);
    expect(r.afterExpiryCrossings).toEqual(["left"]);
    expect(r.strandedAtClose).toBe(true);
    expect(r.strandedExitStraight).toBe(true);
    expect(r.strandedReachedNorth).toBe(true);
    expect(r.strandedExitTicks).toBeLessThanOrEqual(13);
    expect(r.strandedMaxStep).toBeLessThanOrEqual(2);
    expect(r.riftEvents).toEqual([
      { tick: r.activationTick, open: true },
      { tick: r.activationTick + r.durationTicks, open: false },
    ]);
  });
  it("J: Core and crown victories still resolve", () => {
    const r = scenarioVictories();
    expect(r.core).toMatchObject({ winner: 0, reason: "core", crowns: [3, 0] });
    expect(r.crowns).toMatchObject({ winner: 0, reason: "crowns", crowns: [1, 0], ticks: 1800 });
  });
  it("K: identical commands produce identical hashes with chaos active", () => {
    const r = scenarioReplay();
    expect(r.hashA).toBe(r.hashB);
    expect(r.a).toEqual(r.b);
    expect(r.a.winner).not.toBeNull();
    expect(r.deploys).toBeGreaterThan(30);
    expect(r.rejected).toBe(0);
    expect(r.deaths).toBeGreaterThan(30);
    if (r.a.ticks > 600) expect(r.riftEvents).toBe(2);
  });
  it("no ground unit walks on closed water across a full chaotic match", () => {
    const cards = ["chog_guardian", "boulderback", "chaos_archer", "rift_runner", "choglings", "frostshell", "sparkcaster", "hexwing"];
    const schedule = riftSchedule("invariant");
    const { state, samples, commands } = botMatch(scenarioConfig(deckWith(...cards.slice(0, 7), "cmdr:free-deadeye"), deckWith("cmdr:free-scout", ...cards.slice(1, 8)), schedule, "inv"), 3100, 20);
    expect(state.phase).toBe("final");
    expect(commands.length).toBeGreaterThanOrEqual(30);
    expect(state.events.filter((e) => e.type === "rift_crossing")).toHaveLength(2);
    const closes = state.events.filter((e) => e.type === "rift_crossing" && !e.open).map((e) => e.tick);
    const ground = samples.filter((s) => s.moveType === "ground");
    expect(ground.length).toBeGreaterThan(1000);
    for (const s of ground) {
      if (crossingUse(s) !== "water") continue;
      const fx = ARENA_V2.riftFord;
      expect(s.x >= fx.minX && s.x <= fx.maxX).toBe(true);
      expect(closes.some((c) => s.tick >= c && s.tick <= c + 13)).toBe(true);
    }
  });
});
