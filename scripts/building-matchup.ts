// B2.7b building-deck matchup (development harness only). Every deck pairing
// on both sides x 4 seeds through the deterministic dev bot, replayed via
// runMatch. v8 decks = B2.7a baseline archetypes, v9 decks = same archetypes
// with the B2.7b cards. DB-free. Usage: npm run buildings:matchup
import { MATCHUP_DECKS_V8, MATCHUP_DECKS_V9, runMatchup, summarizeMatchup } from "@/lib/building-matchup";
import { COMBAT_RULESET_VERSION } from "@/lib/combat";

const v8 = runMatchup(MATCHUP_DECKS_V8);
const v9 = runMatchup(MATCHUP_DECKS_V9);
console.log(
  JSON.stringify(
    {
      ruleset: COMBAT_RULESET_VERSION,
      decks: { v8: MATCHUP_DECKS_V8, v9: MATCHUP_DECKS_V9 },
      v8Decks: summarizeMatchup(v8),
      v9Decks: summarizeMatchup(v9),
      v9Rows: v9.map((r) => `${r.p0} vs ${r.p1} ${r.seed}: ${r.winner} ${r.endReason} ${r.crowns.join("-")} @${r.ticks}`),
    },
    null,
    1
  )
);
