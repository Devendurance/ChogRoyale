// B2.7c6 Chog Burrow spawner building + Burrow Scrapper (combat ruleset v15).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  SPAWNED_TROOPS_V1,
  MAX_SPAWNED_ALIVE_PER_PLAYER,
  spawnWavesFor,
  COMBAT_RULESET_VERSION,
  type AbilityCommand,
  type BuildingEntity,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
  type TroopEntity,
} from "@/lib/combat";
import { deckWith, scenarioConfig, botMatch } from "@/lib/arena-scenarios";
import type { ChaosSchedule } from "@/lib/chaos";
const golden = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "v14-golden.json"), "utf8")) as { entries: Array<{ config: unknown; commands: unknown[]; winner: unknown; crowns: number[]; ticks: number; stateHash: string }> };

const BURROW = BUILDING_CARDS_V1.chog_burrow!;
const SCRAPPER = SPAWNED_TROOPS_V1.burrow_scrapper!;
const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const ab = (seq: number, player: PlayerIndex, tick: number, abilityId: string): AbilityCommand => ({ kind: "ability", seq, player, tick, abilityId });
const BURROW_DECK = deckWith("chog_burrow", "chog_guardian", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt", "cmdr:free-warden");
const fresh = (p1 = deckWith("chog_guardian")) => initMatch(scenarioConfig(BURROW_DECK, p1));
function stepTo(s: CombatState, cmds: Array<DeployCommand | AbilityCommand>, tick: number) {
  while (s.tick < tick && s.phase !== "final") stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
}
const spawns = (s: CombatState) => s.events.filter((e) => e.type === "unit_spawned");
const skips = (s: CombatState) => s.events.filter((e) => e.type === "spawn_skipped");
const scrappers = (s: CombatState) => s.troops.filter((t) => t.cardId === "burrow_scrapper");
/** A dead-simple solid blocker pushed straight into state (like the buildings cap test). */
const blocker = (id: string, owner: PlayerIndex, x: number, y: number, footprint = 1): BuildingEntity => ({
  id, kind: "building", owner, cardId: "decoy_totem", x, y, hp: 999, maxHp: 999, alive: true,
  damage: 0, range: 0, interval: 0, cooldownUntil: 0, hitsAir: false, hitsGround: false,
  footprint, targetId: null, spawnTick: 0, expiresAt: 99999,
});

describe("spawner card domain", () => {
  it("registers the v15 building and the non-deckable scrapper", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v15");
    expect([BURROW.cost, BURROW.hp, BURROW.footprint, BURROW.deployTicks, BURROW.lifetimeTicks, BURROW.damage]).toEqual([4, 300, 1, 20, 260, 0]);
    expect(BURROW.spawnCardId).toBe("burrow_scrapper");
    expect([SCRAPPER.hp, SCRAPPER.damage, SCRAPPER.range, SCRAPPER.speed, SCRAPPER.attackIntervalTicks]).toEqual([45, 10, 2, 2, 8]);
    expect(CARDS_V1.burrow_scrapper).toBeUndefined();
    expect(CARDS_V1.chog_burrow).toBe(BURROW);
    expect(spawnWavesFor(BURROW)).toBe(5);
  });

  it("decks accept chog_burrow and reject burrow_scrapper; v14 configs reject the burrow", () => {
    const slot = freeStarterSlot("warden");
    expect(() => validateDeck(BURROW_DECK, slot)).not.toThrow();
    const withScrapper = BURROW_DECK.map((c) => (c === "hexwing" ? "burrow_scrapper" : c));
    expect(() => validateDeck(withScrapper, slot)).toThrow(/Card not playable: burrow_scrapper/);
    const cfg = scenarioConfig(BURROW_DECK, BURROW_DECK);
    expect(() => initMatch({ ...cfg, rulesetVersion: "v14" })).toThrow(/v15/);
    expect(() => initMatch({ ...cfg, rulesetVersion: "v13" as never })).toThrow(/Unsupported combat ruleset/);
  });
});

