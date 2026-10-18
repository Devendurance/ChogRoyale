import { describe, expect, it } from "vitest";
import { initMatch, runMatch, stepMatch, validateDeck, CARDS_V1, TROOP_CARDS_V1, COMBAT_RULESET_VERSION, type CombatCommand, type CombatConfig, type CombatState, type DeployCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, slotForDeck, traceMatch, riftSchedule, botMatch, botMove, botAntiAirSpot } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V11, mirrorCommand, mirrorSchedule, engineMirrorCheck, runMatchup, summarizeMatchup, positionReport } from "@/lib/building-matchup";
import {
  netterVsHexwing,
  netterVsSprites,
  netterPunished,
  breakerVsBuildings,
  breakerSwarmed,
  runnerVsBreaker,
  sentrySupportedDefense,
  combinedPush,
  rosterBotMatch,
  ROSTER_DECKS,
} from "@/lib/roster-scenarios";

const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const rejections = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [e.reason] : []));
/** Every distinct HP value an entity of `cardId`/`owner` (or a building) shows while alive, stepping the real engine. */
function hpTrail(cfg: CombatConfig, cmds: DeployCommand[], upto: number, pick: (s: CombatState) => number | undefined): number[] {
  const s = initMatch(cfg);
  const seen: number[] = [];
  while (s.phase !== "final" && s.tick < upto) {
    stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
    const hp = pick(s);
    if (hp !== undefined && hp > 0 && seen[seen.length - 1] !== hp) seen.push(hp);
  }
  return seen;
}

describe("B2.7c1 card registry and deck economy", () => {
  it("registers Gale Netter and Riftbreaker as versioned troops", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v13");
    const n = TROOP_CARDS_V1.gale_netter!;
    const b = TROOP_CARDS_V1.riftbreaker!;
    expect([n.cost, n.hp, n.damage, n.range, n.speed, n.attackIntervalTicks, n.moveType, n.hitsAir, n.hitsGround, n.targetPriority, n.vsGroundPct]).toEqual([3, 120, 40, 16, 2, 10, "ground", true, true, "air", 30]);
    expect([b.cost, b.hp, b.damage, b.range, b.speed, b.attackIntervalTicks, b.moveType, b.hitsAir, b.structPriority, b.targetPriority, b.vsBuildingPct]).toEqual([4, 240, 22, 2, 2, 11, "ground", false, true, "building", 300]);
    // Outranges Hexwing; distinct from the fast Rift Runner.
    expect(n.range).toBeGreaterThan(TROOP_CARDS_V1.hexwing!.range);
    expect(b.speed).toBeLessThan(TROOP_CARDS_V1.rift_runner!.speed);
    expect(b.hp).toBeGreaterThan(TROOP_CARDS_V1.rift_runner!.hp * 3);
    // 15 earlier ordinary cards + 2 (B2.7c1) + Ember Mauler (B2.7c2).
    expect(Object.keys(CARDS_V1)).toHaveLength(18);
  });

  it("accepts the new cards in 7+1 decks and rejects unknown or duplicate cards", () => {
    for (const deck of Object.values(MATCHUP_DECKS_V11)) expect(() => validateDeck(deck, slotForDeck(deck))).not.toThrow();
    const deck = MATCHUP_DECKS_V11.breaker!;
    expect(() => validateDeck(deck.map((c) => (c === "gale_netter" ? "gale_nettr" : c)), slotForDeck(deck))).toThrow();
    expect(() => validateDeck(deck.map((c) => (c === "choglings" ? "riftbreaker" : c)), slotForDeck(deck))).toThrow();
    expect(() => validateDeck(deck.filter((c) => c !== "gale_netter"), slotForDeck(deck))).toThrow();
  });

  it("checks energy, territory and river, rotates the hand, and ignores client-sent stats", () => {
    const cfg = () => scenarioConfig(deckWith("riftbreaker", "gale_netter"), deckWith());
    const spoof = { ...d(1, 0, 2, "riftbreaker", 30, 50), hp: 9999, damage: 999 } as DeployCommand;
    const s = runMatch(cfg(), [spoof, d(2, 0, 3, "gale_netter", 30, 50)], 6).state;
    expect(rejections(s)).toEqual(["Insufficient energy"]);
    const zones = runMatch(cfg(), [d(1, 0, 2, "gale_netter", 30, 80), d(2, 0, 3, "gale_netter", 50, 110), d(3, 0, 4, "riftbreaker", 30, 80)], 6).state;
    expect(rejections(zones)).toEqual([expect.stringMatching(/river|bridge/i), expect.stringMatching(/territory/i), expect.stringMatching(/river|bridge/i)]);
    expect(zones.troops).toHaveLength(0);
    expect(zones.energy[0]).toBeGreaterThanOrEqual(5);
    const breaker = s.troops.find((t) => t.cardId === "riftbreaker")!;
    expect([breaker.hp, breaker.damage, breaker.maxHp]).toEqual([240, 22, 240]);
    const deck = deckWith("riftbreaker", "gale_netter");
    expect(s.hands[0]).not.toContain("riftbreaker");
    expect(s.hands[0]).toContain(deck[4]);
    const later = runMatch(cfg(), [d(1, 0, 90, "gale_netter", 30, 50)], 92).state;
    expect(later.troops.filter((t) => t.cardId === "gale_netter").map((t) => [t.hp, t.moveType])).toEqual([[120, "ground"]]);
  });
});

