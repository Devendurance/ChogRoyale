// B2.7a deployable defensive buildings (combat ruleset v8).

import { describe, it, expect } from "vitest";
import {
  initMatch,
  stepMatch,
  runMatch,
  validateDeck,
  buildingDeployCheck,
  combatRulesetSummary,
  freeStarterSlot,
  BUILDING_CARDS_V1,
  BUILDING_RULES_V1,
  CARDS_V1,
  COMBAT_RULESET_VERSION,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
} from "@/lib/combat";
import { deckWith, scenarioConfig, traceMatch } from "@/lib/arena-scenarios";
import * as S from "@/lib/building-scenarios";

const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const rejections = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [e.reason] : []));
const SENTRY = BUILDING_CARDS_V1.rift_sentry!;
const TOTEM = BUILDING_CARDS_V1.decoy_totem!;
const fresh = () => initMatch(scenarioConfig(deckWith("rift_sentry", "decoy_totem"), deckWith("rift_sentry", "decoy_totem")));
function stepTo(s: CombatState, cmds: DeployCommand[], tick: number) {
  while (s.tick < tick && s.phase !== "final") stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
}

describe("building card domain", () => {
  it("registers two authored buildings and bumps the ruleset", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v16");
    expect(Object.keys(BUILDING_CARDS_V1)).toEqual(["rift_sentry", "decoy_totem", "chog_burrow", "rift_mortar"]);
    expect(CARDS_V1.rift_sentry).toBe(SENTRY);
    expect([SENTRY.cost, SENTRY.hp, SENTRY.damage, SENTRY.attackIntervalTicks, SENTRY.range, SENTRY.lifetimeTicks, SENTRY.hitsAir]).toEqual([4, 320, 16, 8, 16, 300, false]);
    expect([TOTEM.cost, TOTEM.hp, TOTEM.damage, TOTEM.lifetimeTicks]).toEqual([2, 260, 0, 200]);
    expect(combatRulesetSummary().buildings.cards).toHaveLength(4);
  });

  it("validates decks: buildings fill ordinary slots, unknown and duplicate cards fail", () => {
    const slot = freeStarterSlot("bulwark");
    expect(() => validateDeck(deckWith("rift_sentry", "decoy_totem"), slot)).not.toThrow();
    const deck = deckWith("rift_sentry");
    expect(() => validateDeck(deck.map((c) => (c === "rift_sentry" ? "rift_turret" : c)), slot)).toThrow(/Card not playable: rift_turret/);
    expect(() => validateDeck(deck.map((c) => (c === "choglings" ? "rift_sentry" : c)), slot)).toThrow(/Duplicate card/);
  });

  it("plays from hand, pays energy and cycles like any card", () => {
    const s = fresh();
    expect(s.hands[0]).toContain("rift_sentry");
    stepMatch(s, [d(1, 0, 1, "rift_sentry", 30, 56)]);
    expect(s.energy[0]).toBe(1);
    expect(s.hands[0]).not.toContain("rift_sentry");
    expect(s.queues[0].at(-1)).toBe("rift_sentry");
    expect(s.buildings).toHaveLength(1);
    expect(s.events.filter((e) => e.type === "deploy" || e.type === "building_spawned").map((e) => e.type)).toEqual(["deploy", "building_spawned"]);
    stepMatch(s, [d(2, 0, 2, "decoy_totem", 70, 56), d(3, 0, 2, "rift_sentry", 70, 50)]);
    expect(rejections(s)).toEqual(["Insufficient energy", "Card rift_sentry not in hand"]);
    const done = runMatch(scenarioConfig(deckWith("rift_sentry"), deckWith()), []).state;
    const n = done.events.length;
    stepMatch(done, [d(9, 0, done.tick + 1, "rift_sentry", 30, 56)]);
    expect(done.events.length).toBe(n);
  });
});

