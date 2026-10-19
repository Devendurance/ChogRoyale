// B2.8b siege balance harness. Runs the Rift Mortar deck against each
// opponent on both seats, both bots, Chaos on/off, seeds c1..c8 (320 games).
// Records matchup metrics plus siege-specific counts (shots fired, shells
// that hit a structure) and the real stateHash for distinct-game counting.
// Raw output goes to %TEMP%/chog-siege-matchup.json; a text table to
// %TEMP%/chog-siege-matchup.txt.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMatch, stateHash, type CombatConfig, type CombatState } from "../src/lib/combat";
import { botMatch, scenarioConfig, deckWith, riftSchedule } from "../src/lib/arena-scenarios";
import { DECKS_V13, POLICIES, type ChaosMode } from "../src/lib/bot-economy";
import { CONTROL_REVISED } from "../src/lib/balance-calibration";
import { measure, type MatchupRow } from "../src/lib/building-matchup";

const MORTAR = deckWith("rift_mortar", "chog_guardian", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt", "cmdr:free-warden");
const BUILDING_COUNTER = deckWith("riftbreaker", "chaos_comet", "rift_sentry", "gale_netter", "chog_guardian", "chaos_archer", "sparkcaster", "cmdr:free-scout");

const opponents: Record<string, string[]> = {
  swarm: DECKS_V13.swarm!,
  antiSwarm: DECKS_V13.antiSwarm!,
  breaker: DECKS_V13.breaker!,
  controlRevised: CONTROL_REVISED,
  buildingCounter: BUILDING_COUNTER,
};
const seeds = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);

interface Extra {
  mortarsDeployedBySeat: [number, number];
  shotsFiredBySeat: [number, number];
  structureShellHitsBySeat: [number, number];
}

function siegeStats(state: CombatState): Extra {
  const mortars: [number, number] = [0, 0];
  const shots: [number, number] = [0, 0];
  const structHits: [number, number] = [0, 0];
  for (const e of state.events) {
    if (e.type === "building_spawned" && e.cardId === "rift_mortar") mortars[e.player] += 1;
    else if (e.type === "siege_fired") shots[e.owner] += 1;
    else if (e.type === "spell_impact" && e.cardId === "rift_mortar" && e.structures > 0) structHits[e.player] += 1;
  }
  return { mortarsDeployedBySeat: mortars, shotsFiredBySeat: shots, structureShellHitsBySeat: structHits };
}

interface Row extends MatchupRow {
  opponent: string;
  policy: "smart" | "simple";
  chaos: ChaosMode;
  candSeat: 0 | 1;
  hash: string;
  extra: Extra;
}

const rows: Row[] = [];
for (const [opp, odeck] of Object.entries(opponents)) {
  for (const policy of ["smart", "simple"] as const) {
    for (const chaos of ["none", "rift"] as const satisfies ChaosMode[]) {
      for (const seat of [0, 1] as const) {
        for (const seed of seeds) {
          const decks: [string[], string[]] = seat === 0 ? [MORTAR, odeck] : [odeck, MORTAR];
          const cfg = (): CombatConfig => scenarioConfig(decks[0], decks[1], chaos === "none" ? null : riftSchedule(seed), seed);
          const pol = POLICIES[policy];
          const bot = botMatch(cfg(), 3100, 20, { policies: [pol, pol] });
          const replay = runMatch(cfg(), bot.commands);
          rows.push({
            opponent: opp, policy, chaos, candSeat: seat,
            p0: seat === 0 ? "mortar" : opp, p1: seat === 0 ? opp : "mortar", seed,
            ...measure(replay.state), econ: bot.econ,
            replayIdentical: replay.result.stateHash === stateHash(bot.state),
            hash: replay.result.stateHash,
            extra: siegeStats(replay.state),
          });
        }
      }
    }
  }
  console.log(`done vs ${opp}`);
}

const jsonPath = join(tmpdir(), "chog-siege-matchup.json");
writeFileSync(jsonPath, JSON.stringify(rows, null, 1));

export function summarize(rs: Row[]): string[] {
  const lines: string[] = ["opponent | policy | chaos | games | distinct | wins | oppW | draws | crowns | oppCrowns | avgTicks | mortars | shots | shellHits | twrDmgDealt | rejected | replayOK"];
  for (const opp of Object.keys(opponents)) {
    for (const policy of ["smart", "simple"] as const) {
      for (const chaos of ["none", "rift"] as const) {
        const sel = rs.filter((r) => r.opponent === opp && r.policy === policy && r.chaos === chaos);
        const wins = sel.filter((r) => r.winner === r.candSeat).length;
        const oppW = sel.filter((r) => r.winner !== "draw" && r.winner !== null && r.winner !== r.candSeat).length;
        const draws = sel.filter((r) => r.winner === "draw").length;
        const crowns = sel.reduce((n, r) => n + r.crowns[r.candSeat], 0);
        const oppCrowns = sel.reduce((n, r) => n + r.crowns[1 - r.candSeat], 0);
        const avg = (f: (r: Row) => number) => Math.round((sel.reduce((n, r) => n + f(r), 0) / Math.max(sel.length, 1)) * 10) / 10;
        lines.push([
          opp, policy, chaos, sel.length, new Set(sel.map((r) => r.hash)).size,
          wins, oppW, draws, crowns, oppCrowns, avg((r) => r.ticks),
          avg((r) => r.extra.mortarsDeployedBySeat[r.candSeat]),
          avg((r) => r.extra.shotsFiredBySeat[r.candSeat]),
          avg((r) => r.extra.structureShellHitsBySeat[r.candSeat]),
          avg((r) => r.towerDamage[1 - r.candSeat]),
          sel.reduce((n, r) => n + r.rejected, 0),
          sel.filter((r) => r.replayIdentical).length,
        ].join(" | "));
      }
    }
  }
  return lines;
}

const lines = summarize(rows);
const txtPath = join(tmpdir(), "chog-siege-matchup.txt");
writeFileSync(txtPath, lines.join("\n") + "\n");
console.log("wrote", jsonPath, txtPath);
