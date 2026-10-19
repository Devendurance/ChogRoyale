import { describe, expect, it } from "vitest";
import {
  initMatch,
  runMatch,
  stepMatch,
  stateHash,
  validateDeck,
  CARDS_V1,
  SPELL_CARDS_V1,
  TROOP_CARDS_V1,
  COMBAT_RULESET_VERSION,
  type CombatState,
  type DeployCommand,
  type PlayerIndex,
} from "@/lib/combat";
import { scenarioConfig, deckWith, slotForDeck, traceMatch } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V9, runMatchup, summarizeMatchup } from "@/lib/building-matchup";
import {
  cometTroops,
  cometBuilding,
  cometStructures,
  cometSuddenDeath,
  snareSlow,
  airGroundRules,
  cheapDefense,
  spritesSoak,
  buildingSpellCounter,
  oppositeLane,
  tacticalMatch,
  holdSpot,
} from "@/lib/spell-scenarios";

const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const rejections = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [e.reason] : []));

describe("B2.7b card registry and deck economy", () => {
  it("registers three versioned cards under ruleset v9", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v16");
    expect(CARDS_V1.chaos_comet?.cost).toBe(4);
    expect(CARDS_V1.rift_snare?.cost).toBe(2);
    expect(CARDS_V1.rift_sprites?.cost).toBe(1);
    const comet = SPELL_CARDS_V1.chaos_comet!.impact!;
    expect(comet.structureDamage).toBeLessThan(comet.unitDamage);
    expect(Number.isInteger(comet.structureDamage) && Number.isInteger(comet.unitDamage)).toBe(true);
    expect(SPELL_CARDS_V1.rift_snare!.impact!.unitDamage).toBeLessThan(SPELL_CARDS_V1.chaos_bolt!.damage);
    expect(SPELL_CARDS_V1.rift_snare!.impact!.buildingDamage + SPELL_CARDS_V1.rift_snare!.impact!.structureDamage).toBe(0);
    const sprites = TROOP_CARDS_V1.rift_sprites!;
    expect([sprites.moveType, sprites.hitsAir, sprites.count]).toEqual(["air", false, 2]);
    expect(sprites.hp).toBeLessThan(TROOP_CARDS_V1.choglings!.hp);
  });

  it("accepts the new cards in 7+1 decks and rejects unknown or duplicate cards", () => {
    for (const deck of Object.values(MATCHUP_DECKS_V9)) expect(() => validateDeck(deck, slotForDeck(deck))).not.toThrow();
    const deck = MATCHUP_DECKS_V9.siege!;
    expect(() => validateDeck(deck.map((c) => (c === "chaos_comet" ? "chaos_meteor" : c)), slotForDeck(deck))).toThrow();
    expect(() => validateDeck(deck.map((c) => (c === "rift_sprites" ? "chaos_comet" : c)), slotForDeck(deck))).toThrow();
  });

  it("rejects insufficient energy, cards not in hand and off-arena targets without side effects", () => {
    const cfg = () => scenarioConfig(deckWith("chaos_comet", "rift_snare", "rift_sprites"), deckWith());
    const r = runMatch(cfg(), [d(1, 0, 2, "chaos_comet", 30, 130), d(2, 0, 2, "rift_snare", 30, 130), d(3, 0, 3, "chaos_bolt", 30, 130), d(4, 0, 4, "rift_sprites", 120, 50)], 10).state;
    const reasons = rejections(r);
    expect(reasons).toEqual(["Insufficient energy", "Card chaos_bolt not in hand", expect.stringMatching(/outside|territory|arena/i)]);
    expect(r.pendingImpacts).toEqual([]);
    expect(r.events.filter((e) => e.type === "spell_cast")).toHaveLength(1);
  });

  it("deploys Rift Sprites as a legal two-unit air troop and rejects the river", () => {
    const cfg = () => scenarioConfig(deckWith("rift_sprites"), deckWith());
    const ok = runMatch(cfg(), [d(1, 0, 2, "rift_sprites", 30, 50)], 3).state;
    expect(ok.troops.filter((t) => t.cardId === "rift_sprites").map((t) => [t.moveType, t.hp])).toEqual([["air", 24], ["air", 24]]);
    expect(ok.energy[0]).toBeLessThan(5);
    const river = runMatch(cfg(), [d(1, 0, 2, "rift_sprites", 30, 80)], 3).state;
    expect(river.troops).toHaveLength(0);
    expect(rejections(river)).toHaveLength(1);
  });
});

