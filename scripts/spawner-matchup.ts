// B2.7c6 spawner balance harness. For each candidate deck (the burrow
// spawner deck and the same deck with rift_sentry swapped in as control),
// runs it against each opponent on both seats, both bots, Chaos on/off,
// seeds c1..c8. Records matchup metrics plus spawner-specific counts and
// the real stateHash for distinct-game counting. Raw output goes to
// %TEMP%/chog-spawner-matchup.json; a text table to
// %TEMP%/chog-spawner-matchup.txt.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMatch, stateHash, type CombatConfig, type CombatState } from "../src/lib/combat";
import { botMatch, scenarioConfig, deckWith, riftSchedule } from "../src/lib/arena-scenarios";
import { DECKS_V13, POLICIES, type ChaosMode } from "../src/lib/bot-economy";
import { CONTROL_REVISED } from "../src/lib/balance-calibration";
import { measure, type MatchupRow } from "../src/lib/building-matchup";

const SPAWNER = deckWith("chog_burrow", "chog_guardian", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt", "cmdr:free-warden");
const SWAP = deckWith("rift_sentry", "chog_guardian", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt", "cmdr:free-warden");
const BUILDING_COUNTER = deckWith("riftbreaker", "chaos_comet", "rift_sentry", "gale_netter", "chog_guardian", "chaos_archer", "sparkcaster", "cmdr:free-scout");

const candidates: Record<string, string[]> = { spawner: SPAWNER, sentrySwap: SWAP };
const opponents: Record<string, string[]> = {
  swarm: DECKS_V13.swarm!,
  antiSwarm: DECKS_V13.antiSwarm!,
  breaker: DECKS_V13.breaker!,
  controlRevised: CONTROL_REVISED,
  buildingCounter: BUILDING_COUNTER,
};
const seeds = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);

interface Extra {
  spawnsBySeat: [number, number];
  skippedBySeat: [Record<string, number>, Record<string, number>];
  scrapperDeathsBySeat: [number, number];
  peakAliveBySeat: [number, number];
  burrowLifetimeTicksBySeat: [number, number];
  burrowsDeployedBySeat: [number, number];
}

function spawnerStats(state: CombatState): Extra {
  const alive: [number, number] = [0, 0];
  const peak: [number, number] = [0, 0];
  const deaths: [number, number] = [0, 0];
  const spawns: [number, number] = [0, 0];
  const skipped: [Record<string, number>, Record<string, number>] = [{}, {}];
  const burrows: [number, number] = [0, 0];
  const burrowTicks: [number, number] = [0, 0];
  const owner = new Map<string, 0 | 1>();
  const spawnAt = new Map<string, number>();
  for (const e of state.events) {
    if (e.type === "building_spawned") {
      owner.set(e.buildingId, e.player);
      if (e.cardId === "chog_burrow") { burrows[e.player] += 1; spawnAt.set(e.buildingId, e.tick); }
    } else if (e.type === "building_removed") {
      const at = spawnAt.get(e.buildingId);
      if (at !== undefined) { burrowTicks[owner.get(e.buildingId)!] += e.tick - at; spawnAt.delete(e.buildingId); }
    } else if (e.type === "unit_spawned") {
      const o = owner.get(e.buildingId);
      if (o !== undefined) { owner.set(e.troopId, o); spawns[o] += 1; alive[o] += 1; peak[o] = Math.max(peak[o], alive[o]); }
    } else if (e.type === "spawn_skipped") {
      const o = owner.get(e.buildingId);
      if (o !== undefined) skipped[o][e.reason] = (skipped[o][e.reason] ?? 0) + 1;
    } else if (e.type === "death") {
      const o = owner.get(e.entityId);
      if (o !== undefined && e.entityId.startsWith("t")) { deaths[o] += 1; alive[o] -= 1; }
    }
  }
  for (const [id, at] of spawnAt) burrowTicks[owner.get(id)!] += state.tick - at;
  return { spawnsBySeat: spawns, skippedBySeat: skipped, scrapperDeathsBySeat: deaths, peakAliveBySeat: peak, burrowLifetimeTicksBySeat: burrowTicks, burrowsDeployedBySeat: burrows };
}

interface Row extends MatchupRow {
  candidate: string;
  opponent: string;
  policy: "smart" | "simple";
  chaos: ChaosMode;
  candSeat: 0 | 1;
  hash: string;
  extra: Extra;
}

const rows: Row[] = [];
for (const [cand, cdeck] of Object.entries(candidates)) {
  for (const [opp, odeck] of Object.entries(opponents)) {
    for (const policy of ["smart", "simple"] as const) {
      for (const chaos of ["none", "rift"] as const satisfies ChaosMode[]) {
        for (const seat of [0, 1] as const) {
          for (const seed of seeds) {
            const decks: [string[], string[]] = seat === 0 ? [cdeck, odeck] : [odeck, cdeck];
            const cfg = (): CombatConfig => scenarioConfig(decks[0], decks[1], chaos === "none" ? null : riftSchedule(seed), seed);
            const pol = POLICIES[policy];
            const bot = botMatch(cfg(), 3100, 20, { policies: [pol, pol] });
            const replay = runMatch(cfg(), bot.commands);
            rows.push({
              candidate: cand, opponent: opp, policy, chaos, candSeat: seat,
              p0: seat === 0 ? cand : opp, p1: seat === 0 ? opp : cand, seed,
              ...measure(replay.state), econ: bot.econ,
              replayIdentical: replay.result.stateHash === stateHash(bot.state),
              hash: replay.result.stateHash,
              extra: spawnerStats(replay.state),
            });
          }
        }
      }
    }
    console.log(`done ${cand} vs ${opp}`);
  }
}

const jsonPath = join(tmpdir(), "chog-spawner-matchup.json");
writeFileSync(jsonPath, JSON.stringify(rows, null, 1));

export function summarize(rs: Row[]): string[] {
  const lines: string[] = ["candidate | opponent | policy | chaos | games | distinct | wins | oppW | draws | crowns | oppCrowns | avgTicks | burrows | spawns | skips | scrDeaths | peakAlive | burrowTicksAlive | twrDmg | bldgSpawned | energy | rejected | replayOK"];
  for (const cand of Object.keys(candidates)) {
    for (const opp of Object.keys(opponents)) {
      for (const policy of ["smart", "simple"] as const) {
        for (const chaos of ["none", "rift"] as const) {
          const sel = rs.filter((r) => r.candidate === cand && r.opponent === opp && r.policy === policy && r.chaos === chaos);
          const wins = sel.filter((r) => r.winner === r.candSeat).length;
          const oppW = sel.filter((r) => r.winner !== "draw" && r.winner !== null && r.winner !== r.candSeat).length;
          const draws = sel.filter((r) => r.winner === "draw").length;
          const crowns = sel.reduce((n, r) => n + r.crowns[r.candSeat], 0);
          const oppCrowns = sel.reduce((n, r) => n + r.crowns[1 - r.candSeat], 0);
          const avg = (f: (r: Row) => number) => Math.round((sel.reduce((n, r) => n + f(r), 0) / Math.max(sel.length, 1)) * 10) / 10;
          lines.push([
            cand, opp, policy, chaos, sel.length, new Set(sel.map((r) => r.hash)).size,
            wins, oppW, draws, crowns, oppCrowns, avg((r) => r.ticks),
            avg((r) => r.extra.burrowsDeployedBySeat[r.candSeat]),
            avg((r) => r.extra.spawnsBySeat[r.candSeat]),
            avg((r) => (r.extra.skippedBySeat[r.candSeat].blocked ?? 0) + (r.extra.skippedBySeat[r.candSeat].cap ?? 0)),
            avg((r) => r.extra.scrapperDeathsBySeat[r.candSeat]),
            avg((r) => r.extra.peakAliveBySeat[r.candSeat]),
            avg((r) => r.extra.burrowLifetimeTicksBySeat[r.candSeat]),
            avg((r) => r.towerDamage[1 - r.candSeat]),
            avg((r) => r.bySide.buildings[r.candSeat]),
            avg((r) => r.energySpent[r.candSeat]),
            sel.reduce((n, r) => n + r.rejected, 0),
            sel.filter((r) => r.replayIdentical).length,
          ].join(" | "));
        }
      }
    }
  }
  return lines;
}

const lines = summarize(rows);
const txtPath = join(tmpdir(), "chog-spawner-matchup.txt");
writeFileSync(txtPath, lines.join("\n") + "\n");
console.log("wrote", jsonPath, txtPath);
