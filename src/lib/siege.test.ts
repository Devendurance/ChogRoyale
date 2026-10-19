// B2.8b Rift Mortar siege building (combat ruleset v16).

import { describe, it, expect } from "vitest";
import {
  initMatch,
  stepMatch,
  runMatch,
  validateDeck,
  buildingDeployCheck,
  stateHash,
  freeStarterSlot,
  BUILDING_CARDS_V1,
  CARDS_V1,
  COMBAT_RULESET_VERSION,
  type AbilityCommand,
  type BuildingEntity,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
  type TroopEntity,
} from "@/lib/combat";
import { deckWith, scenarioConfig, botMatch, botSiegeSpot } from "@/lib/arena-scenarios";
import type { ChaosSchedule } from "@/lib/chaos";

const MORTAR = BUILDING_CARDS_V1.rift_mortar!;
const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const ab = (seq: number, player: PlayerIndex, tick: number, abilityId: string): AbilityCommand => ({ kind: "ability", seq, player, tick, abilityId });
const MORTAR_DECK = deckWith("rift_mortar", "chog_guardian", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt", "cmdr:free-warden");
const fresh = (p1 = deckWith("chog_guardian")) => initMatch(scenarioConfig(MORTAR_DECK, p1));
function stepTo(s: CombatState, cmds: Array<DeployCommand | AbilityCommand>, tick: number) {
  while (s.tick < tick && s.phase !== "final") stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
}
const fired = (s: CombatState) => s.events.filter((e) => e.type === "siege_fired");
const impacts = (s: CombatState) => s.events.filter((e) => e.type === "spell_impact" && e.cardId === "rift_mortar");
/** A stationary fake enemy (building or troop) pushed straight into state. */
const fakeBuilding = (id: string, owner: PlayerIndex, cardId: string, x: number, y: number, footprint = 1): BuildingEntity => ({
  id, kind: "building", owner, cardId, x, y, hp: 999, maxHp: 999, alive: true,
  damage: 0, range: 0, interval: 0, cooldownUntil: 0, hitsAir: false, hitsGround: false,
  footprint, targetId: null, spawnTick: 0, expiresAt: 99999,
});
const fakeTroop = (id: string, owner: PlayerIndex, cardId: string, x: number, y: number, speed = 0, moveType: "ground" | "air" = "ground", damage = 0, sight = 0): TroopEntity => ({
  id, kind: "troop", owner, cardId, x, y, hp: 200, maxHp: 200, damage, range: 2, speed, sight,
  interval: 99, cooldownUntil: 0, targetId: null, moveType, hitsAir: false, hitsGround: true,
  structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0,
  slowUntil: 0, activeSlowPct: 0, buffUntil: 0, buffPct: 0, hasteUntil: 0, hastePct: 0, stunUntil: speed === 0 ? 99999 : 0,
  shieldHp: 0, shieldUntil: 0, reflectUntil: 0, reflectFracNumer: 0, reflectFracDenom: 1,
  guardUntil: 0, guardPct: 0, armor: 0, moveCarry: 0,
});
const enemyTower = (s: CombatState, lane = 30) => s.structures.find((x) => x.owner === 1 && x.structure === "tower" && x.x === lane)!;

describe("siege card domain", () => {
  it("registers the v16 mortar with shell and minRange fields", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v16");
    expect([MORTAR.cost, MORTAR.hp, MORTAR.footprint, MORTAR.deployTicks, MORTAR.lifetimeTicks, MORTAR.attackIntervalTicks, MORTAR.range]).toEqual([5, 300, 2, 30, 300, 40, 50]);
    expect(MORTAR.minRange).toBe(12);
    expect(MORTAR.shell).toEqual({ radius: 4, flightTicks: 15, unitDamage: 40, buildingDamage: 40, structureDamage: 30 });
    expect(MORTAR.hitsAir).toBe(false);
    expect(CARDS_V1.rift_mortar).toBe(MORTAR);
  });

  it("decks accept rift_mortar; v14 and v15 configs reject it, v14 keeps rejecting chog_burrow", () => {
    const slot = freeStarterSlot("warden");
    expect(() => validateDeck(MORTAR_DECK, slot)).not.toThrow();
    const cfg = scenarioConfig(MORTAR_DECK, MORTAR_DECK);
    expect(() => initMatch({ ...cfg, rulesetVersion: "v15" })).toThrow(/v16/);
    expect(() => initMatch({ ...cfg, rulesetVersion: "v14" })).toThrow(/v16/);
    const burrowCfg = scenarioConfig(deckWith("chog_burrow"), deckWith("chog_guardian"));
    expect(() => initMatch({ ...burrowCfg, rulesetVersion: "v14" })).toThrow(/v15/);
    expect(initMatch({ ...burrowCfg, rulesetVersion: "v15" }).ruleset).toBe("v15");
  });
});

