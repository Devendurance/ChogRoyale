// Building-deck matchup (development harness only). Every deck pairing on
// both sides x MATCHUP_SEEDS through the deterministic side-neutral dev bot,
// replayed via runMatch. v8 decks = B2.7a archetypes, v9 decks = B2.7b
// cards, v11 decks = B2.7c1 counterplay (Gale Netter, Riftbreaker). The
// engine mirror check uses the v11 decks. DB-free. Usage: npm run buildings:matchup
import { MATCHUP_DECKS_V8, MATCHUP_DECKS_V9, MATCHUP_DECKS_V11, runMatchup, summarizeMatchup, positionReport, engineMirrorCheck } from "@/lib/building-matchup";
import { COMBAT_RULESET_VERSION } from "@/lib/combat";

const v8 = runMatchup(MATCHUP_DECKS_V8);
const v9 = runMatchup(MATCHUP_DECKS_V9);
const v11 = runMatchup(MATCHUP_DECKS_V11);
const mirror = (chaos: boolean) => {
  const rows = engineMirrorCheck(MATCHUP_DECKS_V11, undefined, chaos);
  return { symmetric: rows.filter((r) => r.symmetric).length, of: rows.length, asymmetric: rows.filter((r) => !r.symmetric) };
};
console.log(
  JSON.stringify(
    {
      ruleset: COMBAT_RULESET_VERSION,
      decks: { v8: MATCHUP_DECKS_V8, v9: MATCHUP_DECKS_V9, v11: MATCHUP_DECKS_V11 },
      engineMirrorV11: { noChaos: mirror(false), mirroredChaos: mirror(true) },
      v8Decks: { ...summarizeMatchup(v8), byPosition: positionReport(v8) },
      v9Decks: { ...summarizeMatchup(v9), byPosition: positionReport(v9) },
      v11Decks: { ...summarizeMatchup(v11), byPosition: positionReport(v11) },
      v11Rows: v11.map((r) => `${r.p0} vs ${r.p1} ${r.seed}: ${r.winner} ${r.endReason} ${r.crowns.join("-")} @${r.ticks}`),
    },
    null,
    1
  )
);
