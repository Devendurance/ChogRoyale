import { describe, expect, it } from "vitest";
import { initMatch, runMatch, stepMatch, stateHash, validateDeck, CARDS_V1, TROOP_CARDS_V1, COMBAT_RULESET_VERSION, combatRulesetSummary, type CombatCommand, type CombatState, type DeployCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, slotForDeck, riftSchedule, botMatch, botMove, botAntiSwarmSpot } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V12_BASE, MATCHUP_DECKS_V12_MAULER, mirrorCommand, mirrorSchedule, engineMirrorCheck, laneSwapCheck, runMatchup, summarizeMatchup } from "@/lib/building-matchup";
import { maulerVsSwarm, maulerCounters, tankAndRanged, maulerDuel, maulerTargets, maulerBotMatch, MAULER_DECKS } from "@/lib/splash-scenarios";

const d = (seq: number, player: PlayerIndex, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
const rejections = (s: CombatState) => s.events.flatMap((e) => (e.type === "command_rejected" ? [e.reason] : []));
const M = TROOP_CARDS_V1.ember_mauler!;

describe("B2.7c2 Ember Mauler registration and deck economy", () => {
  it("is a versioned ground melee shockwave troop, distinct from Sparkcaster", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v13");
    expect([M.cost, M.count, M.hp, M.damage, M.range, M.speed, M.sight, M.attackIntervalTicks, M.moveType, M.hitsAir, M.hitsGround, M.shockwaveRadius]).toEqual([4, 1, 220, 24, 2, 1, 22, 12, "ground", false, true, 4]);
    // No projectile and no target-centred splash: the shockwave is centred on the Mauler.
    expect([M.projectileTicks, M.splashRadius, M.structPriority, M.targetPriority]).toEqual([0, 0, false, undefined]);
    const spark = TROOP_CARDS_V1.sparkcaster!;
    expect(spark.projectileTicks).toBeGreaterThan(0);
    expect(spark.hitsAir).toBe(true);
    expect(M.damage / M.attackIntervalTicks).toBeLessThan(TROOP_CARDS_V1.chog_guardian!.damage / TROOP_CARDS_V1.chog_guardian!.attackIntervalTicks);
    expect(Object.keys(CARDS_V1)).toHaveLength(18);
    expect(combatRulesetSummary().troopRoles.ember_mauler).toMatch(/radius 4/);
  });

  it("validates 7+1 decks with the Mauler and rejects duplicates and typos", () => {
    for (const deck of [...Object.values(MATCHUP_DECKS_V12_BASE), ...Object.values(MATCHUP_DECKS_V12_MAULER), ...MAULER_DECKS]) expect(() => validateDeck(deck, slotForDeck(deck))).not.toThrow();
    const deck = MATCHUP_DECKS_V12_MAULER.antiSwarm!;
    expect(() => validateDeck(deck.map((c) => (c === "ember_mauler" ? "ember_maul" : c)), slotForDeck(deck))).toThrow();
    expect(() => validateDeck(deck.map((c) => (c === "frostshell" ? "ember_mauler" : c)), slotForDeck(deck))).toThrow();
  });

  it("enforces energy, river and territory, rotates the hand and ignores client stats", () => {
    const cfg = () => scenarioConfig(deckWith("ember_mauler", "choglings"), deckWith());
    const spoof = { ...d(1, 0, 2, "ember_mauler", 30, 52), hp: 9999, damage: 500, shockwaveRadius: 60 } as DeployCommand;
    const s = runMatch(cfg(), [spoof, d(2, 0, 3, "choglings", 30, 50)], 4).state;
    expect(rejections(s)).toEqual(["Insufficient energy"]);
    const m = s.troops.find((t) => t.cardId === "ember_mauler")!;
    expect([m.hp, m.maxHp, m.damage, m.moveType]).toEqual([220, 220, 24, "ground"]);
    expect(s.hands[0]).not.toContain("ember_mauler");
    expect(s.hands[0]).toContain(deckWith("ember_mauler", "choglings")[4]);
    const bad = runMatch(cfg(), [d(1, 0, 2, "ember_mauler", 30, 80), d(2, 0, 3, "ember_mauler", 50, 110)], 4).state;
    expect(rejections(bad)).toEqual([expect.stringMatching(/river|bridge/i), expect.stringMatching(/territory/i)]);
    expect(bad.troops).toHaveLength(0);
  });
});

