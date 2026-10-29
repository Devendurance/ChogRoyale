// V2.1g Unranked AI fallback Gold persistence. One human plus one
// server-owned bot: bot matches have no matches/match_participants rows,
// so evidence and awards live in dedicated tables. Bot Gold is real
// spendable Gold: balance paths add approved bot sums to the PvP ledgers.
// Solo Practice never writes here; the room only calls in for fallback
// origin matches when the rewards flag is enabled.

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { botMatches } from "@/db/schema";
import {
  BOT_GOLD_DAILY_CAP,
  BOT_GOLD_POLICY_VERSION,
  botGoldForResult,
} from "@/lib/bot-gold";

export interface BotMatchEvidence {
  matchId: string;
  playerId: string;
  difficulty: "medium" | "hard";
  source: "unranked-fallback";
  policyVersion: number;
  config: unknown;
  commands: unknown;
  humanSeat: 0 | 1;
  liveHash: string;
  replayHash: string;
  replayIdentical: boolean;
  winnerSeat: 0 | 1 | null;
  ticks: number;
  humanDeploys: number;
  /** Activation marker: only matches recorded while the Card XP flag is
   * on may earn bot XP. Pre-flag historical rows stay permanently
   * ineligible and are never backfilled. */
  xpEligible: boolean;
  startedAt: string | null;
}

/** True when the bot Gold tables exist (TEST migrated; PROD only after 0023). */
export async function botGoldTablesPresent(): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(sql`select to_regclass('public.bot_gold_awards') as oid`);
  const row = (res.rows as Array<{ oid: string | null }>)[0];
  return !!row?.oid;
}

/** Total approved bot Gold for balance paths. Zero when tables are absent. */
export async function getBotGoldEarned(playerId: string): Promise<number> {
  const db = getDb();
  const res = await db.execute(sql`
    select case when to_regclass('public.bot_gold_awards') is not null
      then (select coalesce(sum(amount), 0)::int from bot_gold_awards where player_id = ${playerId}::uuid)
      else 0 end as earned
  `);
  return Number((res.rows as Array<{ earned: number }>)[0]?.earned ?? 0);
}

/** Bot earn history rows for the balance readback. Empty when tables are absent. */
export async function getBotGoldHistory(playerId: string, limit = 10): Promise<
  Array<{ matchId: string; result: "win" | "loss" | "draw"; amount: number; finishedAt: string | null }>
> {
  if (!(await botGoldTablesPresent())) return [];
  const db = getDb();
  const res = await db.execute(sql`
    select g.match_id, g.result, g.amount, b.finished_at
    from bot_gold_awards g join bot_matches b on b.match_id = g.match_id
    where g.player_id = ${playerId}::uuid
    order by b.finished_at desc, g.match_id desc
    limit ${Math.min(Math.max(limit, 1), 50)}
  `);
  return (res.rows as Array<{ match_id: string; result: "win" | "loss" | "draw"; amount: number; finished_at: string | null }>).map((r) => ({
    matchId: String(r.match_id),
    result: r.result,
    amount: Number(r.amount),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  }));
}

/** Idempotent evidence insert. Returns true when this call stored it. */
export async function recordBotMatchEvidence(ev: BotMatchEvidence): Promise<{ stored: boolean }> {
  const db = getDb();
  const res = await db
    .insert(botMatches)
    .values({
      matchId: ev.matchId,
      playerId: ev.playerId,
      difficulty: ev.difficulty,
      source: ev.source,
      policyVersion: ev.policyVersion,
      config: ev.config as never,
      commands: ev.commands as never,
      humanSeat: ev.humanSeat,
      liveHash: ev.liveHash,
      replayHash: ev.replayHash,
      replayIdentical: ev.replayIdentical,
      winnerSeat: ev.winnerSeat,
      ticks: ev.ticks,
      humanDeploys: ev.humanDeploys,
      startedAt: ev.startedAt ? new Date(ev.startedAt) : null,
      xpEligible: ev.xpEligible,
    })
    .onConflictDoNothing({ target: [botMatches.matchId] })
    .returning({ matchId: botMatches.matchId });
  return { stored: res.length > 0 };
}

export async function getBotMatchEvidence(matchId: string) {
  const db = getDb();
  const rows = await db.select().from(botMatches).where(eq(botMatches.matchId, matchId)).limit(1);
  return rows[0] ?? null;
}

export async function markBotMatchStatus(matchId: string, status: "pending" | "awarded" | "refused" | "capped"): Promise<void> {
  const db = getDb();
  await db.update(botMatches).set({ status }).where(eq(botMatches.matchId, matchId));
}

/**
 * Exactly-one atomic award with a transactional UTC-day cap. One statement
 * performs the per-player advisory lock, duplicate check, cap check and
 * insert, so concurrent matches cannot exceed the cap and retries never
 * duplicate payouts. Restarts are safe: the evidence row persists and the
 * PK makes reprocessing idempotent.
 */
export async function stageBotGoldAward(args: {
  matchId: string;
  playerId: string;
  amount: number;
  result: "win" | "loss" | "draw";
  difficulty: "medium" | "hard";
  policyVersion: number;
}): Promise<{ status: "awarded" | "duplicate" | "capped"; rewardedToday: number }> {
  const db = getDb();
  const res = await db.execute(sql`
    with locks as materialized (
      select pg_advisory_xact_lock(hashtext('bot-gold:' || ${args.playerId}::text)) as l
    ),
    prior as (
      select match_id from bot_gold_awards
      where match_id = ${args.matchId} and player_id = ${args.playerId}::uuid
    ),
    used as (
      select count(*)::int as n from bot_gold_awards, locks
      where player_id = ${args.playerId}::uuid
        and awarded_at >= date_trunc('day', now() at time zone 'utc')
    ),
    ins as (
      insert into bot_gold_awards (match_id, player_id, amount, result, difficulty, policy_version)
      select ${args.matchId}, ${args.playerId}::uuid, ${args.amount}, ${args.result}, ${args.difficulty}, ${args.policyVersion}
      from locks
      where not exists (select 1 from prior)
        and (select n from used) < ${BOT_GOLD_DAILY_CAP}
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

/** Bot matches rewarded to this player today (UTC). */
export async function countBotGoldToday(playerId: string): Promise<number> {
  const db = getDb();
  const res = await db.execute(sql`
    select case when to_regclass('public.bot_gold_awards') is not null
      then (select count(*)::int from bot_gold_awards
        where player_id = ${playerId}::uuid
          and awarded_at >= date_trunc('day', now() at time zone 'utc'))
      else 0 end as n
  `);
  return Number((res.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

/** Pending evidence rows for reconcile/recovery, oldest first. */
export async function pendingBotMatches(limit = 50): Promise<Array<{ matchId: string }>> {
  const db = getDb();
  const res = await db.execute(sql`
    select match_id from bot_matches
    where status = 'pending'
    order by finished_at asc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  return (res.rows as Array<{ match_id: string }>).map((r) => ({ matchId: String(r.match_id) }));
}

export { BOT_GOLD_POLICY_VERSION, BOT_GOLD_DAILY_CAP, botGoldForResult };
