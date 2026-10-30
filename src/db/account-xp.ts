// V2.2a Player Account XP persistence. The awards ledger is authoritative
// and additive: one row per (player, source, match). PvP rows reference
// matches, bot rows reference bot_matches; exactly one FK is set per row so
// no fake PvP rows exist for AI fallback. Totals and levels derive from the
// ledger sum. Runs markers make awarding idempotent across retries,
// restarts and concurrent completions. Solo Practice, private, ranked,
// aborted and unverified matches never write here; callers enforce that.
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accountXpAwardClaims, accountXpAwards, accountXpHeads, accountXpRelease, accountXpRuns } from "@/db/schema";
import { ACCOUNT_XP_POLICY_VERSION, ACCOUNT_XP_PVP_DAILY_CAP } from "@/lib/account-xp";

/** True when the Account XP tables exist (TEST migrated; PROD only after 0026). */
export async function accountXpTablesPresent(): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(sql`select to_regclass('public.account_xp_awards') as oid`);
  const row = (res.rows as Array<{ oid: string | null }>)[0];
  return !!row?.oid;
}

/**
 * Durable release activation boundary. Inserts the singleton row once;
 * restarts and repeats never move it. Returns the activation instant.
 */
export async function ensureAccountXpRelease(): Promise<{ activatedAt: Date; fresh: boolean }> {
  const db = getDb();
  const res = await db
    .insert(accountXpRelease)
    .values({ id: 1 })
    .onConflictDoNothing({ target: [accountXpRelease.id] })
    .returning({ activatedAt: accountXpRelease.activatedAt });
  if (res.length > 0) return { activatedAt: res[0]!.activatedAt, fresh: true };
  const existing = await getAccountXpRelease();
  return { activatedAt: existing?.activatedAt ?? new Date(), fresh: false };
}

export async function getAccountXpRelease(): Promise<{ activatedAt: Date } | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(accountXpRelease).where(eq(accountXpRelease.id, 1)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { activatedAt: row.activatedAt };
  } catch {
    return null;
  }
}

/** Lifetime Account XP total derived from the ledger. Zero when absent. */
export async function getAccountXpTotal(playerId: string): Promise<number> {
  if (!(await accountXpTablesPresent())) return 0;
  const db = getDb();
  const res = await db.execute(sql`
    select coalesce(sum(amount), 0)::int as total from account_xp_awards
    where player_id = ${playerId}::uuid
  `);
  return Number((res.rows as Array<{ total: number }>)[0]?.total ?? 0);
}

export interface AccountXpAwardView {
  matchId: string;
  source: "matchmaking" | "unranked-fallback";
  result: "win" | "loss" | "draw";
  amount: number;
  policyVersion: number;
  createdAt: string | null;
}