describe("B2.7b Chaos Comet", () => {
  it("A: hits every enemy troop in the blast at once and never the caster's tower", () => {
    const r = cometTroops();
    expect(r.impacts).toEqual([{ tick: r.castTick + 6, cardId: "chaos_comet", units: 3, buildings: 0, structures: 0 }]);
    expect([r.p1Alive, r.p1AliveControl]).toEqual([0, 3]);
    expect(r.ownTowerHp).toBeGreaterThan(r.ownTowerHpControl);
  });

  it("never damages the caster's own buildings or structures", () => {
    const s = runMatch(scenarioConfig(deckWith("rift_sentry", "chaos_comet"), deckWith()), [d(1, 0, 2, "rift_sentry", 30, 56), d(2, 0, 90, "chaos_comet", 30, 56)], 100).state;
    expect(rejections(s)).toEqual([]);
    expect(s.buildings[0]!.hp).toBe(320);
    expect(s.structures.every((x) => x.hp === x.maxHp)).toBe(true);
    expect(s.events.find((e) => e.type === "spell_impact")).toMatchObject({ units: 0, buildings: 0, structures: 0 });
  });

  it("B: damages enemy buildings while Chaos Bolt stays troops-only", () => {
    const r = cometBuilding();
    expect([r.totemAfterComet, r.sentryAfterComet, r.totemAfterBolt]).toEqual([120, 180, 260]);
    expect(r.boltAffected).toEqual([0]);
  });

  it("C: towers and the Core take the reduced 42 structure damage", () => {
    const r = cometStructures();
    expect([r.towerHp, r.coreHp]).toEqual([558, 958]);
  });

  it("hits commanders through shields/armor (Chaos Bolt never does)", () => {
    const p0 = deckWith("chaos_comet", "chaos_bolt");
    const p1 = deckWith("cmdr:free-bulwark");
    const dep = d(1, 1, 2, "cmdr:free-bulwark", 30, 100);
    const probe = traceMatch(scenarioConfig(p0, p1), [dep], 600);
    const spot = holdSpot(probe.samples, 1, "commander:bulwark", 7)!;
    expect(spot).not.toBeNull();
    const hp = (cmds: DeployCommand[]) => runMatch(scenarioConfig(p0, p1), cmds, spot.tick + 6).state.commanders.find((c) => c.owner === 1)?.hp ?? 0;
    const control = hp([dep]);
    const comet = hp([dep, d(2, 0, spot.tick, "chaos_comet", spot.x, spot.y)]);
    const bolt = hp([dep, d(2, 0, spot.tick + 5, "chaos_bolt", spot.x, spot.y)]);
    expect(control - comet).toBeGreaterThan(0);
    expect(control - comet).toBeLessThanOrEqual(140);
    expect(bolt).toBe(control);
  });

  it("D: a Comet that destroys a tower in overtime awards the crown and ends sudden death", () => {
    const r = cometSuddenDeath();
    expect(r.rejected).toEqual([]);
    expect(r.p0UnitsEver).toBe(0);
    expect(r.comets).toBe(15);
    expect([r.winner, r.endReason, r.crowns]).toEqual([0, "overtime", [1, 0]]);
    expect(r.destroyTick).toBeGreaterThan(1800);
    expect(r.destroyedBy).toEqual([{ tick: r.destroyTick, cardId: "chaos_comet", units: 0, buildings: 0, structures: 1 }]);
    expect(runMatch(r.cfg, r.commands).result.stateHash).toBe(runMatch(r.cfg, [...r.commands].reverse()).result.stateHash);
  });

  it("a Comet that destroys the Core settles a 3-crown Core win and later input cannot change it", () => {
    const cfg = scenarioConfig(deckWith("chaos_comet", "rift_snare"), deckWith());
    const s = initMatch(cfg);
    const core = s.structures.find((x) => x.id === "s-p1-core")!;
    core.hp = 30;
    for (let i = 0; i < 12 && s.phase !== "final"; i++) stepMatch(s, s.tick === 0 ? [d(1, 0, 1, "chaos_comet", core.x, core.y)] : []);
    expect([s.winner, s.endReason, s.crowns]).toEqual([0, "core", [3, 0]]);
    const h = stateHash(s);
    stepMatch(s, [d(2, 0, s.tick + 1, "rift_snare", 50, 100)]);
    expect(stateHash(s)).toBe(h);
  });
});

