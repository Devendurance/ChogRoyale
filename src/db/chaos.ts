// Chaos Pulse persistence: versioned ruleset + immutable match schedules.
//
// One row per matchKey, referencing the match's patron assignment. A repeat
// call returns the stored row (idempotent re-derivation); a match can never
// hold two conflicting schedules. Raw server seeds are never stored, only
// their hashes. No combat execution happens here; B2 consumes the payloads.

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  chaosRulesets,
  pulseSchedules,
  patronAssignments,
  type PulseSchedule,
} from "@/db/schema";
import { getPatronAssignment } from "@/db/patrons";
import {
  CHAOS_RULESET_VERSION,
  deriveChaosSchedule,
  chaosRulesetSummary,
  type ChaosSchedule,
} from "@/lib/chaos";
import type { PatronConfig } from "@/lib/patrons";
import { AppError } from "@/lib/errors";

export function currentChaosRulesetVersion(): string {
  return CHAOS_RULESET_VERSION;
}

export async function ensureChaosRuleset() {
  const db = getDb();
  const rows = await db
    .insert(chaosRulesets)
    .values({ version: CHAOS_RULESET_VERSION, definition: chaosRulesetSummary() })
    .onConflictDoUpdate({
      target: [chaosRulesets.version],
      set: { definition: chaosRulesetSummary() },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Chaos ruleset upsert failed");
  return row;
}

export async function savePulseSchedule(input: {
  matchKey: string;
}): Promise<{ schedule: PulseSchedule; created: boolean }> {
  if (!input.matchKey || input.matchKey.trim().length === 0) {
    throw new AppError("BAD_REQUEST", "Pulse schedule requires a match key");
  }
  const db = getDb();
  const existing = await db
    .select()
    .from(pulseSchedules)
    .where(eq(pulseSchedules.matchKey, input.matchKey))
    .limit(1);
  if (existing[0]) return { schedule: existing[0], created: false };

  const assignment = await getPatronAssignment(input.matchKey);
  if (!assignment) {
    throw new AppError("NOT_FOUND", `No patron assignment for match ${input.matchKey}`);
  }
  const patron = assignment.patronConfig as PatronConfig;
  const derived: ChaosSchedule = deriveChaosSchedule({
    patron,
    serverSeed: assignment.serverSeed,
    matchKey: assignment.matchKey,
  });
  if (derived.patronConfigHash !== assignment.configHash) {
    throw new AppError("INTERNAL_ERROR", "Patron snapshot inconsistent with its assignment");
  }
  await ensureChaosRuleset();
  const rows = await db
    .insert(pulseSchedules)
    .values({
      matchKey: assignment.matchKey,
      chaosRulesetVersion: CHAOS_RULESET_VERSION,
      patronRulesetVersion: assignment.rulesetVersion,
      patronConfigHash: derived.patronConfigHash,
      serverSeedHash: derived.seedHash,
      schedule: derived,
      scheduleHash: derived.scheduleHash,
    })
    .onConflictDoNothing({ target: [pulseSchedules.matchKey] })
    .returning();
  const row = rows[0];
  if (row) return { schedule: row, created: true };
  const raced = await db
    .select()
    .from(pulseSchedules)
    .where(eq(pulseSchedules.matchKey, input.matchKey))
    .limit(1);
  const winner = raced[0];
  if (!winner) throw new Error("Pulse schedule insert failed");
  return { schedule: winner, created: false };
}

export async function getPulseSchedule(matchKey: string): Promise<PulseSchedule | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pulseSchedules)
    .where(eq(pulseSchedules.matchKey, matchKey))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPulseSchedulesByToken(tokenId: string | bigint): Promise<PulseSchedule[]> {
  const db = getDb();
  const tid = tokenId.toString();
  if (!/^[0-9]{1,78}$/.test(tid)) {
    throw new AppError("BAD_REQUEST", `Invalid patron token ID: ${tid}`);
  }
  const rows = await db
    .select({ schedule: pulseSchedules })
    .from(pulseSchedules)
    .innerJoin(patronAssignments, eq(patronAssignments.matchKey, pulseSchedules.matchKey))
    .where(eq(patronAssignments.tokenId, tid));
  return rows.map((r) => r.schedule);
}

export async function countPulseSchedules(): Promise<{ total: number; byRuleset: Record<string, number> }> {
  const db = getDb();
  const rows = (await db.execute(
    sql`select chaos_ruleset_version as v, count(*)::int as n from pulse_schedules group by chaos_ruleset_version`
  )) as unknown as { rows: Array<{ v: string; n: number }> };
  const byRuleset: Record<string, number> = {};
  let total = 0;
  for (const r of rows.rows) {
    byRuleset[r.v] = r.n;
    total += r.n;
  }
  return { total, byRuleset };
}