describe("B2.7c1 authoritative damage and targeting", () => {
  it("Gale Netter hits air for 40 and every ground target for 30% (12)", () => {
    const air = hpTrail(scenarioConfig(deckWith("gale_netter"), deckWith("hexwing")), [d(1, 1, 5, "hexwing", 70, 100), d(2, 0, 5, "gale_netter", 70, 62)], 200, (s) => s.troops.find((t) => t.cardId === "hexwing")?.hp);
    expect(air).toEqual([120, 80, 40]);
    const tower = runMatch(scenarioConfig(deckWith("gale_netter"), deckWith()), [d(1, 0, 2, "gale_netter", 30, 60)], 300).state.structures.find((x) => x.id === "s-p1-tower-30")!;
    expect(tower.hp).toBeLessThan(600);
    expect((600 - tower.hp) % 12).toBe(0);
  });

  it("Riftbreaker hits buildings for 66, towers for 22, and Rally Horn applies before the role modifier", () => {
    const totem = hpTrail(scenarioConfig(deckWith("decoy_totem"), deckWith("riftbreaker")), [d(1, 0, 2, "decoy_totem", 30, 56), d(2, 1, 5, "riftbreaker", 30, 100)], 200, (s) => s.buildings.find((b) => b.cardId === "decoy_totem")?.hp);
    expect(totem).toEqual([260, 194, 128, 62]);
    expect(runnerVsBreaker().riftbreaker.towerHpControl).toBe(600 - 9 * 22);
    // Horn (+40%) on the Breaker mid-fight: floor(22 * 1.4) = 30, x3 = 90 per hit on the Totem.
    const cfg = scenarioConfig(deckWith("decoy_totem"), deckWith("riftbreaker", "rally_horn"));
    const s = initMatch(cfg);
    const seen: number[] = [];
    while (s.tick < 200 && s.phase !== "final") {
      const due = [d(1, 0, 2, "decoy_totem", 30, 56), d(2, 1, 5, "riftbreaker", 30, 100)].filter((c) => c.tick === s.tick + 1);
      const br = s.troops.find((t) => t.cardId === "riftbreaker");
      if (s.tick + 1 === 40 && br) due.push(d(3, 1, 40, "rally_horn", br.x, br.y));
      stepMatch(s, due);
      const hp = s.buildings.find((b) => b.cardId === "decoy_totem")?.hp;
      if (hp !== undefined && seen[seen.length - 1] !== hp) seen.push(hp);
    }
    expect(rejections(s)).toEqual([]);
    expect(s.events.some((e) => e.type === "spell_cast" && e.cardId === "rally_horn")).toBe(true);
    const drops = seen.slice(1).map((hp, i) => seen[i]! - hp);
    expect(drops.slice(0, 2)).toEqual([66, 66]);
    expect(drops).toContain(90);
    expect(drops.every((x) => x === 66 || x === 90)).toBe(true);
  });

  it("Gale Netter drops an in-range ground target for an arriving flyer", () => {
    const cfg = scenarioConfig(deckWith("gale_netter"), deckWith("choglings", "rift_sprites"));
    const { samples } = traceMatch(cfg, [d(1, 1, 2, "choglings", 30, 92), d(2, 0, 2, "gale_netter", 30, 60), d(3, 1, 30, "rift_sprites", 30, 100)], 120);
    const cardOf = new Map(samples.map((x) => [x.id, x.cardId]));
    const netter = samples.filter((x) => x.cardId === "gale_netter");
    const switched = netter.some((x, i) => i > 0 && cardOf.get(netter[i - 1]!.targetId ?? "") === "choglings" && cardOf.get(x.targetId ?? "") === "rift_sprites");
    expect(switched).toBe(true);
  });
});

