// B2.7c5 controlled balance calibration. Pure: no DB, no network.
// Candidates are temporary, named patches over the live v14 tables, applied
// only inside withBalanceCandidate() and always restored afterwards. They
// never ship by being run here: a shipped change edits the authored tables
// and bumps COMBAT_RULESET_VERSION. States produced under a candidate still
// carry the v14 label, so their hashes are experiment-only and never stored.

import { deckWith } from "@/lib/arena-scenarios";
import { DECKS_V13, POLICIES, SWARM_VARIANTS, chaosFor, deckReport, fieldTotals, type ChaosMode } from "@/lib/bot-economy";
import { runMatchup, type MatchupRow } from "@/lib/building-matchup";
import { COMMANDER_COMBAT_PROFILE_V1, TROOP_CARDS_V1 } from "@/lib/combat";

interface Patch {
  obj: object;
  key: string;
  value: number;
}

export const BALANCE_CANDIDATES: Record<string, { note: string; patches: () => Patch[] }> = {
  baseline: { note: "v14 values", patches: () => [] },
  // A: only the Scout deploy cost moves; HP, damage, speed, abilities stay.
  scoutCost5: { note: "Scout commander 4e -> 5e", patches: () => [{ obj: COMMANDER_COMBAT_PROFILE_V1.scout, key: "cost", value: 5 }] },
  // B: only the Choglings deploy cost moves; unit stats stay.
  choglingsCost3: { note: "Choglings 2e -> 3e", patches: () => [{ obj: TROOP_CARDS_V1.choglings!, key: "cost", value: 3 }] },
  // C: 60 -> 50 HP (-17%). Chosen at a real breakpoint: tower shots (25) to
  // kill one drop 3 -> 2, Guardian (26) and Reaver (27) hits 3 -> 2. Archer
  // (15), Sentry (16), Mauler (24), Sparkcaster (22) breakpoints unchanged.
  choglingsHp50: { note: "Choglings 60 -> 50 HP, cost 2", patches: () => [{ obj: TROOP_CARDS_V1.choglings!, key: "hp", value: 50 }] },
};
export type CandidateName = keyof typeof BALANCE_CANDIDATES;

export function withBalanceCandidate<T>(name: string, fn: () => T): T {
  const cand = BALANCE_CANDIDATES[name];
  if (!cand) throw new Error(`unknown balance candidate ${name}`);
  const patches = cand.patches();
  const saved = patches.map((p) => (p.obj as Record<string, number>)[p.key]!);
  try {
    for (const p of patches) (p.obj as Record<string, number>)[p.key] = p.value;
    return fn();
  } finally {
    patches.forEach((p, i) => ((p.obj as Record<string, number>)[p.key] = saved[i]!));
  }
}

/**
 * Revised control deck from existing cards only. Win condition: Boulderback
 * tank with Archer/Sparkcaster support and the Warden behind it. Defence:
 * Sentry (ground), Bolt (swarms), Sparkcaster splash, Archer anti-air.
 * Cycle: Sprites 1e, Snare 2e. Average ordinary cost 3.1 (original 3.6).
 * Same Warden commander as the original control deck.
 */
export const CONTROL_REVISED = deckWith("boulderback", "chaos_archer", "sparkcaster", "rift_sentry", "rift_snare", "rift_sprites", "chaos_bolt", "cmdr:free-warden");

const winsOf = (rows: MatchupRow[]) => {
  const rep = deckReport(rows);
  return Object.fromEntries(
    Object.entries(rep).map(([k, o]) => [k, { w: o.wins, g: o.games, crowns: o.crownsFor, twrDmg: o.towerDmgDealt, energy: o.energySpent, ppm: o.playsPerMin, cmdr: o.commanderDeploys, abil: o.abilities }])
  );
};

/** Full field under one candidate, all ordered deck pairs per seed (both seats). */
export function fieldUnder(candidate: string, policy: "simple" | "smart", chaos: ChaosMode, seeds: string[], decks: Record<string, string[]> = DECKS_V13) {
  return withBalanceCandidate(candidate, () => {
    const p = POLICIES[policy];
    const rows = runMatchup(decks, seeds, chaosFor(chaos), [p, p]);
    const t = fieldTotals(rows);
    const choglings = t.cardUsage["choglings"] ?? 0;
    return { decks: winsOf(rows), avgTicks: t.avgTicks, rejected: t.rejected, replayIdentical: t.replayIdentical, unfinished: t.unfinished, p0: t.p0, p1: t.p1, draws: t.draws, choglingsPlays: choglings };
  });
}

const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, DECKS_V13[k]!]));
/** Non-Scout opponents, so a Scout cost change touches only the test deck. */
export const SCOUT_FREE_FIELD = pick(["siege", "control", "antiSwarm", "turret"]);

/**
 * 2x2: {cheap swarm, heavy swarm} x {Scout 4e, Scout 5e}, same Scout class,
 * same opponents. A cheap-commander x cheap-card interaction shows up as
 * the Scout cost mattering more for the cheap deck than for the heavy one.
 */
export function scoutInteraction(policy: "simple" | "smart", seeds: string[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const cand of ["baseline", "scoutCost5"]) {
    out[cand] = {};
    for (const name of ["swarm", "swarmHeavy"]) {
      withBalanceCandidate(cand, () => {
        const rows = runMatchup({ [name]: SWARM_VARIANTS[name]!, ...SCOUT_FREE_FIELD }, seeds, "none", [POLICIES[policy], POLICIES[policy]]).filter((r) => (r.p0 === name) !== (r.p1 === name));
        const r = deckReport(rows)[name]!;
        out[cand]![name] = `${r.wins}/${r.games}`;
      });
    }
  }
  return out;
}

/** Original vs revised control against the same five opponents, plus head-to-head. */
export function controlComparison(policy: "simple" | "smart", chaos: ChaosMode, seeds: string[]) {
  const others = Object.fromEntries(Object.entries(DECKS_V13).filter(([k]) => k !== "control"));
  const p = POLICIES[policy];
  const vsField = (name: string, deck: string[]) => {
    const rows = runMatchup({ [name]: deck, ...others }, seeds, chaosFor(chaos), [p, p]).filter((r) => (r.p0 === name) !== (r.p1 === name));
    const per: Record<string, number> = {};
    for (const r of rows) {
      const opp = r.p0 === name ? r.p1 : r.p0;
      const seat = r.p0 === name ? 0 : 1;
      per[opp] = (per[opp] ?? 0) + (r.winner === seat ? 1 : 0);
    }
    const rep = deckReport(rows)[name]!;
    return { wins: `${rep.wins}/${rep.games}`, perOpponent: per, energy: rep.energySpent, ppm: rep.playsPerMin, cmdr: rep.commanderDeploys, abil: rep.abilities };
  };
  const h2h = deckReport(runMatchup({ control: DECKS_V13.control!, controlRevised: CONTROL_REVISED }, seeds, chaosFor(chaos), [p, p]).filter((r) => r.p0 !== r.p1));
  return { original: vsField("control", DECKS_V13.control!), revised: vsField("controlRevised", CONTROL_REVISED), headToHead: { revised: h2h.controlRevised?.wins ?? 0, original: h2h.control?.wins ?? 0, games: h2h.control?.games ?? 0 } };
}