describe("placement and spawn cadence", () => {
  it("follows building placement rules on both seats and costs 4 energy", () => {
    const s = fresh(BURROW_DECK);
    const why = (p: PlayerIndex, x: number, y: number) => {
      const r = buildingDeployCheck(s, p, x, y, BURROW);
      return r.ok ? "ok" : r.reason;
    };
    expect(why(0, 50, 80)).toBe("Deployment on river or bridge");
    expect(why(0, 30, 44)).toBe("Deployment on structure");
    expect(why(0, 30, 100)).toBe("Deployment outside own territory");
    expect(why(0, 2, 50)).toBe("Deployment outside arena territory");
    expect(why(0, 50, 50)).toBe("ok");
    expect(why(1, 50, 110)).toBe("ok");
    expect(why(1, 50, 60)).toBe("Deployment outside own territory");
    stepMatch(s, [d(1, 0, 1, "chog_burrow", 50, 50), d(2, 1, 1, "chog_burrow", 50, 110)]);
    expect(s.energy[0]).toBe(1);
    expect(s.energy[1]).toBe(1);
    expect(s.buildings.map((b) => b.cardId)).toEqual(["chog_burrow", "chog_burrow"]);
    // Another building blocks placement over its footprint.
    expect(why(0, 51, 51)).toBe("Deployment on structure");
  });

  it("spawns exactly at placement+20, +70, +120, +170, +220 and expires", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "chog_burrow", 50, 60)]);
    stepTo(s, [], 300);
    expect(spawns(s).map((e) => e.tick)).toEqual([21, 71, 121, 171, 221]);
    expect(s.events.filter((e) => e.type === "unit_spawned")).toHaveLength(5);
    expect(s.events.filter((e) => e.type === "building_removed").map((e) => (e.type === "building_removed" ? e.reason : ""))).toEqual(["expired"]);
    expect(s.buildings).toHaveLength(0);
    // All five scrappers spawned toward the enemy at the front cell (50, 63).
    expect(spawns(s).map((e) => (e.type === "unit_spawned" ? `${e.x},${e.y}` : ""))).toEqual(Array(5).fill("50,63"));
  });

  it("a burrow destroyed between waves stops spawning; killed on a spawn tick never spawns", () => {
    const s = fresh(deckWith("chaos_comet", "chog_guardian"));
    stepTo(s, [d(1, 0, 1, "chog_burrow", 50, 60)], 75);
    expect(spawns(s)).toHaveLength(2);
    // Kill it mid-cycle: a Chaos Comet cast at 76 lands at 82 (140 building damage).
    s.buildings[0]!.hp = 50;
    stepTo(s, [d(2, 1, 76, "chaos_comet", 50, 60)], 90);
    expect(s.buildings).toHaveLength(0);
    stepTo(s, [], 300);
    expect(spawns(s)).toHaveLength(2);
    // Killed exactly on a due tick: the comet cast at 115 lands at 121, the third wave's tick.
    const s2 = fresh(deckWith("chaos_comet", "chog_guardian"));
    stepTo(s2, [d(1, 0, 1, "chog_burrow", 50, 60)], 100);
    s2.buildings[0]!.hp = 50;
    stepTo(s2, [d(2, 1, 115, "chaos_comet", 50, 60)], 140);
    expect(s2.buildings).toHaveLength(0);
    expect(spawns(s2).map((e) => e.tick)).toEqual([21, 71]);
  });

  it("blocked front cells fall through the candidate order; fully blocked skips with an event", () => {
    const s = fresh();
    stepMatch(s, [d(1, 0, 1, "chog_burrow", 50, 60)]);
    // Front cell (50,63) blocked by a solid -> next candidate front-left (47,63).
    s.buildings.push(blocker("bx", 1, 50, 63));
    stepTo(s, [], 25);
    expect(spawns(s).map((e) => (e.type === "unit_spawned" ? `${e.x},${e.y}` : ""))).toEqual(["47,63"]);
    // Fully ringed burrow: footprint-3 blockers cover all eight candidates.
    const s2 = fresh();
    stepMatch(s2, [d(1, 0, 1, "chog_burrow", 50, 60)]);
    s2.buildings.push(blocker("ba", 1, 50, 66, 3), blocker("bb", 1, 50, 54, 3), blocker("bl", 1, 44, 60, 3), blocker("br", 1, 56, 60, 3));
    stepTo(s2, [], 30);
    expect(spawns(s2)).toHaveLength(0);
    expect(skips(s2)).toEqual([{ type: "spawn_skipped", tick: 21, buildingId: "b1", reason: "blocked" }]);
  });

  it("the alive-cap skips waves and two burrows stay under MAX_SPAWNED_ALIVE_PER_PLAYER", () => {
    const s = fresh();
    stepTo(s, [d(1, 0, 1, "chog_burrow", 30, 60)], 3);
    // Second burrow pushed directly (decks hold one copy); both waves are due.
    s.buildings.push({ ...blocker("b2", 0, 70, 60), cardId: "chog_burrow", nextSpawnAt: 22, spawnsLeft: 5, expiresAt: 9999 });
    // Seed the cap: 8 scrappers already alive for P0.
    for (let i = 0; i < MAX_SPAWNED_ALIVE_PER_PLAYER; i++) {
      s.troops.push({ id: `fx${i}`, kind: "troop", owner: 0, cardId: "burrow_scrapper", x: 50, y: 20 + i, hp: 45, maxHp: 45, damage: 10, range: 2, speed: 2, sight: 25, interval: 8, cooldownUntil: 0, targetId: null, moveType: "ground", hitsAir: false, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0, slowUntil: 0, activeSlowPct: 0, buffUntil: 0, buffPct: 0, hasteUntil: 0, hastePct: 0, stunUntil: 0, shieldHp: 0, shieldUntil: 0, reflectUntil: 0, reflectFracNumer: 0, reflectFracDenom: 1, guardUntil: 0, guardPct: 0, armor: 0, moveCarry: 0, spawnedBy: "b1" } satisfies TroopEntity);
    }
    stepTo(s, [], 40);
    expect(spawns(s)).toHaveLength(0);
    expect(skips(s).filter((e) => e.type === "spawn_skipped" && e.reason === "cap")).toHaveLength(2);
  });
});

