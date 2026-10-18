// B2.7c4 resource-aware bot: decisions, resource conservation, fairness.

import { describe, it, expect } from "vitest";
import { initMatch, stepMatch, runMatch, stateHash, energyPhaseMult, moveUnit, ENERGY_V1, type CombatCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, botMatch, botMove, botAbility, riftSchedule } from "@/lib/arena-scenarios";
import { measure, mirrorCommand, mirrorSchedule, laneSwapCheck, runMatchup } from "@/lib/building-matchup";
import { smartMove } from "@/lib/smart-bot";
import { DECKS_V13, deckReport, policyDuel } from "@/lib/bot-economy";

const SMART: [typeof smartMove, typeof smartMove] = [smartMove, smartMove];
const mirrorMove = (m: { cardId: string; x: number; y: number } | null) => (m ? { ...m, y: 160 - m.y } : null);

describe("smart bot decisions", () => {
  it("saves for tank + ranged support instead of playing the first affordable card", () => {
    const deck = deckWith("boulderback", "chaos_archer", "rift_snare", "chaos_comet");
    const s = initMatch(scenarioConfig(deck, deckWith("chog_guardian"), null, "save"));
    expect(s.energy[0]).toBe(5);
    expect(botMove(s, 0, 0)?.cardId).toBe("boulderback");
    expect(smartMove(s, 0, 0)).toBeNull();
    let tankAt = -1;
    let supportAt = -1;
    let seq = 0;
    while (s.tick < 400 && supportAt < 0) {
      const due: CombatCommand[] = [];
      if ((s.tick + 1) % 20 === 0) {
        const m = smartMove(s, 0, 0);
        if (m) {
          due.push({ seq: ++seq, player: 0, tick: s.tick + 1, ...m });
          if (m.cardId === "boulderback") tankAt = s.tick + 1;
          if (m.cardId === "chaos_archer") supportAt = s.tick + 1;
        }
      }
      stepMatch(s, due);
    }
    expect(tankAt).toBeGreaterThan(0);
    expect(supportAt).toBeGreaterThan(tankAt);
    const tank = s.troops.find((t) => t.owner === 0 && t.cardId === "boulderback")!;
    const archers = s.troops.filter((t) => t.owner === 0 && t.cardId === "chaos_archer");
    expect(archers.length).toBe(2);
    // Support lands in the tank's lane, behind it.
    for (const a of archers) {
      expect(Math.abs(a.x - tank.x)).toBeLessThanOrEqual(12);
      expect(a.y).toBeLessThan(tank.y + 1);
    }
    expect(s.events.filter((e) => e.type === "command_rejected")).toHaveLength(0);
  });

  it("answers a flyer on its half with an anti-air card", () => {
    const cfg = scenarioConfig(deckWith("gale_netter", "choglings", "boulderback", "rift_runner"), deckWith("hexwing"), null, "aa");
    const s = initMatch(cfg);
    stepMatch(s, [{ seq: 1, player: 1, tick: 1, cardId: "hexwing", x: 30, y: 100 }]);
    while (!s.troops.some((t) => t.owner === 1 && t.y < 80) && s.tick < 200) stepMatch(s, []);
    expect(smartMove(s, 0, 0)?.cardId).toBe("gale_netter");
  });

  it("never idles at the energy cap and keeps energy within bounds", () => {
    const D = DECKS_V13;
    for (const deck of [D.turret!, D.control!, D.siege!]) {
      const bot = botMatch(scenarioConfig(deck, D.swarm!, null, "cap"), 3100, 20, { policies: [smartMove, botMove] });
      expect(bot.econ.idleAtCap[0]).toBe(0);
      const replay = initMatch(scenarioConfig(deck, D.swarm!, null, "cap"));
      const sorted = [...bot.commands].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
      let ci = 0;
      const progress: [number, number] = [0, 0];
      while (replay.phase !== "final" && replay.tick < 3100) {
        const due: CombatCommand[] = [];
        while (ci < sorted.length && sorted[ci]!.tick <= replay.tick + 1) due.push(sorted[ci++]!);
        for (const p of [0, 1] as PlayerIndex[]) if (replay.energy[p] < ENERGY_V1.max) progress[p] += energyPhaseMult(replay.tick + 1) * 100;
        stepMatch(replay, due);
        for (const e of replay.energy) expect(e >= 0 && e <= ENERGY_V1.max).toBe(true);
      }
      expect(stateHash(replay)).toBe(stateHash(bot.state));
      // Economy identity: start + regen accrued while uncapped = spent + held.
      const spent = measure(replay).energySpent;
      for (const p of [0, 1] as PlayerIndex[]) {
        const regen = Math.floor(progress[p] / (ENERGY_V1.regenTicksPerPoint * 100));
        expect(Math.abs(ENERGY_V1.start + regen - spent[p] - replay.energy[p])).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("v14 engine detour symmetry", () => {
  it("equal-cost footprint detours resolve to mirrored corners for P0 and P1", () => {
    const a = { x: 47, y: 45, moveType: "ground" as const, owner: 0 as const };
    const b = { x: 47, y: 115, moveType: "ground" as const, owner: 1 as const };
    moveUnit(a, { x: 56, y: 45 }, 2, false, [{ x: 50, y: 45, r: 2 }]);
    moveUnit(b, { x: 56, y: 115 }, 2, false, [{ x: 50, y: 115, r: 2 }]);
    expect(a).toMatchObject({ x: 47, y: 43 });
    expect([b.x, 160 - b.y]).toEqual([a.x, a.y]);
  });
});

describe("smart bot determinism and fairness", () => {
  it("is deterministic and replays exactly with 0 rejected commands", () => {
    const cfg = () => scenarioConfig(DECKS_V13.siege!, DECKS_V13.control!, riftSchedule("det"), "det");
    const a = botMatch(cfg(), 3100, 20, { policies: SMART });
    const b = botMatch(cfg(), 3100, 20, { policies: SMART });
    expect(stateHash(a.state)).toBe(stateHash(b.state));
    expect(runMatch(cfg(), a.commands).result.stateHash).toBe(stateHash(a.state));
    expect(a.state.events.filter((e) => e.type === "command_rejected")).toHaveLength(0);
    expect(a.state.phase).toBe("final");
  });

  it("makes mirror-equivalent decisions from mirrored states", () => {
    const chaos = riftSchedule("fair");
    const cfgA = scenarioConfig(DECKS_V13.turret!, DECKS_V13.breaker!, chaos, "fair");
    const cfgB = scenarioConfig(DECKS_V13.breaker!, DECKS_V13.turret!, mirrorSchedule(chaos), "fair");
    const bot = botMatch(cfgA, 1500, 20, { policies: SMART });
    const a = initMatch(cfgA);
    const b = initMatch(cfgB);
    const sorted = [...bot.commands].sort((x, y) => x.tick - y.tick || x.seq - y.seq);
    let ci = 0;
    let checked = 0;
    while (a.tick < 1500 && a.phase !== "final") {
      for (const p of [0, 1] as PlayerIndex[]) {
        const q = (1 - p) as PlayerIndex;
        expect(mirrorMove(smartMove(a, p, a.tick))).toEqual(smartMove(b, q, a.tick));
        expect(botAbility(a, p)).toBe(botAbility(b, q));
        checked += 1;
      }
      const due: CombatCommand[] = [];
      while (ci < sorted.length && sorted[ci]!.tick <= a.tick + 1) due.push(sorted[ci++]!);
      stepMatch(a, due);
      stepMatch(b, due.map(mirrorCommand));
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("lane-swapped smart games flip exactly, with and without Chaos", { timeout: 240_000 }, () => {
    const decks = { siege: DECKS_V13.siege!, swarm: DECKS_V13.swarm! };
    const none = laneSwapCheck(decks, ["m1", "m2", "m3"], "none", smartMove);
    const raw = laneSwapCheck(decks, ["m1", "m2", "m3"], "rift", smartMove);
    expect(none.exact).toBe(none.games);
    expect(raw.exact).toBe(raw.games);
  });
});

describe("policy comparison harness", () => {
  it("duels count both seats and the smart seat wastes no more energy at the cap", { timeout: 240_000 }, () => {
    const duel = policyDuel({ siege: DECKS_V13.siege! }, ["m1", "m2"]);
    expect(duel.siege!.games).toBe(4);
    expect(duel.siege!.smart + duel.siege!.simple + duel.siege!.draws).toBe(4);
    expect(duel.siege!.idleCapSmart).toBe(0);
  });

  it("deck reports cover both seats and every replay is identical", { timeout: 240_000 }, () => {
    const rows = runMatchup({ swarm: DECKS_V13.swarm!, turret: DECKS_V13.turret! }, ["m1"], "none", SMART);
    const rep = deckReport(rows);
    expect(rep.swarm!.games).toBe(2);
    expect(rep.swarm!.wins + rep.swarm!.losses + rep.swarm!.draws).toBe(2);
    expect(rows.every((r) => r.replayIdentical && r.rejected === 0)).toBe(true);
  });
});
