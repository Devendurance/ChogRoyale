import { describe, expect, it } from "vitest";
import { initMatch, stepMatch, runMatch, stateHash, type CombatCommand, type CombatState, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, botMatch, botMove, botAbility, botSpellSpot, riftSchedule } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V9, mirrorCommand, mirrorSchedule, engineMirrorCheck, runMatchup, positionReport } from "@/lib/building-matchup";
import { cometSuddenDeath } from "@/lib/spell-scenarios";

const mirrorMove = (m: { cardId: string; x: number; y: number } | null) => (m ? { ...m, y: 160 - m.y } : null);

describe("bot side neutrality", () => {
  it("makes mirror-equivalent decisions from mirrored states", () => {
    const { turret, siege } = MATCHUP_DECKS_V9 as Record<string, string[]>;
    const chaos = riftSchedule("fair");
    const cfgA = scenarioConfig(turret!, siege!, chaos, "fair");
    const cfgB = scenarioConfig(siege!, turret!, mirrorSchedule(chaos), "fair");
    const bot = botMatch(cfgA, 900, 20);
    const a = initMatch(cfgA);
    const b = initMatch(cfgB);
    let checked = 0;
    let ci = 0;
    const sorted = [...bot.commands].sort((x, y) => x.tick - y.tick || x.seq - y.seq);
    while (a.tick < 900 && a.phase !== "final") {
      for (const p of [0, 1] as PlayerIndex[]) {
        const q = (1 - p) as PlayerIndex;
        expect(mirrorMove(botMove(a, p, a.tick))).toEqual(botMove(b, q, a.tick));
        expect(botAbility(a, p)).toBe(botAbility(b, q));
        for (const card of ["chaos_bolt", "chaos_comet", "rift_snare"]) expect(mirrorMove(botSpellSpot(a, p, card) && { cardId: card, ...botSpellSpot(a, p, card)! })).toEqual(botSpellSpot(b, q, card) && { cardId: card, ...botSpellSpot(b, q, card)! });
        checked += 1;
      }
      const due: CombatCommand[] = [];
      while (ci < sorted.length && sorted[ci]!.tick <= a.tick + 1) due.push(sorted[ci++]!);
      stepMatch(a, due);
      stepMatch(b, due.map(mirrorCommand));
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("alternates which player's same-tick commands are processed first", () => {
    const cfg = scenarioConfig(MATCHUP_DECKS_V9.control!, MATCHUP_DECKS_V9.control!, null, "alt");
    const { commands } = botMatch(cfg, 1200, 20);
    const firstBy: [number, number] = [0, 0];
    const byTick = new Map<number, CombatCommand[]>();
    for (const c of commands) if (!("abilityId" in c)) byTick.set(c.tick, [...(byTick.get(c.tick) ?? []), c]);
    for (const cs of byTick.values()) {
      if (new Set(cs.map((c) => c.player)).size < 2) continue;
      firstBy[[...cs].sort((x, y) => x.seq - y.seq)[0]!.player] += 1;
    }
    expect(firstBy[0]).toBeGreaterThan(5);
    expect(firstBy[1]).toBeGreaterThan(5);
    expect(Math.abs(firstBy[0] - firstBy[1])).toBeLessThanOrEqual(1);
  });

  it("the engine is mirror-symmetric for mirrored command streams, with and without Chaos", () => {
    for (const chaos of [false, true]) {
      const rows = engineMirrorCheck(MATCHUP_DECKS_V9, ["m1"], chaos);
      expect(rows.filter((r) => !r.symmetric)).toEqual([]);
    }
  });

  it("side-swapped matchups spend equal energy and replay exactly", () => {
    const rows = runMatchup(MATCHUP_DECKS_V9, ["m1", "m2"]);
    const r = positionReport(rows);
    expect(r.rejected).toBe(0);
    expect(rows.every((x) => x.replayIdentical)).toBe(true);
    expect(Math.abs(r.energySpent[0]! - r.energySpent[1]!)).toBeLessThanOrEqual(r.energySpent[0]! / 50);
    const cfg = () => scenarioConfig(MATCHUP_DECKS_V9.turret!, MATCHUP_DECKS_V9.siege!, riftSchedule("m1"), "m1");
    const bot = botMatch(cfg(), 3100, 20);
    const again = botMatch(cfg(), 3100, 20);
    expect(JSON.stringify(again.commands)).toBe(JSON.stringify(bot.commands));
    expect(runMatch(cfg(), bot.commands).result.stateHash).toBe(stateHash(bot.state as CombatState));
  });
});

describe("comet siege energy accounting", () => {
  it("15 Comets cost 60; the rest is cycle plays, all from accepted engine events", () => {
    const r = cometSuddenDeath();
    expect(r.energyByCard.chaos_comet).toEqual({ plays: 15, energy: 60 });
    expect(r.cometEnergy).toBe(60);
    expect(r.cycleEnergy).toBe(r.engineSpent - 60);
    expect(r.engineSpent).toBe(r.energySpent);
    expect(Object.values(r.energyByCard).reduce((n, x) => n + x.plays, 0)).toBe(r.comets + r.cyclePlays);
  });
});