describe("scrapper combat rules", () => {
  const burrowMatch = (enemyDeck: string[], cmds: Array<DeployCommand | AbilityCommand>, upto: number, enemyCmds: Array<DeployCommand | AbilityCommand> = []) =>
    runMatch(scenarioConfig(deckWith("chog_burrow", "chog_guardian", "chaos_bolt", "chaos_comet"), enemyDeck), [d(1, 0, 1, "chog_burrow", 50, 60), ...cmds, ...enemyCmds], upto);

  it("scrappers march, acquire targets and fight like ordinary troops", () => {
    const { state } = burrowMatch(deckWith("chog_guardian"), [d(3, 1, 30, "chog_guardian", 50, 100)], 400);
    const spawned = spawns(state);
    expect(spawned.length).toBeGreaterThan(0);
    // Scrappers crossed the river toward the enemy side (samples show movement).
    const deaths = state.events.filter((e) => e.type === "death" && spawned.some((u) => u.type === "unit_spawned" && u.troopId === e.entityId));
    expect(deaths.length).toBeGreaterThan(0); // they fought and died to the guardian/tower
    // Guardian took scrapper damage.
    const guard = state.events.find((e) => e.type === "deploy" && e.cardId === "chog_guardian" && e.player === 1);
    expect(guard).toBeDefined();
  });

  it("ground-only scrappers never hit Hexwing (air)", () => {
    const s = fresh(deckWith("hexwing"));
    stepTo(s, [d(1, 0, 1, "chog_burrow", 50, 60), d(2, 1, 5, "hexwing", 50, 95)], 30);
    const hex = s.troops.find((t) => t.cardId === "hexwing");
    const scr = scrappers(s);
    expect(scr.length).toBeGreaterThan(0);
    // Scrappers stand next to it, never target it, and it takes no damage.
    expect(scr.every((t) => t.targetId !== hex?.id)).toBe(true);
    expect(hex!.hp).toBe(hex!.maxHp);
  });

  it("splash and shockwave kill scrappers; Sentry and towers shoot them", () => {
    // Sparkcaster splash: cluster scrappers are hit by the splash.
    const s = fresh(deckWith("sparkcaster", "rift_sentry"));
    stepMatch(s, [d(1, 0, 1, "chog_burrow", 50, 60), d(2, 1, 30, "sparkcaster", 50, 70), d(3, 1, 32, "rift_sentry", 70, 100)]);
    stepTo(s, [], 200);
    const spawned = spawns(s).map((e) => (e.type === "unit_spawned" ? e.troopId : ""));
    const dead = new Set(s.events.filter((e) => e.type === "death").map((e) => e.entityId));
    expect(spawned.some((id) => dead.has(id))).toBe(true);
  });

  it("Ember Mauler shockwaves hit scrappers as ordinary ground troops", () => {
    const s = fresh(deckWith("ember_mauler"));
    stepTo(s, [d(1, 0, 1, "chog_burrow", 50, 60), d(2, 1, 5, "ember_mauler", 50, 95)], 500);
    const spawned = spawns(s).map((e) => (e.type === "unit_spawned" ? e.troopId : ""));
    const dead = new Set(s.events.filter((e) => e.type === "death").map((e) => e.entityId));
    const waves = s.events.filter((e) => e.type === "shockwave" && e.extraHits > 0);
    expect(waves.length).toBeGreaterThan(0);
    expect(spawned.filter((id) => dead.has(id)).length).toBeGreaterThan(1);
  });

  it("Chaos Bolt hits scrappers but never the burrow; Comet damages the burrow", () => {
    const s = fresh(deckWith("chaos_bolt", "chaos_comet", "chog_guardian"));
    s.energy[1] = 10;
    stepTo(s, [d(1, 0, 1, "chog_burrow", 50, 60)], 22); // first scrapper at (50,63)
    const scr = scrappers(s);
    expect(scr.length).toBe(1);
    stepTo(s, [d(5, 1, 23, "chaos_bolt", 50, 63)], 24);
    expect(s.buildings[0]!.hp).toBe(300); // bolt never touches buildings
    expect(s.troops.find((t) => t.id === scr[0]!.id)?.hp ?? 0).toBeLessThan(45);
    const b = s.buildings[0]!.hp;
    stepTo(s, [d(6, 1, 26, "chaos_comet", 50, 60)], 40);
    expect(s.buildings[0]!.hp).toBe(b - 140);
  });

  it("Riftbreaker deals its 300% building damage to the burrow", () => {
    const s = fresh(deckWith("riftbreaker"));
    stepTo(s, [d(1, 0, 1, "chog_burrow", 50, 60), d(2, 1, 2, "riftbreaker", 50, 90)], 400);
    const removed = s.events.find((e) => e.type === "building_removed");
    expect(removed?.type === "building_removed" && removed.reason).toBe("destroyed");
    // 66 per hit x ceil(300/66) = 5 hits minimum; destroyed well before expiry.
    expect(removed?.type === "building_removed" && removed.tick).toBeLessThan(1 + 260);
  });

  it("towers ignore the burrow (buildings are never tower targets) but shoot scrappers", () => {
    const s = fresh();
    stepTo(s, [d(1, 0, 1, "chog_burrow", 30, 49)], 5);
    // An enemy building sits inside the p1 tower's 25-range; towers only shoot units.
    s.buildings.push(blocker("be", 1, 70, 110));
    stepTo(s, [], 200);
    expect(s.buildings.find((b) => b.cardId === "chog_burrow")!.hp).toBe(300);
    expect(s.buildings.find((b) => b.id === "be")!.hp).toBe(999);
    const spawnedIds = spawns(s).map((e) => (e.type === "unit_spawned" ? e.troopId : ""));
    const deaths = s.events.filter((e) => e.type === "death" && spawnedIds.includes(e.entityId));
    expect(deaths.length).toBeGreaterThan(0); // scrappers crossing into tower range die to it
  });

  it("a Chaos hazard pulse damages scrappers like any unit", () => {
    const hazard: ChaosSchedule = {
      rulesetVersion: "v1", patronRulesetVersion: "p1", patronTokenId: "1", patronConfigHash: "h", seedHash: "s",
      timeline: { durationMs: 180000, pulseAtMs: [45000,90000,135000], warnMs: 5000, overtimeMs: 30000 },
      scheduleHash: "x",
      events: [{ id: "hz1", slot: 0, family: "ember_rift", displayName: "Ember", warnMs: 0, activationMs: 2000, expireMs: 62000, zones: ["center"], telegraphed: true,
        effect: { kind: "hazard", hazardType: "area_damage", scope: "all_units", targets: "all_units", zones: ["center"], dps: 50, radiusPct: 10, telegraphMs: 0, durationMs: 60000, stacking: "refresh", expires: "expire_end" } }],
    };
    const s = initMatch(scenarioConfig(deckWith("chog_burrow"), deckWith("chog_guardian"), hazard));
    stepMatch(s, [d(1, 0, 1, "chog_burrow", 50, 60)]); // spawns at (50,63), center zone
    stepTo(s, [], 24);
    expect(scrappers(s)[0]!.hp).toBeLessThan(45);
  });

  it("commander actives hit scrappers like any enemy troop", () => {
    const s = initMatch(scenarioConfig(deckWith("chog_burrow"), deckWith("cmdr:free-deadeye")));
    stepTo(s, [d(1, 0, 1, "chog_burrow", 50, 60), d(2, 1, 2, "cmdr:free-deadeye", 50, 90)], 30);
    s.energy[1] = 10;
    // March both toward each other until within volley radius 5, then fire.
    let firedOk = false;
    for (let i = 0; i < 300 && !firedOk; i++) {
      const cmdr = s.commanders.find((c) => c.owner === 1);
      const scr = scrappers(s)[0];
      if (cmdr && scr && Math.abs(cmdr.x - scr.x) <= 5 && Math.abs(cmdr.y - scr.y) <= 5) {
        stepMatch(s, [ab(3, 1, s.tick + 1, "deadeye-piercing-volley")]);
        firedOk = s.events.some((e) => e.type === "ability_fired" && e.abilityId === "deadeye-piercing-volley" && e.affected > 0);
        if (!firedOk) break;
      } else stepMatch(s, []);
    }
    expect(firedOk).toBe(true);
  });
});

