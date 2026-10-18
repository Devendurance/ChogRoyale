// B2.6a/B2.6b commander balance evidence (development harness only). Real engine
// encounters driven by legal commands; DB-free. Usage: npm run commanders:balance
import { CLASSES, soloSiege, defended, supportedPush, cyclingMatch, roundRobin } from "@/lib/commander-balance";
import { COMMANDER_COMBAT_PROFILE_V1, combatRulesetSummary } from "@/lib/combat";
import { CLASS_ROSTER } from "@/lib/commanders";

const before = Object.fromEntries(CLASSES.map((c) => [c, CLASS_ROSTER[c].baseStats]));
const counters = [["chog_guardian"], ["chaos_archer"], ["choglings"], ["hexwing"], ["boulderback"]];
const rr = roundRobin(["rr-1", "rr-2", "rr-3", "rr-4"]);
console.log(
  JSON.stringify(
    {
      ruleset: combatRulesetSummary().version,
      profile: { before_B1: before, after_runtime: COMMANDER_COMBAT_PROFILE_V1 },
      A_soloSiege: CLASSES.map((c) => soloSiege(c)),
      C_counters: CLASSES.map((c) =>
        counters.map((d) => {
          const r = defended(c, d);
          return `${c} vs ${r.defense}(${r.defenseCost}e): killed=${r.commanderKilled}@${r.killTick} losses=${r.defenderLosses}/${r.defenderUnits} towerL=${r.towerL}`;
        })
      ),
      D_supportedPush: CLASSES.map((c) => {
        const r = supportedPush(c);
        return { cls: c, alone: { towerL: r.alone.towerL, core: r.alone.core, destroyed: r.alone.destroyed }, supported: { towerL: r.supported.towerL, core: r.supported.core, destroyed: r.supported.destroyed } };
      }),
      E_roundRobin: { wins: rr.wins, games: rr.games, avgTicks: rr.avgTicks, activations: rr.activations },
      G_cycling: [cyclingMatch("warden", "reaver", "cycle-a"), cyclingMatch("deadeye", "scout", "cycle-b"), cyclingMatch("bulwark", "warden", "cycle-c")].map(({ steppedHash, ...r }) => ({ ...r, steppedEqualsReplay: steppedHash === r.result.stateHash })),
    },
    null,
    1
  )
);