describe("placement and fire cadence", () => {
  it("follows building placement rules on both seats and costs 5 energy", () => {
    const s = fresh(MORTAR_DECK);
    const why = (p: PlayerIndex, x: number, y: number) => {
      const r = buildingDeployCheck(s, p, x, y, MORTAR);
      return r.ok ? "ok" : r.reason;
    };
    expect(why(0, 50, 80)).toBe("Deployment on river or bridge");
    expect(why(0, 30, 44)).toBe("Deployment on structure");
    expect(why(0, 30, 100)).toBe("Deployment outside own territory");
    expect(why(0, 2, 50)).toBe("Deployment outside arena territory");
    expect(why(0, 50, 60)).toBe("ok");
    expect(why(1, 50, 100)).toBe("ok");
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 50, 60), d(2, 1, 1, "rift_mortar", 50, 100)]);
    expect(s.energy[0]).toBe(0);
    expect(s.energy[1]).toBe(0);
    expect(s.buildings.map((b) => b.cardId)).toEqual(["rift_mortar", "rift_mortar"]);
  });

  it("fires exactly at +30 then every 40 ticks, max 7 shots in its 300-tick life", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 40, 70)]);
    stepTo(s, [], 400);
    expect(fired(s).map((e) => e.tick)).toEqual([31, 71, 111, 151, 191, 231, 271]);
    expect(fired(s)).toHaveLength(7);
    expect(s.events.some((e) => e.type === "building_removed" && e.reason === "expired")).toBe(true);
  });

  it("range band: reach 51 is out, 50 is in; minRange 12 dead zone ignored", () => {
    // Mortar at (30,50): enemy towers (30/70,120) sit at reach 67+, out of band.
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    // Enemy building at reach 51 (dist 53 - ring 2): never fired at.
    s.buildings.push(fakeBuilding("far", 1, "decoy_totem", 30, 103));
    stepTo(s, [], 45);
    expect(fired(s)).toHaveLength(0);
    // Move it to reach 50: the next shot locks on.
    s.buildings.find((b) => b.id === "far")!.y = 102;
    stepTo(s, [], 80);
    const shots = fired(s);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((e) => e.type === "siege_fired" && e.targetId === "far")).toBe(true);
    // Dead zone: the only candidate sits inside minRange -> no shot at all.
    const s2 = fresh();
    stepMatch(s2, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    s2.buildings.push(fakeBuilding("near", 1, "decoy_totem", 30, 60)); // dist 10 - 1 = 9 < 12
    stepTo(s2, [], 80);
    expect(fired(s2)).toHaveLength(0);
  });
});