describe("B2.7c2 shockwave mechanics", () => {
  it("hits the primary plus every enemy ground unit within radius 4 of the Mauler, and nothing outside it", () => {
    // Bridge fight, out of every tower's range (25): only the Mauler damages P1.
    const cfg = scenarioConfig(deckWith("ember_mauler"), deckWith("choglings"));
    const cmds = [d(1, 0, 5, "ember_mauler", 30, 64), d(2, 1, 5, "choglings", 30, 92)];
    const s = initMatch(cfg);
    let checkedSwings = 0;
    let seen = 0;
    while (s.tick < 120 && s.phase !== "final") {
      const before = new Map(s.troops.filter((t) => t.owner === 1).map((t) => [t.id, t.hp]));
      stepMatch(s, cmds.filter((c) => c.tick === s.tick + 1));
      const wave = s.events.slice(seen).find((e) => e.type === "shockwave");
      seen = s.events.length;
      const m = s.troops.find((t) => t.cardId === "ember_mauler");
      if (!wave || wave.type !== "shockwave" || !m) {
        // No swing: no P1 unit loses HP.
        for (const t of s.troops.filter((x) => x.owner === 1 && before.has(x.id))) expect(t.hp).toBe(before.get(t.id));
        continue;
      }
      checkedSwings += 1;
      const deadNow = new Set(s.events.filter((e) => e.type === "death" && e.tick === s.tick).map((e) => (e.type === "death" ? e.entityId : "")));
      let victims = 0;
      for (const [id, hp] of before) {
        const t = s.troops.find((x) => x.id === id);
        const lost = t ? hp - t.hp : hp;
        if (lost > 0) victims += 1;
        if (t) {
          const inside = (t.x - m.x) ** 2 + (t.y - m.y) ** 2 <= 16;
          expect(lost).toBe(inside || id === wave.primaryId ? 24 : 0);
        } else expect(deadNow.has(id)).toBe(true);
      }
      // Primary may be a structure once the Choglings are gone.
      expect(victims).toBe(wave.extraHits + (before.has(wave.primaryId) ? 1 : 0));
    }
    expect(checkedSwings).toBeGreaterThanOrEqual(3);
    expect(s.events.some((e) => e.type === "shockwave" && e.extraHits === 2)).toBe(true);
  });

  it("never damages friendly units and only the primary building", () => {
    // P1 Totem out of P1 tower range; P0 Mauler and P0 Choglings both hit it.
    // Measured when the Totem falls (afterwards everyone walks into towers).
    const cfg = () => scenarioConfig(deckWith("ember_mauler", "choglings"), deckWith("decoy_totem"));
    const cmds = [d(1, 1, 2, "decoy_totem", 50, 96), d(2, 0, 3, "ember_mauler", 50, 66), d(3, 0, 60, "choglings", 50, 66)];
    const end = runMatch(cfg(), cmds, 300).state.events.find((e) => e.type === "building_removed");
    expect(end && end.type === "building_removed" && end.reason).toBe("destroyed");
    const s = runMatch(cfg(), cmds, end!.tick).state;
    const waves = s.events.filter((e) => e.type === "shockwave");
    expect(waves.length).toBeGreaterThan(0);
    expect(waves.every((e) => e.type === "shockwave" && e.extraHits === 0)).toBe(true);
    expect(s.troops.filter((t) => t.owner === 0 && t.cardId === "choglings").map((t) => t.hp)).toEqual([60, 60, 60]);
    const h = maulerTargets();
    expect(h.totem.hp).toBe(260 - 4 * 24);
    expect(h.totem.waves.extraHits).toBeGreaterThan(0);
    expect(h.tower.damageMultipleOf24).toBe(true);
    expect(h.tower.towerHp).toBeLessThan(600);
  });

  it("is ground-only: flyers inside the radius are never hit; ground commanders are (armor applies)", () => {
    const h = maulerTargets();
    expect(h.commander.airInWave).toBeGreaterThan(0);
    expect(h.commander.spritesHp).toBe(48);
    expect(h.commander.waves.swings).toBeGreaterThan(0);
    // Bulwark armor 1: 23 per swing.
    expect((h.commander.maxHp - h.commander.hp) % 23).toBe(0);
    expect(h.commander.hp).toBeLessThan(h.commander.maxHp);
    expect(h.commander.rejected).toBe(0);
  });

  it("Rally Horn raises the Mauler's damage from 24 to floor(24 x 1.4) = 33", () => {
    // Bridge duel vs a Guardian, out of tower range; Horn at tick 40 (first affordable).
    const cfg = scenarioConfig(deckWith("ember_mauler", "rally_horn"), deckWith("chog_guardian"));
    const s = initMatch(cfg);
    const fixed = [d(1, 0, 5, "ember_mauler", 30, 64), d(2, 1, 5, "chog_guardian", 30, 92)];
    const drops: Array<[number, number]> = [];
    while (s.tick < 100 && s.phase !== "final") {
      const due = fixed.filter((c) => c.tick === s.tick + 1);
      const m = s.troops.find((t) => t.cardId === "ember_mauler");
      if (s.tick + 1 === 40 && m) due.push(d(3, 0, 40, "rally_horn", m.x, m.y));
      const g = s.troops.find((t) => t.owner === 1);
      const before = g?.hp ?? 0;
      stepMatch(s, due);
      const after = s.troops.find((t) => t.owner === 1)?.hp ?? 0;
      // Only while the Mauler lives (afterwards the Guardian walks into tower fire).
      if (g && after > 0 && after < before && s.troops.some((t) => t.cardId === "ember_mauler")) drops.push([s.tick, before - after]);
    }
    expect(rejections(s)).toEqual([]);
    expect(drops.filter(([t]) => t < 40).map(([, x]) => x).every((x) => x === 24)).toBe(true);
    const buffed = drops.filter(([t]) => t >= 40).map(([, x]) => x);
    expect(buffed.length).toBeGreaterThan(0);
    expect(buffed.every((x) => x === 33)).toBe(true);
  });
});

