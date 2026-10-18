// B2.7c5 controlled balance calibration report (dev-only, DB-free).
// Run: npm run balance:calibrate -- <field|interaction|control> [candidate] [seedCount]
//   field <candidate>: smart/simple x Chaos off/on over the v13 deck field.

import { COMBAT_RULESET_VERSION } from "@/lib/combat";
import { BALANCE_CANDIDATES, controlComparison, fieldUnder, scoutInteraction } from "@/lib/balance-calibration";

const section = process.argv[2] ?? "field";
const candidate = process.argv[3] ?? "baseline";
const seeds = Array.from({ length: Number(process.argv[4] ?? 6) }, (_, i) => `c${i + 1}`);
const out: Record<string, unknown> = { ruleset: COMBAT_RULESET_VERSION, seeds };

if (section === "field") {
  out.candidate = { name: candidate, note: BALANCE_CANDIDATES[candidate]?.note };
  for (const policy of ["smart", "simple"] as const) for (const chaos of ["none", "rift"] as const) out[`${policy}-${chaos}`] = fieldUnder(candidate, policy, chaos, seeds);
}
if (section === "interaction") out.interaction = { smart: scoutInteraction("smart", seeds), simple: scoutInteraction("simple", seeds) };
if (section === "control") for (const policy of ["smart", "simple"] as const) for (const chaos of ["none", "rift"] as const) out[`${policy}-${chaos}`] = controlComparison(policy, chaos, seeds);

console.log(JSON.stringify(out));
