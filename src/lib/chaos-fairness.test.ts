// v13 ranked Chaos spatial fairness tests (pure, DB-free).

import { describe, it, expect } from "vitest";
import { runMatch, stateHash, rankedChaosZones, rankedHazardTick, chaosZoneOf, COMBAT_RULESET_VERSION, type DeployCommand } from "@/lib/combat";
import { scenarioConfig, deckWith } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V12_MAULER, laneSwapCheck } from "@/lib/building-matchup";
import { FAIRNESS_PATRONS, chaosExposure, chaosSwapCheck, fairnessSchedule, rawZoneAudit } from "@/lib/chaos-fairness";
import type { ArenaZone, ChaosFamily, ChaosSchedule } from "@/lib/chaos";

const SUBSETS: ArenaZone[][] = [["north"], ["center"], ["south"], ["north", "center"], ["center", "south"], ["north", "south"], ["north", "center", "south"]];
const MIRROR: Record<ArenaZone, ArenaZone> = { north: "south", south: "north", center: "center" };

/** First real derived event of `family`, isolated as a one-event schedule, optionally re-zoned. */
function single(family: ChaosFamily, zones?: ArenaZone[]): ChaosSchedule {
  for (const p of Object.keys(FAIRNESS_PATRONS)) {
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const s = fairnessSchedule(p, seed);
      const ev = s.events.find((e) => e.family === family);
      if (!ev) continue;
      if (!zones) return { ...s, events: [ev] };
      const effect = ev.effect.kind === "zone" ? { ...ev.effect, crossing: zones[0]! } : { ...ev.effect, zones };
      return { ...s, events: [{ ...ev, zones, effect }] };
    }
  }
  throw new Error(`no ${family} event`);
}
const act = (s: ChaosSchedule) => Math.round(s.events[0]!.activationMs / 100);
const dur = (s: ChaosSchedule) => Math.round(s.events[0]!.effect.durationMs / 100);

describe("v13 ranked chaos zones", () => {
  it("bumps the combat ruleset", () => {
    expect(COMBAT_RULESET_VERSION).toBe("v13");
  });

  it("closes every zone set under the mirror and preserves the budget ratio", () => {
    expect(rankedChaosZones(["north"])).toEqual({ zones: ["north", "south"], num: 1, den: 2 });
    expect(rankedChaosZones(["center"])).toEqual({ zones: ["center"], num: 1, den: 1 });
    expect(rankedChaosZones(["north", "center"])).toEqual({ zones: ["north", "center", "south"], num: 2, den: 3 });
    expect(rankedChaosZones(["south", "north"])).toEqual({ zones: ["north", "south"], num: 2, den: 2 });
    for (const zs of SUBSETS) expect(rankedChaosZones(zs.map((z) => MIRROR[z]))).toEqual(rankedChaosZones(zs));
  });

  it("splits hazard damage exactly with integer ticks", () => {
    for (const [perTick, num, den] of [[1, 1, 2], [2, 1, 2], [2, 2, 3], [1, 2, 3], [2, 3, 3]] as const) {
      let total = 0;
      for (let e = 0; e < den * 10; e++) total += rankedHazardTick(perTick, e, num, den);
      expect(total).toBe(perTick * num * 10);
    }
    expect(rankedHazardTick(2, 7, 1, 1)).toBe(2);
  });

  it("zone bands stay mirror-exact", () => {
    for (let y = 0; y <= 160; y++) expect(chaosZoneOf(160 - y)).toBe(MIRROR[chaosZoneOf(y) as ArenaZone]);
  });
});

