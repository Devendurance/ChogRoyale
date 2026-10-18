// B2.5 headless arena evidence (development harness only). Runs the real
// combat engine through scenarios A-K and prints measured results.
// DB-free, network-free. Usage: npm run arena:scenarios
import {
  scenarioBridge,
  scenarioBlockedRiver,
  scenarioAirVsGround,
  scenarioRush,
  scenarioPush,
  scenarioDistraction,
  scenarioTwoLanes,
  scenarioRiftShift,
  scenarioVictories,
  scenarioPocket,
  scenarioReplay,
} from "@/lib/arena-scenarios";
import { combatRulesetSummary } from "@/lib/combat";

const strip = <T extends { trace?: unknown }>(o: T) => {
  const { trace, ...rest } = o;
  void trace;
  return rest;
};

const out = {
  ruleset: combatRulesetSummary().version,
  arena: combatRulesetSummary().arena.version,
  A_leftBridge: strip(scenarioBridge("left")),
  A_leftBridgeP1: strip(scenarioBridge("left", 1)),
  B_rightBridge: strip(scenarioBridge("right")),
  C_blockedRiver: scenarioBlockedRiver(),
  D_airVsGround: scenarioAirVsGround(),
  E_rush: scenarioRush(),
  F_push: scenarioPush(),
  G_distraction: scenarioDistraction(),
  H_twoLanes: scenarioTwoLanes(),
  I_riftShift: scenarioRiftShift(),
  J_victories: scenarioVictories(),
  pocket: scenarioPocket(),
  K_replay: (() => {
    const r = scenarioReplay();
    const { a, b, ...counts } = r;
    void b;
    return { identical: r.hashA === r.hashB, winner: a.winner, reason: a.endReason, crowns: a.crowns, ticks: a.ticks, ...counts };
  })(),
};
console.log(JSON.stringify(out, null, 1));
