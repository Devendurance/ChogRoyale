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
import { accountXpAwards, accountXpRelease, accountXpRuns } from "@/db/schema";
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
): Promise<{ amount: number; result: "win" | "loss" | "draw"; policyVersion: number; createdAt: string | null } | null> {
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
 * Exactly-one PvP award with a transactional UTC-day cap. Per-player
 * advisory lock plus duplicate check plus cap check plus insert run in one
 * statement, so concurrent matches cannot exceed the cap and retries never
 * duplicate payouts.
 */
export async function stageAccountXpPvpAward(args: {
  matchId: string;
  playerId: string;
  amount: number;
  result: "win" | "loss" | "draw";
  policyVersion?: number;
}): Promise<{ status: "awarded" | "duplicate" | "capped"; rewardedToday: number }> {
  const db = getDb();
  const policyVersion = args.policyVersion ?? ACCOUNT_XP_POLICY_VERSION;
  const res = await db.execute(sql`
    with locks as materialized (
      select pg_advisory_xact_lock(hashtext('account-xp:' || ${args.playerId}::text)) as l
    ),
    prior as (
      select match_id from account_xp_awards, locks
      where player_id = ${args.playerId}::uuid and source = 'matchmaking' and match_id = ${args.matchId}
    ),
    used as (
      select count(*)::int as n from account_xp_awards, locks
      where player_id = ${args.playerId}::uuid
        and source = 'matchmaking'
        and created_at >= date_trunc('day', now() at time zone 'utc')
    ),
    ins as (
      insert into account_xp_awards (player_id, source, match_id, pvp_match_id, bot_match_id, result, amount, policy_version)
      select ${args.playerId}::uuid, 'matchmaking', ${args.matchId}, ${args.matchId}::uuid, null, ${args.result}, ${args.amount}, ${policyVersion}
      from locks
      where not exists (select 1 from prior)
        and (select n from used) < ${ACCOUNT_XP_PVP_DAILY_CAP}
      on conflict do nothing
      returning match_id
    )
    select (select match_id from prior) as prior_match, (select match_id from ins) as awarded, (select n from used) as used_before
  `);
  const row = (res.rows as Array<{ prior_match: string | null; awarded: string | null; used_before: number }>)[0]!;
  if (row.awarded) return { status: "awarded", rewardedToday: Number(row.used_before) + 1 };
  if (row.prior_match) return { status: "duplicate", rewardedToday: Number(row.used_before) };
  return { status: "capped", rewardedToday: Number(row.used_before) };
}

/**
 * Exactly-one bot award. No second Account XP cap: the shared bot Gold
 * allowance already gates eligibility (only Gold-confirmed matches reach
 * here, at most 5 per UTC day). Advisory lock plus duplicate guard keep
 * concurrent completions and retries to a single row.
 */
export async function stageAccountXpBotAward(args: {
  matchId: string;
  playerId: string;
  amount: number;
  result: "win" | "loss" | "draw";
  policyVersion?: number;
}): Promise<{ status: "awarded" | "duplicate"; rewardedToday: number }> {
  const db = getDb();
  const policyVersion = args.policyVersion ?? ACCOUNT_XP_POLICY_VERSION;
  const res = await db.execute(sql`
    with locks as materialized (
      select pg_advisory_xact_lock(hashtext('account-xp:' || ${args.playerId}::text)) as l
    ),
    prior as (
      select match_id from account_xp_awards, locks
      where player_id = ${args.playerId}::uuid and source = 'unranked-fallback' and match_id = ${args.matchId}
    ),
    ins as (
      insert into account_xp_awards (player_id, source, match_id, pvp_match_id, bot_match_id, result, amount, policy_version)
      select ${args.playerId}::uuid, 'unranked-fallback', ${args.matchId}, null, ${args.matchId}, ${args.result}, ${args.amount}, ${policyVersion}
      from locks
      where not exists (select 1 from prior)
      on conflict do nothing
      returning match_id
    )
    select (select match_id from prior) as prior_match, (select match_id from ins) as awarded
  `);
  const row = (res.rows as Array<{ prior_match: string | null; awarded: string | null }>)[0]!;
  if (row.awarded) return { status: "awarded", rewardedToday: 0 };
  return { status: "duplicate", rewardedToday: 0 };
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