describe("placement and footprints", () => {
  it("rejects river, crossing mouths, enemy side, structure overlap and occupied footprints", () => {
    const s = fresh();
    const why = (p: PlayerIndex, x: number, y: number, def = SENTRY) => {
      const r = buildingDeployCheck(s, p, x, y, def);
      return r.ok ? "ok" : r.reason;
    };
    expect(why(0, 30, 80)).toBe("Deployment on river or bridge");
    expect(why(0, 30, 70)).toBe("Building blocks a river crossing");
    expect(why(0, 70, 70)).toBe("Building blocks a river crossing");
    expect(why(0, 50, 70)).toBe("Building blocks a river crossing");
    expect(why(1, 70, 90)).toBe("Building blocks a river crossing");
    expect(why(0, 30, 100)).toBe("Deployment outside own territory");
    expect(why(0, 30, 47)).toBe("Deployment on structure");
    expect(why(0, 30, 56)).toBe("ok");
    expect(why(0, 40, 70)).toBe("ok");
    expect(why(1, 70, 104)).toBe("ok");
    stepMatch(s, [d(1, 0, 1, "rift_sentry", 30, 56)]);
    // Corner rule => exactly 2 free cells between footprints (sentry r2 + totem r1).
    expect(why(0, 35, 56, TOTEM)).toBe("Deployment on structure");
    expect(why(0, 36, 56, TOTEM)).toBe("ok");
    const t = initMatch(scenarioConfig(deckWith("chog_guardian", "decoy_totem"), deckWith()));
    stepMatch(t, [d(1, 0, 1, "chog_guardian", 30, 20)]);
    expect(buildingDeployCheck(t, 0, 31, 21, TOTEM)).toEqual({ ok: false, reason: "Building footprint occupied" });
  });

  it("caps live buildings per player", () => {
    const s = fresh();
    for (let i = 0; i < BUILDING_RULES_V1.maxLivePerPlayer; i++) {
      s.buildings.push({ ...{ id: `x${i}`, kind: "building", owner: 0, cardId: "decoy_totem", x: 10 + i * 20, y: 20, hp: 1, maxHp: 1, alive: true, damage: 0, range: 0, interval: 0, cooldownUntil: 0, hitsAir: false, hitsGround: false, footprint: 1, targetId: null, spawnTick: 0, expiresAt: 999 } });
    }
    expect(buildingDeployCheck(s, 0, 70, 56, TOTEM)).toEqual({ ok: false, reason: "Building limit reached" });
    expect(buildingDeployCheck(s, 1, 70, 104, TOTEM)).toEqual({ ok: true });
  });

  it("footprints are solid: own troops route around them and still cross the flanked bridge", () => {
    const r = S.bridgeClearance();
    expect(r.rejected).toEqual([]);
    expect(r.crossings).toEqual(["left"]);
    expect(r.maxY).toBeGreaterThan(100);
    const cfg = scenarioConfig(deckWith("rift_sentry", "decoy_totem", "chog_guardian"), deckWith());
    const { samples } = traceMatch(cfg, [d(1, 0, 2, "rift_sentry", 30, 64), d(2, 0, 60, "decoy_totem", 22, 64), d(3, 0, 200, "chog_guardian", 30, 50)], 400);
    const inside = samples.filter(
      (x) => (x.tick < 302 && Math.abs(x.x - 30) <= 2 && Math.abs(x.y - 64) <= 2) || (x.tick < 260 && Math.abs(x.x - 22) <= 1 && Math.abs(x.y - 64) <= 1)
    );
    expect(inside).toEqual([]);
  });
});