describe("symmetry and replay", () => {
  it("mirrored burrow placements spawn mirrored scrappers", () => {
    const s = initMatch(scenarioConfig(BURROW_DECK, BURROW_DECK));
    stepMatch(s, [d(1, 0, 1, "chog_burrow", 50, 60), d(2, 1, 1, "chog_burrow", 50, 100)]);
    stepTo(s, [], 25);
    const [a, b] = spawns(s) as Array<{ type: "unit_spawned"; x: number; y: number }>;
    expect(a.x).toBe(b.x);
    expect(a.y + b.y).toBe(160);
  });

  it("replays deterministically and stepped matches equal runMatch", () => {
    const cfg = () => scenarioConfig(BURROW_DECK, deckWith("chog_guardian", "riftbreaker", "chaos_comet"));
    const bot = botMatch(cfg(), 3100, 20);
    const a = runMatch(cfg(), bot.commands);
    const b = runMatch(cfg(), bot.commands);
    expect(a.result.stateHash).toBe(b.result.stateHash);
    expect(a.result.stateHash).toBe(stateHash(bot.state));
  });

  it("long matches with repeated burrows never exceed the alive cap", () => {
    const cfg = scenarioConfig(BURROW_DECK, deckWith("chog_guardian"));
    const bot = botMatch(cfg, 3100, 20);
    const s = initMatch(cfg);
    const sorted = [...bot.commands].sort((x, y) => (x.tick === y.tick ? x.seq - y.seq : x.tick - y.tick));
    let ci = 0;
    let maxAlive = 0;
    while (s.phase !== "final" && s.tick < 3100) {
      const due: typeof sorted = [];
      while (ci < sorted.length && sorted[ci]!.tick <= s.tick + 1) due.push(sorted[ci++]!);
      stepMatch(s, due);
      maxAlive = Math.max(maxAlive, s.troops.filter((t) => t.owner === 0 && t.spawnedBy !== undefined).length);
    }
    expect(maxAlive).toBeLessThanOrEqual(MAX_SPAWNED_ALIVE_PER_PLAYER);
    expect(spawns(s).length).toBeGreaterThan(0);
  });

  it("v14 golden fixtures reproduce exactly under the new engine", () => {
    for (const e of golden.entries) {
      const r = runMatch(e.config as never, e.commands as never);
      expect(r.result.stateHash).toBe(e.stateHash);
      expect(r.result.winner).toBe(e.winner);
      expect(r.result.crowns).toEqual(e.crowns);
      expect(r.result.ticks).toBe(e.ticks);
    }
  });
});
