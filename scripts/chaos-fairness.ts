// Ranked Chaos spatial fairness report (dev-only, DB-free).
// Run: npm run chaos:fairness

import { COMBAT_RULESET_VERSION } from "@/lib/combat";
import { MATCHUP_DECKS_V12_MAULER, laneSwapCheck } from "@/lib/building-matchup";
import { FAIRNESS_PATRONS, chaosExposure, chaosSwapCheck, fairnessSchedule, rawZoneAudit } from "@/lib/chaos-fairness";

const D = MATCHUP_DECKS_V12_MAULER;
const exposure = Object.fromEntries(
  Object.keys(FAIRNESS_PATRONS).map((p) => {
    const s = fairnessSchedule(p, "s1");
    return [p, { families: s.events.map((e) => e.family), absolute: chaosExposure(s, "absolute"), ranked: chaosExposure(s, "ranked") }];
  })
);
const strip = (r: ReturnType<typeof chaosSwapCheck>) => ({ ...r, mismatches: r.mismatches.map((m) => `${m.patron}/${m.seed} biased=${m.biasedEvents} raw=${m.raw} mirrored=${m.mirrored} :: ${m.detail}`) });

console.log(
  JSON.stringify(
    {
      ruleset: COMBAT_RULESET_VERSION,
      rawZoneAudit: rawZoneAudit(),
      exposureSeedS1: exposure,
      swapSiegeVsTurret: strip(chaosSwapCheck([D.siege!, D.turret!])),
      swapSwarmVsControl: strip(chaosSwapCheck([D.swarm!, D.control!])),
      laneSwap: {
        none: laneSwapCheck(D, undefined, "none").exact,
        rawChaos: laneSwapCheck(D, undefined, "rift").exact,
        mirroredChaos: laneSwapCheck(D, undefined, "rift-mirrored").exact,
      },
    },
    null,
    2
  )
);