describe("targeting, distraction and air rules", () => {
  it("A/C/G: a Sentry shoots attackers and a lane-guarding Sentry protects the tower better than a far one", () => {
    const a = S.sentryDefense();
    expect(a.towerWith).toBeGreaterThan(a.towerWithout);
    expect(a.events.map((e) => e.kind)).toEqual(["spawned", "expired"]);
    const g = S.placementValue();
    expect(g.goodTower).toBeGreaterThan(g.poorTower);
  });

  it("Sentry fires on its authored cadence and can be destroyed by a structure-priority attacker", () => {
    const s = initMatch(scenarioConfig(deckWith("rift_sentry"), deckWith("boulderback")));
    const cmds = [d(1, 0, 1, "rift_sentry", 40, 70), d(2, 1, 2, "boulderback", 30, 100)];
    const hits: number[] = [];
    let prev = -1;
    for (let i = 0; i < 400 && s.phase !== "final"; i++) {
      stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
      const bb = s.troops.find((t) => t.cardId === "boulderback");
      if (bb && prev >= 0 && bb.hp < prev && s.buildings.length > 0) {
        expect(prev - bb.hp).toBe(SENTRY.damage);
        hits.push(s.tick);
      }
      prev = bb?.hp ?? -1;
    }
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[0]!).toBeGreaterThanOrEqual(1 + SENTRY.deployTicks);
    for (let i = 1; i < hits.length; i++) expect(hits[i]! - hits[i - 1]!).toBe(SENTRY.attackIntervalTicks);
    const removed = s.events.find((e) => e.type === "building_removed");
    expect(removed?.type === "building_removed" && removed.reason).toBe("destroyed");
    expect(s.buildings).toHaveLength(0);
  });

  it("B/D: a Decoy Totem pulls a Rift Runner, then routing returns to the tower once it is destroyed", () => {
    const r = S.totemDistraction();
    expect(r.controlTargets).toEqual(["s-p0-tower-30"]);
    expect(r.firstTotemTarget).not.toBeNull();
    expect(r.removed?.reason).toBe("destroyed");
    expect(r.retargetedTo).toBe("s-p0-tower-30");
    expect(r.targetedTotemAfterRemoval).toBe(false);
    expect(r.towerAt300.withTotem).toBeGreaterThan(r.towerAt300.control);
  });

  it("E: the ground-only Sentry never targets a Hexwing, which can destroy it", () => {
    const r = S.airVsSentry();
    expect(r.sentryTargetedHex).toBe(false);
    expect(r.hexTargetedSentry).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(["spawned", "destroyed"]);
  });

  it("commanders attack buildings, while Chaos Bolt keeps its troop-only rule", () => {
    const cfg = scenarioConfig(deckWith("decoy_totem", "chaos_bolt"), deckWith("cmdr:free-reaver"));
    const { state } = runMatch(cfg, [d(1, 0, 1, "decoy_totem", 40, 70), d(2, 1, 2, "cmdr:free-reaver", 40, 100), d(3, 0, 60, "chaos_bolt", 40, 70)], 400);
    const bolt = state.events.find((e) => e.type === "spell_cast");
    expect(bolt?.type === "spell_cast" && bolt.affected).toBe(0);
    const removed = state.events.find((e) => e.type === "building_removed");
    expect(removed?.type === "building_removed" && removed.reason).toBe("destroyed");
  });

  it("F: both players defend opposite lanes symmetrically", () => {
    const r = S.mirroredLanes();
    expect(r.rejected).toBe(0);
    expect(r.deaths).toEqual(["t3@110", "t4@110"]);
    expect(r.p0Tower).toBe(600);
    expect(r.p1Tower).toBe(600);
    expect(r.events.filter((e) => e.kind === "expired").map((e) => e.tick)).toEqual([302, 302]);
  });
});

describe("lifecycle", () => {
  it("H: expiry happens at the start of tick expiresAt, frees the footprint and leaves nothing behind", () => {
    const r = S.expiry();
    expect(r.events).toEqual([{ kind: "spawned", id: "b1", tick: 2 }, { kind: "expired", id: "b1", tick: 202 }]);
    expect(r.rejected).toEqual(["2:Deployment on structure"]);
    expect(r.buildingsLeft).toBe(0);
    const s = initMatch(scenarioConfig(deckWith("decoy_totem"), deckWith("rift_runner")));
    const cmds = [d(1, 0, 1, "decoy_totem", 40, 70), d(2, 1, 150, "rift_runner", 40, 100)];
    stepTo(s, cmds, 200);
    expect(s.buildings).toHaveLength(1);
    stepMatch(s, []);
    expect(s.buildings).toHaveLength(0);
    expect(s.troops.every((t) => t.targetId !== "b1")).toBe(true);
    expect(s.events.filter((e) => e.type === "building_removed").map((e) => (e.type === "building_removed" ? e.reason : ""))).toEqual(["expired"]);
  });
});

describe("full matches", () => {
  it("I/J/K: bots with building decks, commanders and Chaos reach a natural result and replay identically", () => {
    const r = S.buildingMatch();
    expect(r.rejected).toBe(0);
    expect(r.buildings.spawned).toBeGreaterThan(2);
    expect((r.buildings.destroyed ?? 0) + (r.buildings.expired ?? 0)).toBeGreaterThan(0);
    expect(r.commanderDeploys).toBeGreaterThan(1);
    expect(r.pulses).toBeGreaterThan(0);
    expect(r.result.winner).not.toBeNull();
    expect(r.replayIdentical).toBe(true);
    expect(r.steppedEqualsReplay).toBe(true);
  });
});