describe("target selection and shell resolution", () => {
  it("priority: tower > enemy building > ground unit, never air", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 40, 70)]);
    // A building and a ground unit sit in band; the tower wins class 0.
    s.buildings.push(fakeBuilding("eb", 1, "decoy_totem", 40, 95));
    s.troops.push(fakeTroop("et", 1, "choglings", 42, 92));
    s.troops.push(fakeTroop("ea", 1, "hexwing", 44, 88, 0, "air"));
    stepTo(s, [], 40);
    expect(fired(s).map((e) => (e.type === "siege_fired" ? e.targetId : ""))).toEqual([enemyTower(s).id]);
    // Tower dies (patched hp, killed by the shell's 30 structure damage at +86).
    enemyTower(s).hp = 30;
    stepTo(s, [], 90);
    const towerGone = s.events.find((e) => e.type === "structure_destroyed");
    expect(towerGone).toBeDefined();
    stepTo(s, [], 120);
    const afterTower = fired(s).filter((e) => e.type === "siege_fired" && e.tick > towerGone!.tick);
    expect(afterTower.length).toBeGreaterThan(0);
    expect(afterTower.every((e) => e.type === "siege_fired" && e.targetId === "eb")).toBe(true);
    // Building gone too: only the ground troop remains a candidate (air never is).
    s.buildings.find((b) => b.id === "eb")!.alive = false;
    stepTo(s, [], 160);
    const last = fired(s).at(-1)!;
    expect(last.type === "siege_fired" && last.targetId).toBe("et");
    expect(fired(s).every((e) => e.type === "siege_fired" && e.targetId !== "ea")).toBe(true);
  });

  it("a Hexwing alone in range never draws a shot", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    s.troops.push(fakeTroop("ea", 1, "hexwing", 30, 90, 0, "air"));
    stepTo(s, [], 80);
    expect(fired(s)).toHaveLength(0);
  });

  it("the shell lands flightTicks later: 30 to a tower, 40 to a building, 40 to a ground troop", () => {
    // Tower at reach ~46 from (40,70), in band.
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 40, 70)]);
    const tower = enemyTower(s);
    const hp = tower.hp;
    stepTo(s, [], 47);
    const land = impacts(s);
    expect(land).toHaveLength(1);
    expect(land[0]!.tick).toBe(46);
    expect(land[0]!).toMatchObject({ cardId: "rift_mortar", structures: 1 });
    expect(tower.hp).toBe(hp - 30);
    // Building target: 40 building damage.
    const s2 = fresh();
    stepMatch(s2, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    s2.buildings.push(fakeBuilding("eb", 1, "decoy_totem", 30, 99)); // reach 48
    s2.buildings.find((b) => b.id === "eb")!.hp = 260;
    stepTo(s2, [], 50);
    expect(impacts(s2)[0]!).toMatchObject({ buildings: 1 });
    expect(s2.buildings.find((b) => b.id === "eb")!.hp).toBe(220);
    // Ground troop target: 40 unit damage, radius 4, enemy only.
    const s3 = fresh();
    stepMatch(s3, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    s3.troops.push(fakeTroop("et", 1, "choglings", 60, 90));
    s3.troops.push(fakeTroop("ft", 0, "choglings", 62, 90)); // friendly in radius: never hit
    stepTo(s3, [], 50);
    expect(impacts(s3)[0]!).toMatchObject({ units: 1 });
    expect(s3.troops.find((t) => t.id === "et")!.hp).toBe(160);
    expect(s3.troops.find((t) => t.id === "ft")!.hp).toBe(200);
  });

  it("a unit that leaves the snapshot point dodges the shell", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    s.troops.push(fakeTroop("et", 1, "choglings", 39, 99));
    stepTo(s, [], 32);
    expect(fired(s).length).toBe(1);
    // The unit is gone from the snapshot cell when the shell lands at +46.
    const t = s.troops.find((x) => x.id === "et")!;
    t.x = 20;
    t.y = 120; // outside every enemy tower's range, still a legal cell
    stepTo(s, [], 48);
    expect(impacts(s)).toHaveLength(1);
    expect(t.hp).toBe(200);
  });

  it("a shell in flight still lands after the mortar is destroyed or expired", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 40, 70)]);
    stepTo(s, [], 32);
    expect(fired(s)).toHaveLength(1);
    s.buildings[0]!.alive = false;
    s.buildings[0]!.hp = 0;
    stepTo(s, [], 40);
    expect(s.buildings.filter((b) => b.alive)).toHaveLength(0);
    const tower = enemyTower(s);
    const hp = tower.hp;
    stepTo(s, [], 50);
    expect(impacts(s)).toHaveLength(1);
    expect(tower.hp).toBe(hp - 30);
  });
});

