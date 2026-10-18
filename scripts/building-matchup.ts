// Building-deck matchup (development harness only). Every deck pairing on
// both sides x MATCHUP_SEEDS through the deterministic side-neutral dev bot,
// replayed via runMatch. v8 = B2.7a archetypes, v9 = B2.7b cards, v11 =
// B2.7c1 counterplay, v12 = B2.7c2 controlled comparison (BASE vs MAULER:
// identical swarm deck, every other deck differs by exactly one card).
// Engine mirror check uses the v12 Mauler decks. laneSwap plays every deck
// against itself normally and with P1 given P0's lane sequence and turns
// (without Chaos, mirrored Chaos and the raw schedule). DB-free. Usage: npm run buildings:matchup
import {
  MATCHUP_DECKS_V8,
  MATCHUP_DECKS_V9,
  MATCHUP_DECKS_V11,
  MATCHUP_DECKS_V12_BASE,
  MATCHUP_DECKS_V12_MAULER,
  MATCHUP_SEEDS,
  runMatchup,
  summarizeMatchup,
  positionReport,
  engineMirrorCheck,
  laneSwapCheck,
} from "@/lib/building-matchup";
import { COMBAT_RULESET_VERSION } from "@/lib/combat";

const report = (rows: ReturnType<typeof runMatchup>) => ({ ...summarizeMatchup(rows), byPosition: positionReport(rows) });
const mirror = (chaos: boolean) => {
  const rows = engineMirrorCheck(MATCHUP_DECKS_V12_MAULER, undefined, chaos);
  return { symmetric: rows.filter((r) => r.symmetric).length, of: rows.length, asymmetric: rows.filter((r) => !r.symmetric) };
};

const v12base = runMatchup(MATCHUP_DECKS_V12_BASE);
const v12mauler = runMatchup(MATCHUP_DECKS_V12_MAULER);
console.log(
  JSON.stringify(
    {
      ruleset: COMBAT_RULESET_VERSION,
      decks: { v12base: MATCHUP_DECKS_V12_BASE, v12mauler: MATCHUP_DECKS_V12_MAULER },
      engineMirrorV12: { noChaos: mirror(false), mirroredChaos: mirror(true) },
      laneSwap: { noChaos: laneSwapCheck(MATCHUP_DECKS_V12_MAULER, MATCHUP_SEEDS, "none"), mirroredChaos: laneSwapCheck(MATCHUP_DECKS_V12_MAULER, MATCHUP_SEEDS, "rift-mirrored"), rawChaos: laneSwapCheck(MATCHUP_DECKS_V12_MAULER, MATCHUP_SEEDS, "rift") },
      v8Decks: report(runMatchup(MATCHUP_DECKS_V8)),
      v9Decks: report(runMatchup(MATCHUP_DECKS_V9)),
      v11Decks: report(runMatchup(MATCHUP_DECKS_V11)),
      v12Base: report(v12base),
      v12Mauler: report(v12mauler),
      v12MaulerRows: v12mauler.map((r) => `${r.p0} vs ${r.p1} ${r.seed}: ${r.winner} ${r.endReason} ${r.crowns.join("-")} @${r.ticks}`),
    },
    null,
    1
  )
);