describe("B2.7b Rift Snare", () => {
  it("E: damages, slows 40% for 50 ticks, then the unit moves at full speed again", () => {
    const r = snareSlow();
    expect(r.impacts).toEqual([{ tick: 3, cardId: "rift_snare", units: 1, buildings: 0, structures: 0 }]);
    expect(r.slowUntil).toBe(53);
    expect(r.baseSpeed).toBe(2);
    expect(r.cellsDuringSlow.snared).toBeLessThan(r.cellsDuringSlow.control);
    expect(r.cellsAfterSlow.snared).toBe(20);
  });

  it("uses shared slow stacking: strongest active wins, expired slows reset", () => {
    const cfg = scenarioConfig(deckWith("rift_snare", "chaos_comet"), deckWith("chog_guardian"));
    const s = initMatch(cfg);
    stepMatch(s, [d(1, 1, 1, "chog_guardian", 30, 150)]);
    const g = s.troops[0]!;
    g.slowUntil = s.tick + 30;
    g.activeSlowPct = 50;
    stepMatch(s, [d(2, 0, s.tick + 1, "rift_snare", g.x, g.y)]);
    expect([g.activeSlowPct, g.slowUntil]).toEqual([50, s.tick + 50]);
    for (let i = 0; i < 60; i++) stepMatch(s, []);
    expect(s.tick).toBeGreaterThanOrEqual(g.slowUntil);
    const s2 = initMatch(cfg);
    stepMatch(s2, [d(1, 1, 1, "chog_guardian", 30, 150)]);
    const g2 = s2.troops[0]!;
    g2.slowUntil = s2.tick;
    g2.activeSlowPct = 50;
    stepMatch(s2, [d(2, 0, s2.tick + 1, "rift_snare", g2.x, g2.y)]);
    expect(g2.activeSlowPct).toBe(40);
    expect(g2.speed).toBe(2);
  });

  it("never touches buildings", () => {
    const s = runMatch(scenarioConfig(deckWith("rift_snare"), deckWith("decoy_totem")), [d(1, 1, 2, "decoy_totem", 30, 104), d(2, 0, 3, "rift_snare", 30, 104)], 5).state;
    expect(s.buildings[0]!.hp).toBe(260);
  });
});

describe("B2.7b air/ground, cheap-cycle and counterplay", () => {
  it("F: spells hit air and ground; Sentry ignores air Sprites; Sprites cannot hit air", () => {
    const r = airGroundRules();
    expect([r.snareAirUnits, r.snareGroundUnits, r.hexSlowed]).toEqual([1, 3, true]);
    expect(r.cometOnHex[0]?.units).toBe(1);
    expect(r.hexAliveAfterComet).toBe(false);
    expect([r.sentryHitSprites, r.spritesTargetedHex, r.spritesDied]).toEqual([false, false, true]);
  });

  it("G/H: 1-energy Sprites and a 2-energy Totem each save tower HP against a 5-energy Boulderback", () => {
    const r = cheapDefense();
    expect(r.control.boulderbackDied && r.sprites.boulderbackDied && r.totem.boulderbackDied).toBe(true);
    expect(r.sprites.towerHp).toBeGreaterThan(r.control.towerHp);
    expect(r.totem.towerHp).toBeGreaterThan(r.control.towerHp);
    expect(r.sprites.lastSeen!).toBeLessThan(r.control.lastSeen!);
    const soak = spritesSoak();
    expect(soak.towerWithSprites).toBeLessThan(soak.towerAlone);
  });

  it("I: a Sentry stops a rush, and a Comet on the Sentry lets a push through", () => {
    const r = buildingSpellCounter();
    expect([r.rush.runnerAlive, r.rush.tower]).toEqual([false, 600]);
    expect(r.cometPush.sentry.startsWith("destroyed")).toBe(true);
    expect(r.cometPush.tower).toBeLessThan(r.push.tower);
  });

  it("J: answering an unsupported push cheaply and countering in the other lane pays off", () => {
    const r = oppositeLane();
    expect(r.counterPush.p0TowerDamage).toBe(r.defendOnly.p0TowerDamage);
    expect(r.counterPush.p1TowerDamage).toBeGreaterThan(r.defendOnly.p1TowerDamage);
    expect(r.counterPush.p1TowerDamage).toBeGreaterThan(r.counterPush.p0TowerDamage);
  });
});

describe("B2.7b full matches and replay", () => {
  it("K/L: commanders, Chaos Pulses and the new cards coexist; replays are identical", () => {
    const r = tacticalMatch();
    expect(r.rejected).toBe(0);
    expect(r.result.winner).not.toBeNull();
    expect(r.cometImpacts.length).toBeGreaterThan(0);
    expect(r.pulses).toBeGreaterThan(0);
    expect(r.abilityActivations).toBeGreaterThan(0);
    expect(r.commanderDeploys).toBeGreaterThan(0);
    expect([r.replayIdentical, r.steppedEqualsReplay, r.droppingCometChangesHash]).toEqual([true, true, true]);
  });

  it("building-deck matchup: every match terminates with zero rejected commands", () => {
    const s = summarizeMatchup(runMatchup(MATCHUP_DECKS_V9, ["m1"]));
    expect(s.completed).toBe(s.matches);
    expect(s.rejected).toBe(0);
    expect(s.replayIdentical).toBe(true);
    expect(Object.keys(s.spells).sort()).toEqual(["chaos_bolt", "chaos_comet", "rift_snare"]);
    expect(s.endReasons.timeout ?? 0).toBeLessThanOrEqual(1);
  });
});
