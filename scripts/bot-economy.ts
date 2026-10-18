// B2.7c4 deck economy + bot strategy report (dev-only, DB-free).
// Run: npm run bots:economy -- <baseline|duel|ablation|pairs|fairness|all>

import { COMBAT_RULESET_VERSION } from "@/lib/combat";
import { laneSwapCheck, engineMirrorCheck } from "@/lib/building-matchup";
import { DECKS_V13, baseline, policyDuel, strategyPairs, swarmAblation } from "@/lib/bot-economy";
import { smartMove } from "@/lib/smart-bot";

const SEEDS = ["m1", "m2", "m3"];
const section = process.argv[2] ?? "all";
const out: Record<string, unknown> = { ruleset: COMBAT_RULESET_VERSION, seeds: SEEDS };
const run = (name: string, f: () => unknown) => {
  if (section === name || section === "all") out[name] = f();
};

run("baseline", () => ({
  simpleNone: baseline("simple", "none", SEEDS),
  simpleRift: baseline("simple", "rift", SEEDS),
  smartNone: baseline("smart", "none", SEEDS),
  smartRift: baseline("smart", "rift", SEEDS),
}));
run("duel", () => ({ none: policyDuel(DECKS_V13, SEEDS, "none"), rift: policyDuel(DECKS_V13, SEEDS, "rift") }));
run("ablation", () => ({ simple: swarmAblation("simple", SEEDS), smart: swarmAblation("smart", SEEDS) }));
run("pairs", () => strategyPairs(SEEDS));
run("fairness", () => {
  const strip = <T extends { mismatches: unknown[] }>(r: T) => ({ ...r, mismatches: r.mismatches.length });
  return {
    laneSwapSmart: { none: strip(laneSwapCheck(DECKS_V13, ["m1", "m2", "m3", "m4"], "none", smartMove)), rawChaos: strip(laneSwapCheck(DECKS_V13, ["m1", "m2", "m3", "m4"], "rift", smartMove)) },
    laneSwapSimple: { none: strip(laneSwapCheck(DECKS_V13, ["m1", "m2", "m3", "m4"], "none")), rawChaos: strip(laneSwapCheck(DECKS_V13, ["m1", "m2", "m3", "m4"], "rift")) },
    engineMirror: { none: engineMirrorCheck(DECKS_V13, ["m1", "m2"]).filter((r) => r.symmetric).length, chaos: engineMirrorCheck(DECKS_V13, ["m1", "m2"], true).filter((r) => r.symmetric).length, games: 72 },
  };
});

console.log(JSON.stringify(out, null, 2));
