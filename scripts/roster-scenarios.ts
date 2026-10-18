// B2.7c1/B2.7c2 roster scenarios (Gale Netter, Riftbreaker, Ember Mauler).
// Real engine runs from legal commands, DB-free. Usage: npm run roster:scenarios
import * as R from "@/lib/roster-scenarios";
import * as S from "@/lib/splash-scenarios";
import { COMBAT_RULESET_VERSION } from "@/lib/combat";

console.log(
  JSON.stringify(
    {
      ruleset: COMBAT_RULESET_VERSION,
      A_netterVsHexwing: R.netterVsHexwing(),
      B_netterVsSprites: R.netterVsSprites(),
      C_netterPunished: R.netterPunished(),
      DE_breakerVsBuildings: R.breakerVsBuildings(),
      F_breakerSwarmed: R.breakerSwarmed(),
      G_runnerVsBreaker: R.runnerVsBreaker(),
      H_sentrySupportedDefense: R.sentrySupportedDefense(),
      I_combinedPush: R.combinedPush(),
      JKL_rosterBotMatch: R.rosterBotMatch(),
      mauler: {
        ABC_vsSwarm: S.maulerVsSwarm(),
        DE_counters: S.maulerCounters(),
        F_tankAndRanged: S.tankAndRanged(),
        G_duel: S.maulerDuel(),
        H_targets: S.maulerTargets(),
        IJK_botMatch: S.maulerBotMatch(),
      },
    },
    null,
    1
  )
);