describe("B2.7c1 strategic encounters (real engine)", () => {
  it("A: Netter (3e) kills Hexwing (4e) faster than Chaos Archer and keeps most of its HP", () => {
    const r = netterVsHexwing();
    expect(r.rejected).toBe(0);
    expect(r.hexwingDeath!).toBeLessThan(r.hexwingDeathVsArcher!);
    expect(r.hexwingDeathVsArcher!).toBeLessThan(r.hexwingDeathControl!);
    expect(r.netterHp).toBeGreaterThan(TROOP_CARDS_V1.gale_netter!.hp / 2);
    expect(r.netterHp).toBeGreaterThan(r.archerHp);
    expect([r.towerHp, r.towerHpVsArcher]).toEqual([600, 600]);
    expect(r.towerHpControl).toBeLessThan(600);
  });

  it("B: Netter clears Rift Sprites before they touch the tower", () => {
    const r = netterVsSprites();
    expect(r.spriteDeaths).toHaveLength(2);
    expect(Math.max(...r.spriteDeaths)).toBeLessThan(Math.max(...r.spriteDeathsControl));
    expect(r.towerHp).toBe(600);
    expect(r.towerHpControl).toBeLessThan(600);
    expect(r.netterHp).toBeGreaterThan(0);
  });

  it("C: unsupported Netter loses to 2e Choglings, worse than Chaos Archer would", () => {
    const r = netterPunished();
    expect(r.netterDeath).not.toBeNull();
    expect(r.choglingsAlive).toBe(3);
    expect(r.choglingsAlive).toBeGreaterThan(r.choglingsAliveVsArcher);
  });

  it("D/E: Riftbreaker destroys Sentry and Totem; Runner and Guardian cannot match it", () => {
    const r = breakerVsBuildings();
    expect(r.sentry.riftbreaker.end).toEqual({ tick: expect.any(Number), reason: "destroyed" });
    expect(r.sentry.rift_runner.end!.reason).toBe("expired");
    expect(r.sentry.chog_guardian.end!.reason).toBe("expired");
    expect(r.totem.riftbreaker.end!.reason).toBe("destroyed");
    expect(r.totem.riftbreaker.end!.tick).toBeLessThan(r.totem.chog_guardian.end!.tick);
    expect(r.totem.rift_runner.end!.reason).toBe("expired");
  });

  it("F: 2e Choglings kill an isolated Riftbreaker that ignores them", () => {
    const r = breakerSwarmed();
    expect(r.breakerDeath!).toBeLessThan(r.breakerDeathControl!);
    expect(r.towerHp).toBeGreaterThan(r.towerHpControl);
    expect(r.choglingsLost).toBeLessThan(3);
  });

  it("G: a tower-locked Runner ignores a new Totem; Riftbreaker switches to it", () => {
    const r = runnerVsBreaker();
    expect(r.rift_runner.firstTowerHit!).toBeLessThan(r.riftbreaker.firstTowerHit!);
    expect([r.rift_runner.rejected, r.riftbreaker.rejected]).toEqual([0, 0]);
    expect(r.rift_runner.towerHpWithTotem).toBe(r.rift_runner.towerHpControl);
    expect(r.rift_runner.totem).toEqual({ tick: expect.any(Number), reason: "expired" });
    expect(r.riftbreaker.totem).toEqual({ tick: expect.any(Number), reason: "destroyed" });
    expect(r.riftbreaker.towerHpWithTotem).toBeGreaterThan(r.riftbreaker.towerHpControl);
  });

  it("H: Sentry under tower cover or backed by Choglings stops the Riftbreaker", () => {
    const r = sentrySupportedDefense();
    expect(r.exposed.towerHp).toBeLessThan(600);
    expect(r.covered.towerHp).toBe(600);
    expect(r.exposedPlusChoglings.towerHp).toBe(600);
    expect(r.exposedPlusChoglings.sentry).toEqual({ hp: expect.any(Number) });
    expect(r.exposedPlusChoglings.breakerDeath!).toBeLessThan(r.exposed.breakerDeath!);
    expect([r.exposed.rejected, r.covered.rejected, r.exposedPlusChoglings.rejected]).toEqual([0, 0, 0]);
  });

  it("I: Riftbreaker + Chaos Archer breaks the Sentry and pressures the tower harder than the Breaker alone", () => {
    const r = combinedPush();
    expect(r.sentry!.reason).toBe("destroyed");
    expect(r.towerHp).toBeLessThan(r.towerHpAlone);
  });

  it("J/K/L: bot match with both cards, commanders and Chaos ends naturally and replays exactly", () => {
    const r = rosterBotMatch();
    expect(r.winner).not.toBeNull();
    expect(["core", "crowns", "overtime", "timeout"]).toContain(r.endReason);
    expect(r.rejected).toBe(0);
    expect(r.netterDeploys).toBeGreaterThan(0);
    expect(r.breakerDeploys).toBeGreaterThan(0);
    expect(r.commanderDeploys).toBeGreaterThan(0);
    expect(r.abilities).toBeGreaterThan(0);
    expect(r.pulses).toBeGreaterThan(0);
    expect(r.replayIdentical).toBe(true);
    expect(rosterBotMatch().hash).toBe(r.hash);
    const cfg = () => scenarioConfig(ROSTER_DECKS[0], ROSTER_DECKS[1], riftSchedule("b27c1"), "b27c1");
    const base = [d(1, 0, 2, "riftbreaker", 30, 50), d(2, 0, 120, "gale_netter", 70, 50)];
    expect(runMatch(cfg(), base, 400).result.stateHash).toBe(runMatch(cfg(), base, 400).result.stateHash);
    expect(runMatch(cfg(), base.slice(0, 1), 400).result.stateHash).not.toBe(runMatch(cfg(), base, 400).result.stateHash);
  });
});