describe("counterplay and interactions", () => {
  it("Riftbreaker deals 66/hit to the mortar and destroys it", () => {
    const s = fresh(deckWith("riftbreaker"));
    stepTo(s, [d(1, 0, 1, "rift_mortar", 50, 60), d(2, 1, 2, "riftbreaker", 50, 90)], 600);
    const removed = s.events.find((e) => e.type === "building_removed" && e.cardId === "rift_mortar");
    expect(removed?.type === "building_removed" && removed.reason).toBe("destroyed");
    expect(removed?.type === "building_removed" && removed.tick).toBeLessThan(300);
  });

  it("Chaos Comet damages the mortar", () => {
    const s = fresh(deckWith("chaos_comet"));
    s.energy[1] = 10;
    stepTo(s, [d(1, 0, 1, "rift_mortar", 50, 60), d(2, 1, 5, "chaos_comet", 50, 60)], 40);
    expect(s.buildings[0]!.hp).toBe(160);
  });

  it("swarm troops inside the dead zone kill it; a Rift Sentry shoots the swarm down", () => {
    // No other target is in band (towers out of reach): the swarm fights
    // inside minRange where the mortar can never target them, and wins.
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 50, 60)]);
    for (const [i, x] of [[0, 47], [1, 50], [2, 53]] as const) {
      s.troops.push(fakeTroop(`sw${i}`, 1, "choglings", x, 66, 2, "ground", 12, 25));
      s.troops.at(-1)!.hp = s.troops.at(-1)!.maxHp = 60;
    }
    s.buildings[0]!.hp = 120; // low enough that the swarm wins inside the window
    stepTo(s, [], 300);
    const removed = s.events.find((e) => e.type === "building_removed" && e.cardId === "rift_mortar");
    expect(removed?.type === "building_removed" && removed.reason).toBe("destroyed");
    expect(fired(s).every((e) => e.type === "siege_fired" && !e.targetId.startsWith("sw"))).toBe(true);
    // With a Sentry beside it, the same swarm is shot down instead.
    const s2 = fresh();
    stepMatch(s2, [d(1, 0, 1, "rift_mortar", 50, 60), d(2, 0, 2, "rift_sentry", 46, 56)]);
    for (const [i, x] of [[0, 47], [1, 50], [2, 53]] as const) {
      s2.troops.push(fakeTroop(`sw${i}`, 1, "choglings", x, 66, 2, "ground", 12, 25));
      s2.troops.at(-1)!.hp = s2.troops.at(-1)!.maxHp = 60;
    }
    stepTo(s2, [], 400);
    const deaths = s2.events.filter((e) => e.type === "death").length;
    expect(deaths).toBeGreaterThan(0);
  });

  it("a Decoy Totem in band is shelled before any troop; a Chog Burrow is shelled as a building", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    s.buildings.push(fakeBuilding("eb", 1, "decoy_totem", 30, 99));
    s.troops.push(fakeTroop("et", 1, "choglings", 30, 97));
    stepTo(s, [], 40);
    expect(fired(s).map((e) => (e.type === "siege_fired" ? e.targetId : ""))).toEqual(["eb"]);
    const s2 = fresh();
    stepMatch(s2, [d(1, 0, 1, "rift_mortar", 30, 50)]);
    const burrow = fakeBuilding("bb", 1, "chog_burrow", 30, 99);
    burrow.hp = 300;
    s2.buildings.push(burrow);
    stepTo(s2, [], 50);
    expect(fired(s2)[0]).toMatchObject({ targetId: "bb" });
    expect(burrow.hp).toBe(260);
  });

  it("Chaos pulse and commander abilities leave the mortar untouched", () => {
    const hazard: ChaosSchedule = {
      rulesetVersion: "v1", patronRulesetVersion: "p1", patronTokenId: "1", patronConfigHash: "h", seedHash: "s",
      timeline: { durationMs: 180000, pulseAtMs: [45000, 90000, 135000], warnMs: 5000, overtimeMs: 30000 },
      scheduleHash: "x",
      events: [{ id: "hz1", slot: 0, family: "ember_rift", displayName: "Ember", warnMs: 0, activationMs: 2000, expireMs: 62000, zones: ["center"], telegraphed: true,
        effect: { kind: "hazard", hazardType: "area_damage", scope: "all_units", targets: "all_units", zones: ["center"], dps: 50, radiusPct: 10, telegraphMs: 0, durationMs: 60000, stacking: "refresh", expires: "expire_end" } }],
    };
    const s = initMatch(scenarioConfig(MORTAR_DECK, deckWith("chog_guardian"), hazard));
    stepTo(s, [d(1, 0, 1, "rift_mortar", 50, 60)], 40);
    expect(s.buildings[0]!.hp).toBe(300);
    // Enemy deadeye volley next to the mortar: abilities see units only.
    const s2 = initMatch(scenarioConfig(MORTAR_DECK, deckWith("cmdr:free-deadeye")));
    stepTo(s2, [d(1, 0, 1, "rift_mortar", 50, 60), d(2, 1, 2, "cmdr:free-deadeye", 50, 100)], 15);
    s2.energy[1] = 10;
    const cmdr = s2.commanders.find((c) => c.owner === 1)!;
    cmdr.cooldownUntil = 9999; // isolate the ability from the commander's own attack
    cmdr.x = 50;
    cmdr.y = 64;
    s2.buildings[0]!.hp = 300; // reset any incidental hits on the march
    // Only a building is in radius: the targeting gate is unit-only.
    stepTo(s2, [ab(3, 1, s2.tick + 1, "deadeye-piercing-volley")], s2.tick + 2);
    expect(s2.events.some((e) => e.type === "command_rejected" && /No enemies in range/.test((e as { reason?: string }).reason ?? ""))).toBe(true);
    // With a unit in radius it fires and hits the unit, never the mortar.
    s2.troops.push(fakeTroop("ft", 0, "choglings", 50, 66));
    stepTo(s2, [ab(4, 1, s2.tick + 1, "deadeye-piercing-volley")], s2.tick + 2);
    expect(s2.events.some((e) => e.type === "ability_fired" && e.abilityId === "deadeye-piercing-volley")).toBe(true);
    expect(s2.troops.find((t) => t.id === "ft")!.hp).toBe(130);
    expect(s2.buildings[0]!.hp).toBe(300);
  });
});

