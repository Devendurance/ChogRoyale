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
import * as B from "@/lib/building-scenarios";
import * as S from "@/lib/spell-scenarios";
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
  // B2.7a building evidence.
  buildings: {
    A_sentryDefense: B.sentryDefense(),
    BCD_totemDistraction: B.totemDistraction(),
    E_airVsSentry: B.airVsSentry(),
    F_mirroredLanes: B.mirroredLanes(),
    G_placementValue: B.placementValue(),
    H_expiry: B.expiry(),
    bridgeClearance: B.bridgeClearance(),
    IJK_fullMatch: B.buildingMatch(),
  },
  // B2.7b tactical-card evidence.
  tactical: {
    A_cometTroops: S.cometTroops(),
    B_cometBuilding: S.cometBuilding(),
    C_cometStructures: S.cometStructures(),
    D_cometSuddenDeath: (({ commands, cfg, ...r }) => (void commands, void cfg, r))(S.cometSuddenDeath()),
    E_snareSlow: S.snareSlow(),
    F_airGround: S.airGroundRules(),
    GH_cheapDefense: S.cheapDefense(),
    G_spritesSoak: S.spritesSoak(),
    I_buildingSpellCounter: S.buildingSpellCounter(),
    J_oppositeLane: S.oppositeLane(),
    KL_fullMatch: S.tacticalMatch(),
  },
};
console.log(JSON.stringify(out, null, 1));