/** Single award row for one player's match, null when not awarded. */
export async function getAccountXpAward(
  playerId: string,
  source: "matchmaking" | "unranked-fallback",
  matchId: string
): Promise<{ amount: number; result: "win" | "loss" | "draw"; policyVersion: number; createdAt: string | null; xpBefore: number | null; xpAfter: number | null } | null> {
  if (!(await accountXpTablesPresent())) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(accountXpAwards)
    .where(and(eq(accountXpAwards.playerId, playerId), eq(accountXpAwards.source, source), eq(accountXpAwards.matchId, matchId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    amount: Number(row.amount),
    result: row.result as "win" | "loss" | "draw",
    policyVersion: Number(row.policyVersion),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    xpBefore: row.xpBefore === null ? null : Number(row.xpBefore),
    xpAfter: row.xpAfter === null ? null : Number(row.xpAfter),
  };
}

/** Recent Account XP awards for one player, newest first. */
export async function getAccountXpAwards(playerId: string, limit = 10): Promise<AccountXpAwardView[]> {
  if (!(await accountXpTablesPresent())) return [];
  const db = getDb();
  const res = await db.execute(sql`
    select match_id, source, result, amount, policy_version, created_at
    from account_xp_awards
    where player_id = ${playerId}::uuid
    order by created_at desc, match_id desc
    limit ${Math.min(Math.max(limit, 1), 50)}
  `);
  return (res.rows as Array<{ match_id: string; source: string; result: string; amount: number; policy_version: number; created_at: string | null }>).map(
    (r) => ({
      matchId: String(r.match_id),
      source: r.source as AccountXpAwardView["source"],
      result: r.result as AccountXpAwardView["result"],
      amount: Number(r.amount),
      policyVersion: Number(r.policy_version),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    })
  );
}

/** PvP Account XP awards to this player today (UTC). Zero when absent. */
export async function countAccountXpPvpToday(playerId: string): Promise<number> {
  if (!(await accountXpTablesPresent())) return 0;
  const db = getDb();
  const res = await db.execute(sql`
    select count(*)::int as n from account_xp_awards
    where player_id = ${playerId}::uuid
      and source = 'matchmaking'
      and created_at >= date_trunc('day', now() at time zone 'utc')
  `);
  return Number((res.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

/**
 * Exactly-one award with durable award-time snapshots, in ONE statement.
 *
 * Neon HTTP has no interactive transactions, and a statement snapshot is
 * fixed before advisory locks serialize, so the old lock + count + insert
 * pattern could exceed the daily cap under concurrency (proven 21/20).
 *
 * This statement instead chains exact signals only:
 * - `bl` (bump-log claim): the PK conflict is exact even under concurrency
 *   (the loser waits out the winner via speculative insertion, then sees
 *   the conflict), so only one processor per (player, source, match)
 *   proceeds. No advisory locks, no cross-statement state.
 * - `cnt` (PvP only): the daily counter UPDATE re-checks `n < cap` on the
 *   newest row version after waiting on the row lock, so the cap is exact.
 * - `h0`/`bump`: the per-player heads row serializes concurrent awards;
 *   the UPDATE operates on the newest committed total, so `before`/`after`
 *   snapshots are exact and chain without gaps or overlaps.
 * - `ins`: the award PK dedupes; snapshots ride in from the bump pipe.
 *
 * Lock order is identical on every path (bump-log, then counter, then
 * heads, then award), rows of different players never interact, and all
 * waits resolve by commit/abort, so there are no deadlocks. Either the
 * whole statement commits or nothing does: no lost awards, no doubles,
 * no counter/head drift. Concurrent losers re-read the winner's committed
 * row in a fresh statement.
 */
async function stageAccountXpAwardAtomic(args: {
  playerId: string;
  source: "matchmaking" | "unranked-fallback";
  matchId: string;
  pvpMatchId: string | null;
  botMatchId: string | null;
  amount: number;
  result: "win" | "loss" | "draw";
  policyVersion: number;
  /** PvP daily cap, or null for bot awards (Gold allowance gates those). */
  cap: number | null;
}): Promise<
  | { fresh: true; xpBefore: number; xpAfter: number }
  | { fresh: false }
> {
  const db = getDb();
  const capGate = args.cap === null ? sql`` : sql`AND EXISTS (SELECT 1 FROM cnt)`;
  const cntCte =
    args.cap === null
      ? sql``
      : sql`,
    cnt AS (
      INSERT INTO account_xp_daily_counts(player_id, day, n)
      SELECT ${args.playerId}::uuid, (now() AT TIME ZONE 'utc')::date, 1
      WHERE EXISTS (SELECT 1 FROM bl)
      ON CONFLICT (player_id, day) DO UPDATE SET n = account_xp_daily_counts.n + 1
      WHERE account_xp_daily_counts.n < ${args.cap}
      RETURNING n
    )`;
  const res = await db.execute(sql`
    WITH bl AS (
      INSERT INTO account_xp_award_claims(player_id, source, match_id)
      VALUES (${args.playerId}::uuid, ${args.source}, ${args.matchId})
      ON CONFLICT DO NOTHING
      RETURNING 1
    )${cntCte},
    h0 AS (
      INSERT INTO account_xp_heads(player_id, total_xp)
      SELECT ${args.playerId}::uuid, ${args.amount}
      WHERE EXISTS (SELECT 1 FROM bl) ${capGate}
      ON CONFLICT DO NOTHING
      RETURNING total_xp
    ),
    bump AS (
      UPDATE account_xp_heads SET total_xp = account_xp_heads.total_xp + ${args.amount}
      WHERE player_id = ${args.playerId}::uuid
        AND EXISTS (SELECT 1 FROM bl) ${capGate}
        AND NOT EXISTS (SELECT 1 FROM h0)
      RETURNING total_xp - ${args.amount} AS b, total_xp AS a
    ),
    snap AS (
      SELECT 0 AS b, total_xp AS a FROM h0
      UNION ALL SELECT b, a FROM bump
    ),
    ins AS (
      INSERT INTO account_xp_awards(player_id, source, match_id, pvp_match_id, bot_match_id, result, amount, policy_version, xp_before, xp_after)
      SELECT ${args.playerId}::uuid, ${args.source}, ${args.matchId}, ${args.pvpMatchId}, ${args.botMatchId}, ${args.result}, ${args.amount}, ${args.policyVersion}, s.b, s.a FROM snap s
      ON CONFLICT DO NOTHING
      RETURNING xp_before, xp_after
    )
    SELECT xp_before, xp_after FROM ins
  `);
  const row = (res.rows as Array<{ xp_before: number; xp_after: number }>)[0];
  if (!row) return { fresh: false };
  return { fresh: true, xpBefore: Number(row.xp_before), xpAfter: Number(row.xp_after) };
}

/** Fresh award row when the atomic attempt lost a same-match race. */
async function readFreshAward(args: { playerId: string; source: "matchmaking" | "unranked-fallback"; matchId: string }) {
  return getAccountXpAward(args.playerId, args.source, args.matchId);
}

/** Ensures the per-player heads row exists before the atomic award runs.
 * A plain idempotent insert in a separate committed statement: concurrent
 * callers collapse onto one row, and every later statement snapshot sees
 * it. This removes the only snapshot-visibility hazard in S1 (bump
 * updating a row created after its snapshot began): with the row
 * pre-existing, the bump UPDATE always finds a visible version or waits
 * on an in-flight updater, then re-checks on the newest committed total.
 * A zero-total row with no awards keeps heads == ledger sum either way. */
async function ensureAccountXpHead(playerId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(accountXpHeads)
    .values({ playerId, totalXp: 0 })
    .onConflictDoNothing({ target: [accountXpHeads.playerId] });
}

/** Deletes a claim row that provably owns no award and no live processor.
 * Called only after S1 returned empty AND a fresh award read found nothing:
 * S1's speculative wait guarantees every conflicting transaction resolved
 * before S1 returned, so no live owner can exist and the row is garbage
 * (planted fixture, aborted-winner residue, or a previous capped attempt
 * on a day with capacity again). Bounded callers only; both deletes and
 * retries are idempotent. */
async function deleteStaleClaim(args: { playerId: string; source: "matchmaking" | "unranked-fallback"; matchId: string }): Promise<void> {
  const db = getDb();
  await db
    .delete(accountXpAwardClaims)
    .where(
      and(
        eq(accountXpAwardClaims.playerId, args.playerId),
        eq(accountXpAwardClaims.source, args.source),
        eq(accountXpAwardClaims.matchId, args.matchId)
      )
    );
}

/** PvP daily counter for one player today (UTC), used only to tell a real
 * cap refusal apart from a transient loser-of-a-race. */
async function pvpDailyCount(playerId: string): Promise<number> {
  const db = getDb();
  const res = await db.execute(sql`
    select n from account_xp_daily_counts
    where player_id = ${playerId}::uuid and day = (now() AT TIME ZONE 'utc')::date
  `);
  return Number((res.rows as Array<{ n: number }>)[0]?.n ?? 0);
}
export async function stageAccountXpPvpAward(args: {
  matchId: string;
  playerId: string;
  amount: number;
  result: "win" | "loss" | "draw";
  policyVersion?: number;
}): Promise<{ status: "awarded" | "duplicate" | "capped" | "contended"; rewardedToday: number }> {
  const policyVersion = args.policyVersion ?? ACCOUNT_XP_POLICY_VERSION;
  // The heads row must exist before S1 runs: with it committed, S1's bump
  // UPDATE always finds a visible row version (or waits on a live updater
  // and re-checks the newest total), so a concurrent first award cannot
  // slip past into an awardless claim.
  await ensureAccountXpHead(args.playerId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const s1 = await stageAccountXpAwardAtomic({
      playerId: args.playerId,
      source: "matchmaking",
      matchId: args.matchId,
      pvpMatchId: args.matchId,
      botMatchId: null,
      amount: args.amount,
      result: args.result,
      policyVersion,
      cap: ACCOUNT_XP_PVP_DAILY_CAP,
    });
    if (s1.fresh) return { status: "awarded", rewardedToday: await countAccountXpPvpToday(args.playerId) };
    const row = await readFreshAward({ playerId: args.playerId, source: "matchmaking", matchId: args.matchId });
    // A present award row is the only proof of a duplicate. Never classify
    // a missing row as a confirmed duplicate: that would mark the run done
    // and lose the award forever.
    if (row) return { status: "duplicate", rewardedToday: await countAccountXpPvpToday(args.playerId) };
    // No award committed: a real cap refusal is terminal. Otherwise the
    // claim row is provably ownerless (S1's speculative wait resolved every
    // conflicting transaction before S1 returned), so remove it and retry
    // once rather than stranding it.
    if ((await pvpDailyCount(args.playerId)) >= ACCOUNT_XP_PVP_DAILY_CAP) {
      return { status: "capped", rewardedToday: await countAccountXpPvpToday(args.playerId) };
    }
    await deleteStaleClaim({ playerId: args.playerId, source: "matchmaking", matchId: args.matchId });
  }
  // Still unresolved after a bounded retry: stay pending so reconciliation
  // (which re-runs this same idempotent path) finishes the work. Never
  // report a duplicate without a verified award row.
  await claimAccountXpRun(args.playerId, "matchmaking", args.matchId, { reason: "contended" });
  return { status: "contended", rewardedToday: await countAccountXpPvpToday(args.playerId) };
}

/**
 * Exactly-one bot award. No second Account XP cap: the shared bot Gold
 * allowance already gates eligibility (only Gold-confirmed matches reach
 * here, at most 5 per UTC day). The atomic core keeps concurrent
 * completions and retries to a single row with exact stored snapshots.
 */
export async function stageAccountXpBotAward(args: {
  matchId: string;
  playerId: string;
  amount: number;
  result: "win" | "loss" | "draw";
  policyVersion?: number;
}): Promise<{ status: "awarded" | "duplicate" | "contended"; rewardedToday: number }> {
  const policyVersion = args.policyVersion ?? ACCOUNT_XP_POLICY_VERSION;
  await ensureAccountXpHead(args.playerId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const s1 = await stageAccountXpAwardAtomic({
      playerId: args.playerId,
      source: "unranked-fallback",
      matchId: args.matchId,
      pvpMatchId: null,
      botMatchId: args.matchId,
      amount: args.amount,
      result: args.result,
      policyVersion,
      cap: null,
    });
    if (s1.fresh) return { status: "awarded", rewardedToday: 0 };
    const row = await readFreshAward({ playerId: args.playerId, source: "unranked-fallback", matchId: args.matchId });
    if (row) return { status: "duplicate", rewardedToday: 0 };
    await deleteStaleClaim({ playerId: args.playerId, source: "unranked-fallback", matchId: args.matchId });
  }
  await claimAccountXpRun(args.playerId, "unranked-fallback", args.matchId, { reason: "contended" });
  return { status: "contended", rewardedToday: 0 };
}

/** Claim (or re-claim) a per-player processing marker. True when fresh. */
export async function claimAccountXpRun(
  playerId: string,
  source: "matchmaking" | "unranked-fallback",
  matchId: string,
  details: Record<string, unknown> = {}
): Promise<{ fresh: boolean }> {
  const db = getDb();
  const res = await db
    .insert(accountXpRuns)
    .values({ playerId, source, matchId, status: "pending", details })
    .onConflictDoNothing({ target: [accountXpRuns.playerId, accountXpRuns.source, accountXpRuns.matchId] })
    .returning({ matchId: accountXpRuns.matchId });
  return { fresh: res.length > 0 };
}

export async function getAccountXpRun(playerId: string, source: "matchmaking" | "unranked-fallback", matchId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(accountXpRuns)
    .where(and(eq(accountXpRuns.playerId, playerId), eq(accountXpRuns.source, source), eq(accountXpRuns.matchId, matchId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function markAccountXpRun(
  playerId: string,
  source: "matchmaking" | "unranked-fallback",
  matchId: string,
  status: "done" | "refused" | "capped",
  awardsCreated: number,
  details: Record<string, unknown> = {}
): Promise<void> {
  const db = getDb();
  await db
    .update(accountXpRuns)
    .set({ status, awardsCreated, details })
    .where(and(eq(accountXpRuns.playerId, playerId), eq(accountXpRuns.source, source), eq(accountXpRuns.matchId, matchId)));
}

/** Pending Account XP work for reconcile/recovery, oldest first. */
export async function pendingAccountXpRuns(limit = 50): Promise<Array<{ playerId: string; source: "matchmaking" | "unranked-fallback"; matchId: string }>> {
  const db = getDb();
  const res = await db.execute(sql`
    select player_id, source, match_id from account_xp_runs
    where status = 'pending'
    order by created_at asc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  return (res.rows as Array<{ player_id: string; source: string; match_id: string }>).map((r) => ({
    playerId: String(r.player_id),
    source: r.source as "matchmaking" | "unranked-fallback",
    matchId: String(r.match_id),
  }));
}

export { ACCOUNT_XP_POLICY_VERSION, ACCOUNT_XP_PVP_DAILY_CAP };
