import { describe, expect, it } from "vitest";
import { BALANCE_CANDIDATES, CONTROL_REVISED, withBalanceCandidate } from "@/lib/balance-calibration";
import { DECKS_V13 } from "@/lib/bot-economy";
import { runMatchup } from "@/lib/building-matchup";
import { COMMANDER_COMBAT_PROFILE_V1, TROOP_CARDS_V1 } from "@/lib/combat";
import { smartMove } from "@/lib/smart-bot";

const live = () => ({ scout: COMMANDER_COMBAT_PROFILE_V1.scout.cost, cost: TROOP_CARDS_V1.choglings!.cost, hp: TROOP_CARDS_V1.choglings!.hp });

describe("B2.7c5 balance calibration harness", () => {
  it("applies each candidate only inside its scope and restores v14 values", () => {
    const before = live();
    expect(before).toEqual({ scout: 4, cost: 2, hp: 60 });
    expect(withBalanceCandidate("scoutCost5", live)).toEqual({ ...before, scout: 5 });
    expect(withBalanceCandidate("choglingsCost3", live)).toEqual({ ...before, cost: 3 });
    expect(withBalanceCandidate("choglingsHp50", live)).toEqual({ ...before, hp: 50 });
    expect(withBalanceCandidate("baseline", live)).toEqual(before);
    expect(live()).toEqual(before);
  });

  it("restores values when the experiment throws and rejects unknown candidates", () => {
    expect(() =>
      withBalanceCandidate("choglingsHp50", () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(live()).toEqual({ scout: 4, cost: 2, hp: 60 });
    expect(() => withBalanceCandidate("nope", live)).toThrow(/unknown balance candidate/);
    expect(Object.keys(BALANCE_CANDIDATES)).toEqual(["baseline", "scoutCost5", "choglingsCost3", "choglingsHp50"]);
  });

  it("revised control deck plays legal, replay-identical matches with the same Warden commander", () => {
    expect(CONTROL_REVISED).toHaveLength(8);
    expect(CONTROL_REVISED.filter((c) => c.startsWith("cmdr:"))).toEqual(DECKS_V13.control!.filter((c) => c.startsWith("cmdr:")));
    const rows = runMatchup({ control: DECKS_V13.control!, controlRevised: CONTROL_REVISED }, ["t1"], "none", [smartMove, smartMove]);
    expect(rows.every((r) => r.rejected === 0 && r.replayIdentical)).toBe(true);
  }, 60_000);

  it("a candidate changes real outcomes deterministically, then the baseline returns exactly", () => {
    const run = () => runMatchup({ swarm: DECKS_V13.swarm!, siege: DECKS_V13.siege! }, ["t1"], "none", [smartMove, smartMove]).map((r) => `${r.p0}-${r.p1}:${r.winner}:${r.ticks}`);
    const base = run();
    const a = withBalanceCandidate("choglingsCost3", run);
    expect(withBalanceCandidate("choglingsCost3", run)).toEqual(a);
    expect(a).not.toEqual(base);
    expect(run()).toEqual(base);
  }, 120_000);
});