describe("B2.7c2 swarm counterplay (real engine)", () => {
  it("A/B: clears Choglings and a clustered cheap push far better than a Guardian", () => {
    const r = maulerVsSwarm();
    expect(r.choglings.mauler.clearedAt!).toBeLessThan(r.choglings.guardian.clearedAt!);
    expect(r.choglings.mauler.defenderHpAtClear).toBeGreaterThan(r.choglings.guardian.defenderHpAtClear);
    expect(r.choglings.mauler.waves.maxExtra).toBe(2);
    expect(r.clustered.mauler.towerHp).toBeGreaterThan(r.clustered.guardian.towerHp);
    expect(r.clustered.mauler.extraPerSwing).toBeGreaterThan(1);
  });

  it("C: spreading the same push removes the Mauler's edge", () => {
    const r = maulerVsSwarm();
    expect(r.spread.mauler.extraPerSwing).toBeLessThan(r.clustered.mauler.extraPerSwing);
    expect(r.spread.mauler.towerHp - r.spread.guardian.towerHp).toBeLessThan(r.clustered.mauler.towerHp - r.clustered.guardian.towerHp);
  });

  it("weakness: a tank-led push beats a defending Mauler", () => {
    const r = maulerVsSwarm();
    expect(r.tankLed.mauler.towerHp).toBeLessThanOrEqual(r.tankLed.guardian.towerHp);
    expect(r.tankLed.mauler.defenderDeath).not.toBeNull();
  });

  it("D/E: flyers and ranged troops kill it without losses; Choglings trade badly", () => {
    const r = maulerCounters();
    for (const k of ["hexwing", "rift_sprites", "chaos_archer"] as const) {
      expect(r[k].maulerDeath!).toBeLessThan(r.none.maulerDeath!);
      expect(r[k].towerHp).toBeGreaterThan(r.none.towerHp);
      expect(r[k].answerUnitsLost).toBe(0);
    }
    expect([r.hexwing.answerHp, r.rift_sprites.answerHp]).toEqual([120, 48]);
    expect(r.hexwing.airInWave + r.rift_sprites.airInWave).toBeGreaterThan(0);
    expect(r.chaos_archer.towerHp).toBe(600);
    expect(r.choglings.answerUnitsLost).toBe(3);
  });

  it("F: a tank absorbs it while ranged support speeds the kill", () => {
    const r = tankAndRanged();
    expect(r.tankPlusArchers.maulerDeath!).toBeLessThan(r.tankOnly.maulerDeath!);
    expect(r.tankPlusArchers.guardianHp).toBeGreaterThan(r.tankOnly.guardianHp);
    expect(r.tankPlusArchers.archersLost).toBe(0);
    expect([r.tankOnly.rejected, r.tankPlusArchers.rejected]).toEqual([0, 0]);
  });

  it("G: loses open-ground duels to Guardian and Boulderback", () => {
    const r = maulerDuel();
    expect(r.vsGuardian.loser).toBe("ember_mauler");
    expect(r.vsBoulderback.loser).toBe("ember_mauler");
    expect(r.vsGuardian.opponentHp).toBeGreaterThan(0);
  });
});