describe("raw B1 schedules are side-biased but unchanged", () => {
  it("audits which families name side-biased zones", () => {
    const audit = rawZoneAudit(undefined, ["z0", "z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8", "z9"]);
    expect(audit.ember_rift!.biased).toBeGreaterThan(0);
    expect(audit.rift_shift!.biased).toBeGreaterThan(0);
    for (const f of ["frost_crossing", "energy_surge", "chaos_rally"]) expect(audit[f]?.biased ?? 0).toBe(0);
  });

  it("simulation never mutates the immutable schedule or its hash", () => {
    const s = fairnessSchedule("neutral", "s1");
    const snapshot = JSON.stringify(s);
    runMatch(scenarioConfig(MATCHUP_DECKS_V12_MAULER.swarm!, MATCHUP_DECKS_V12_MAULER.control!, s, "s1"), [], 1700);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(fairnessSchedule("neutral", "s1").scheduleHash).toBe(s.scheduleHash);
  });

  it("ranked exposure is equal by side for every patron and seed", () => {
    let biasedAbsolute = 0;
    for (const p of Object.keys(FAIRNESS_PATRONS)) {
      for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
        const s = fairnessSchedule(p, seed);
        for (const fam of ["ember_rift", "rift_shift"] as const) {
          const r = chaosExposure(s, "ranked")[fam];
          const a = chaosExposure(s, "absolute")[fam];
          expect(r.p0Home).toBeCloseTo(r.p1Home, 9);
          expect(r.p0Home + r.p1Home + r.shared).toBeCloseTo(a.p0Home + a.p1Home + a.shared, 9);
          if (a.p0Home !== a.p1Home) biasedAbsolute += 1;
        }
      }
    }
    expect(biasedAbsolute).toBeGreaterThan(0);
  });
});

describe("all five families under v13", () => {
  const cmd = (seq: number, player: 0 | 1, tick: number, cardId: string, x: number, y: number): DeployCommand => ({ seq, player, tick, cardId, x, y });
  const deck = deckWith("chog_guardian", "hexwing");
  // Ground and air units parked in each home third right before activation.
  const units = (t: number) => [cmd(1, 0, t, "chog_guardian", 15, 30), cmd(2, 1, t, "chog_guardian", 15, 130), cmd(3, 0, t, "hexwing", 85, 30), cmd(4, 1, t, "hexwing", 85, 130)];

  it("Ember Rift on one home third hits both home thirds at half rate, identically for north and south", () => {
    const north = single("ember_rift", ["north"]);
    const south = single("ember_rift", ["south"]);
    const a = act(north);
    const run = (s: ChaosSchedule | null) => runMatch(scenarioConfig(deck, deck, s, "fx"), units(a - 2), a + 6);
    const n = run(north);
    const s = run(south);
    const none = run(null);
    expect(stateHash(n.state)).toBe(stateHash(s.state));
    expect(stateHash(n.state)).not.toBe(stateHash(none.state));
    const hpOf = (st: typeof n.state, owner: 0 | 1, card: string) => st.troops.find((t) => t.owner === owner && t.cardId === card)!.hp;
    for (const card of ["chog_guardian", "hexwing"]) {
      const lost0 = hpOf(none.state, 0, card) - hpOf(n.state, 0, card);
      const lost1 = hpOf(none.state, 1, card) - hpOf(n.state, 1, card);
      expect(lost0).toBeGreaterThan(0);
      expect(lost0).toBe(lost1);
    }
    expect(n.state.events.some((e) => e.type === "pulse_active")).toBe(true);
  });

  it("Ember Rift on the center stays a center-only full-rate hazard", () => {
    const s = single("ember_rift", ["center"]);
    const a = act(s);
    const run = (x: ChaosSchedule | null) => runMatch(scenarioConfig(deck, deck, x, "fx"), units(a - 2), a + 6);
    const st = run(s).state;
    expect(st.events.some((e) => e.type === "pulse_active")).toBe(true);
    const ctrl = run(null).state;
    for (const t of st.troops) expect(t.hp).toBe(ctrl.troops.find((c) => c.id === t.id)!.hp);
  });

  it("Rift Shift on a home third modifies both home thirds for half time and keeps the full Ford", () => {
    const north = single("rift_shift", ["north"]);
    const south = single("rift_shift", ["south"]);
    const a = act(north);
    const d = dur(north);
    const n = runMatch(scenarioConfig(deck, deck, north, "fx"), units(a - 2), a + 1);
    expect(n.state.zoneMods.map((z) => [z.zone, z.until])).toEqual([["north", a + Math.floor(d / 2)], ["south", a + Math.floor(d / 2)]]);
    expect(n.state.riftOpenUntil).toBe(a + d);
    const full = (s: ChaosSchedule) => runMatch(scenarioConfig(deck, deck, s, "fx"), units(a - 2), a + d + 5).state;
    expect(stateHash(full(north))).toBe(stateHash(full(south)));
    const c = runMatch(scenarioConfig(deck, deck, single("rift_shift", ["center"]), "fx"), [], a + 1).state;
    expect(c.zoneMods.map((z) => [z.zone, z.until])).toEqual([["center", a + d]]);
  });

  it("board-wide families keep their effects and full lifecycle", () => {
    for (const fam of ["frost_crossing", "energy_surge", "chaos_rally", "ember_rift", "rift_shift"] as ChaosFamily[]) {
      const s = single(fam);
      const a = act(s);
      const d = dur(s);
      const mid = runMatch(scenarioConfig(deck, deck, s, "fx"), units(a - 2), a + 1).state;
      if (fam === "frost_crossing") expect(mid.moveModPct).toBe((s.events[0]!.effect as { multiplierPct: number }).multiplierPct);
      if (fam === "energy_surge") expect(mid.energyModPct).toBe((s.events[0]!.effect as { deltaPct: number }).deltaPct);
      if (fam === "chaos_rally") {
        const fx = s.events[0]!.effect as { stat: string; multiplierPct: number };
        const t = mid.troops[0]!;
        expect(fx.stat === "attack" ? t.buffPct : t.guardPct).toBe(Math.max(0, fx.multiplierPct - 100));
      }
      const end = runMatch(scenarioConfig(deck, deck, s, "fx"), [], a + d + 2).state;
      const types = end.events.filter((e) => e.type.startsWith("pulse_")).map((e) => e.type);
      expect(types).toEqual(["pulse_warning", "pulse_active", "pulse_expired"]);
      expect(end.moveModPct).toBe(100);
      expect(end.energyModPct).toBe(100);
    }
  });
});