describe("B2.7c1 symmetry and matchup harness", () => {
  it("mirrored new-card encounters give identical swapped outcomes", () => {
    const cases: Array<[string[], string[], DeployCommand[]]> = [
      [deckWith("gale_netter"), deckWith("hexwing"), [d(1, 1, 5, "hexwing", 30, 100), d(2, 0, 5, "gale_netter", 30, 50)]],
      [deckWith("rift_sentry"), deckWith("riftbreaker"), [d(1, 0, 2, "rift_sentry", 70, 56), d(2, 1, 5, "riftbreaker", 70, 100)]],
    ];
    for (const [a, b, cmds] of cases) {
      const s = runMatch(scenarioConfig(a, b), cmds, 300).state;
      const m = runMatch(scenarioConfig(b, a), cmds.map((c) => mirrorCommand(c) as DeployCommand), 300).state;
      const view = (st: CombatState, flip: boolean) => ({
        structures: st.structures.map((x) => `${flip ? 1 - x.owner : x.owner}:${x.structure}:${x.x}:${flip ? 160 - x.y : x.y}:${x.hp}`).sort(),
        troops: st.troops.map((t) => `${flip ? 1 - t.owner : t.owner}:${t.cardId}:${t.x}:${flip ? 160 - t.y : t.y}:${t.hp}`).sort(),
        buildings: st.buildings.map((x) => `${flip ? 1 - x.owner : x.owner}:${x.cardId}:${x.hp}`).sort(),
      });
      expect(view(m, true)).toEqual(view(s, false));
    }
  });

  it("swarm back-row offset points toward each owner's home (v11 mirror fix)", () => {
    const cfg = scenarioConfig(deckWith("choglings"), deckWith("choglings"));
    const s = runMatch(cfg, [d(1, 0, 2, "choglings", 30, 50), d(2, 1, 2, "choglings", 30, 110)], 2).state;
    // Offsets relative to the first unit (all three have marched the same distance by now).
    const rows = (p: PlayerIndex) => {
      const us = s.troops.filter((t) => t.owner === p);
      return us.map((t) => [t.x - us[0]!.x, t.y - us[0]!.y]);
    };
    expect(rows(0)).toEqual([[0, 0], [-1, 0], [2, -1]]);
    expect(rows(1)).toEqual([[0, 0], [-1, 0], [2, 1]]);
  });

  it("the bot makes mirror-equivalent decisions with the v11 decks, including Netter placement", () => {
    const { breaker, control } = MATCHUP_DECKS_V11 as Record<string, string[]>;
    const chaos = riftSchedule("fair11");
    const cfgA = scenarioConfig(breaker!, control!, chaos, "fair11");
    const cfgB = scenarioConfig(control!, breaker!, mirrorSchedule(chaos), "fair11");
    const bot = botMatch(cfgA, 900, 20);
    const a = initMatch(cfgA);
    const b = initMatch(cfgB);
    const flip = (m: { x: number; y: number } | null) => (m ? { ...m, y: 160 - m.y } : null);
    const sorted = [...bot.commands].sort((x, y) => x.tick - y.tick || x.seq - y.seq);
    let ci = 0;
    let netterSpots = 0;
    while (a.tick < 900 && a.phase !== "final") {
      for (const p of [0, 1] as PlayerIndex[]) {
        const q = (1 - p) as PlayerIndex;
        expect(flip(botMove(a, p, a.tick))).toEqual(botMove(b, q, a.tick));
        const spot = botAntiAirSpot(a, p);
        expect(flip(spot)).toEqual(botAntiAirSpot(b, q));
        if (spot) netterSpots += 1;
      }
      const due: CombatCommand[] = [];
      while (ci < sorted.length && sorted[ci]!.tick <= a.tick + 1) due.push(sorted[ci++]!);
      stepMatch(a, due);
      stepMatch(b, due.map(mirrorCommand));
    }
    expect(netterSpots).toBeGreaterThan(0);
  });

  it("engine mirror holds for v11 decks with and without Chaos", () => {
    for (const chaos of [false, true]) expect(engineMirrorCheck(MATCHUP_DECKS_V11, ["m1"], chaos).filter((r) => !r.symmetric)).toEqual([]);
  });

  it("v11 matchups finish, play the new cards, reject nothing and replay exactly", () => {
    const rows = runMatchup(MATCHUP_DECKS_V11, ["m1"]);
    const sum = summarizeMatchup(rows);
    expect(sum.matches).toBe(16);
    expect(sum.completed).toBe(16);
    expect(sum.rejected).toBe(0);
    expect(sum.replayIdentical).toBe(true);
    expect(sum.deploys.gale_netter ?? 0).toBeGreaterThan(0);
    expect(sum.deploys.riftbreaker ?? 0).toBeGreaterThan(0);
    const pos = positionReport(rows);
    expect(Math.abs(pos.energySpent[0]! - pos.energySpent[1]!)).toBeLessThanOrEqual(pos.energySpent[0]! / 25);
  });
});