describe("B2.7c2 symmetry, Chaos and full matches", () => {
  it("mirrored Mauler encounters give identical swapped outcomes", () => {
    const cases: Array<[string[], string[], DeployCommand[]]> = [
      [deckWith("ember_mauler"), deckWith("choglings"), [d(1, 0, 5, "ember_mauler", 30, 64), d(2, 1, 5, "choglings", 30, 92)]],
      [deckWith("ember_mauler", "choglings"), deckWith("chaos_archer", "choglings"), [d(1, 0, 5, "ember_mauler", 70, 52), d(2, 1, 5, "choglings", 70, 100), d(3, 1, 5, "chaos_archer", 71, 100), d(4, 0, 90, "choglings", 70, 50)]],
    ];
    for (const [a, b, cmds] of cases) {
      const s = runMatch(scenarioConfig(a, b), cmds, 300).state;
      const m = runMatch(scenarioConfig(b, a), cmds.map((c) => mirrorCommand(c) as DeployCommand), 300).state;
      const view = (st: CombatState, flip: boolean) => ({
        structures: st.structures.map((x) => `${flip ? 1 - x.owner : x.owner}:${x.structure}:${x.x}:${flip ? 160 - x.y : x.y}:${x.hp}`).sort(),
        troops: st.troops.map((t) => `${flip ? 1 - t.owner : t.owner}:${t.cardId}:${t.x}:${flip ? 160 - t.y : t.y}:${t.hp}`).sort(),
        waves: st.events.filter((e) => e.type === "shockwave").map((e) => (e.type === "shockwave" ? `${e.tick}:${flip ? 1 - e.owner : e.owner}:${e.extraHits}` : "")),
      });
      expect(view(m, true)).toEqual(view(s, false));
    }
  });

  it("the bot places the Mauler mirror-equivalently", () => {
    const [a, b] = MAULER_DECKS;
    const chaos = riftSchedule("fair12");
    const cfgA = scenarioConfig(a, b, chaos, "fair12");
    const cfgB = scenarioConfig(b, a, mirrorSchedule(chaos), "fair12");
    const bot = botMatch(cfgA, 900, 20);
    const sa = initMatch(cfgA);
    const sb = initMatch(cfgB);
    const flip = (m: { x: number; y: number } | null) => (m ? { ...m, y: 160 - m.y } : null);
    const sorted = [...bot.commands].sort((x, y) => x.tick - y.tick || x.seq - y.seq);
    let ci = 0;
    let spots = 0;
    while (sa.tick < 900 && sa.phase !== "final") {
      for (const p of [0, 1] as PlayerIndex[]) {
        const q = (1 - p) as PlayerIndex;
        expect(flip(botMove(sa, p, sa.tick))).toEqual(botMove(sb, q, sa.tick));
        const spot = botAntiSwarmSpot(sa, p);
        expect(flip(spot)).toEqual(botAntiSwarmSpot(sb, q));
        if (spot) spots += 1;
      }
      const due: CombatCommand[] = [];
      while (ci < sorted.length && sorted[ci]!.tick <= sa.tick + 1) due.push(sorted[ci++]!);
      stepMatch(sa, due);
      stepMatch(sb, due.map(mirrorCommand));
    }
    expect(spots).toBeGreaterThan(0);
  });

  it("same-deck P0/P1 splits follow the lane sequence: swapping it swaps every outcome exactly", () => {
    const decks = { swarm: MATCHUP_DECKS_V12_MAULER.swarm!, antiSwarm: MATCHUP_DECKS_V12_MAULER.antiSwarm! };
    for (const chaos of ["none", "rift-mirrored"] as const) {
      const r = laneSwapCheck(decks, ["m1", "m2", "m3"], chaos);
      expect(r.mismatches).toEqual([]);
      expect(r.swapped).toEqual({ p0: r.normal.p1, p1: r.normal.p0 });
    }
  });

  it("engine mirror holds for the v12 Mauler decks with and without Chaos", () => {
    for (const chaos of [false, true]) expect(engineMirrorCheck(MATCHUP_DECKS_V12_MAULER, ["m1"], chaos).filter((r) => !r.symmetric)).toEqual([]);
  });

  it("I/J/K: Chaos + commanders + Mauler bot match ends naturally and replays exactly", () => {
    const r = maulerBotMatch();
    expect(r.winner).not.toBeNull();
    expect(["core", "crowns", "overtime", "timeout"]).toContain(r.endReason);
    expect(r.rejected).toBe(0);
    expect(r.maulerDeploys).toBeGreaterThan(0);
    expect(r.shockwaves).toBeGreaterThan(0);
    expect(r.pulses).toBeGreaterThan(0);
    expect(r.commanderDeploys).toBeGreaterThan(0);
    expect(r.abilities).toBeGreaterThan(0);
    expect(r.replayIdentical).toBe(true);
    expect(maulerBotMatch().hash).toBe(r.hash);
    const cfg = () => scenarioConfig(MAULER_DECKS[0], MAULER_DECKS[1], riftSchedule("b27c2"), "b27c2");
    const base = [d(1, 0, 2, "ember_mauler", 30, 52), d(2, 1, 2, "choglings", 30, 100)];
    expect(runMatch(cfg(), base, 300).result.stateHash).toBe(runMatch(cfg(), base, 300).result.stateHash);
    expect(runMatch(cfg(), base.slice(1), 300).result.stateHash).not.toBe(runMatch(cfg(), base, 300).result.stateHash);
    expect(stateHash(runMatch(cfg(), base, 300).state)).toBe(runMatch(cfg(), base, 300).result.stateHash);
  });

  it("controlled v12 matchups finish, use the Mauler's splash, reject nothing and replay exactly", () => {
    const sum = summarizeMatchup(runMatchup(MATCHUP_DECKS_V12_MAULER, ["m1"]));
    expect([sum.matches, sum.completed, sum.rejected]).toEqual([25, 25, 0]);
    expect(sum.replayIdentical).toBe(true);
    expect(sum.deploys.ember_mauler ?? 0).toBeGreaterThan(0);
    expect(sum.shockwave.extraHits).toBeGreaterThan(0);
  });
});