describe("side swaps with unchanged raw schedules", () => {
  it("real schedules swap exactly in bot matches (previous raw mismatches included)", { timeout: 240_000 }, () => {
    const D = MATCHUP_DECKS_V12_MAULER;
    const r = chaosSwapCheck([D.swarm!, D.control!], ["neutral", "surge", "rallyAura", "rift"], ["s1", "s2", "s3", "s4"]);
    expect(r.withBiasedEvents).toBeGreaterThan(0);
    expect(r.rawExact).toBe(r.games);
    expect(r.mirroredExact).toBe(r.games);
  });

  it("lane-swap with the raw schedule now flips exactly", { timeout: 240_000 }, () => {
    const D = MATCHUP_DECKS_V12_MAULER;
    const decks = { swarm: D.swarm!, control: D.control! };
    expect(laneSwapCheck(decks, undefined, "rift").exact).toBe(16);
    expect(laneSwapCheck(decks, undefined, "none").exact).toBe(16);
  });

  it("same-seed replays stay identical with a side-biased raw schedule", () => {
    const s = single("ember_rift", ["north", "center"]);
    const cfg = () => scenarioConfig(MATCHUP_DECKS_V12_MAULER.siege!, MATCHUP_DECKS_V12_MAULER.turret!, s, "rep");
    const a = runMatch(cfg(), [], 900);
    const b = runMatch(cfg(), [], 900);
    expect(a.result.stateHash).toBe(b.result.stateHash);
  });
});