describe("symmetry and replay", () => {
  it("mirrored mortar placements fire mirrored shells", () => {
    const s = initMatch(scenarioConfig(MORTAR_DECK, MORTAR_DECK));
    stepMatch(s, [d(1, 0, 1, "rift_mortar", 40, 70), d(2, 1, 1, "rift_mortar", 40, 90)]);
    stepTo(s, [], 35);
    const [a, b] = fired(s) as Array<{ type: "siege_fired"; owner: PlayerIndex; x: number; y: number }>;
    expect(a.x).toBe(b.x);
    expect(a.y + b.y).toBe(160);
    expect(a.owner).toBe(0);
    expect(b.owner).toBe(1);
  });

  it("replays deterministically and stepped matches equal runMatch", () => {
    const cfg = () => scenarioConfig(MORTAR_DECK, deckWith("chog_guardian", "riftbreaker", "chaos_comet"));
    const bot = botMatch(cfg(), 3100, 20);
    const a = runMatch(cfg(), bot.commands);
    const b = runMatch(cfg(), bot.commands);
    expect(a.result.stateHash).toBe(b.result.stateHash);
    expect(a.result.stateHash).toBe(stateHash(bot.state));
    expect(fired(bot.state).length).toBeGreaterThan(0); // the bot actually sieged
  });

  it("botSiegeSpot finds a river-side cell that reaches the enemy tower", () => {
    const s = fresh(MORTAR_DECK);
    const spot = botSiegeSpot(s, 0, MORTAR);
    expect(spot).not.toBeNull();
    expect(buildingDeployCheck(s, 0, spot!.x, spot!.y, MORTAR).ok).toBe(true);
    const p1 = botSiegeSpot(s, 1, MORTAR);
    expect(p1).not.toBeNull();
    expect(p1!.y).toBe(160 - spot!.y);
    expect(p1!.x).toBe(spot!.x);
  });
});
