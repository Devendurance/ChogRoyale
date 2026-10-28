// P2b Gold economy persistence. Balances are derived (earned minus spent)
// so no cached balance can disagree with its ledgers; the earn path is a
// single idempotent insert and needs no apply step. The paid upgrade is one
// statement: per-player advisory lock, idempotency-key lookup, balance and
// precondition checks, exactly-one-level advance guarded by the expected
// level, then the spend row. Concurrent same-card upgrades serialize on the
// progress row (EPQ re-checks the expected level); concurrent same-player
// upgrades serialize on the advisory lock so two cards cannot jointly
// overdraw. Retries with the same key return the recorded spend.
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { goldEarnLedger, matchParticipants, matches } from "@/db/schema";
import { getBotGoldHistory } from "@/db/bot-gold";
import { ordinaryCardIds } from "@/db/card-xp";
import { CARD_XP_LEVEL_REQUIREMENTS, CARD_XP_MAX_LEVEL, goldCostForLevel } from "@/lib/card-xp";
import {
  GOLD_POLICY_VERSION,
  goldRewardForResult,
  type CardUpgradeRequest,
  type CardUpgradeResponse,
  type CardUpgradeStatus,
  type GoldBalanceResponse,
} from "@/lib/gold";

export const GOLD_ELIGIBLE_TYPES = ["matchmaking", "ranked"] as const;

export interface GoldEarnUnit {
  playerId: string;
  amount: number;
  result: "win" | "loss" | "draw";
}

/** Settled eligible match with per-seat results for Gold earn staging. */
export async function getGoldAwardableMatch(
  matchId: string
): Promise<{ ok: false; reason: string } | { ok: true; seats: [{ playerId: string; result: "win" | "loss" | "draw" }, { playerId: string; result: "win" | "loss" | "draw" }] }> {
  const db = getDb();
  const mrows = await db
    .select({ matchType: matches.matchType, verification: matches.verification })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const m = mrows[0];
  if (!m) return { ok: false, reason: "unknown-match" };
  if (!(GOLD_ELIGIBLE_TYPES as readonly string[]).includes(m.matchType)) return { ok: false, reason: `ineligible-type:${m.matchType}` };
  if (m.verification !== "replay-verified") return { ok: false, reason: `unverified:${m.verification}` };
  const parts = await db
    .select({ playerId: matchParticipants.playerId, result: matchParticipants.result })
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId));
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].playerId === parts[1].playerId) {
    return { ok: false, reason: "seats-not-distinct" };
  }
  for (const r of [parts[0].result, parts[1].result]) {
    if (r !== "win" && r !== "loss" && r !== "draw") return { ok: false, reason: `result:${r}` };
  }
  return {
    ok: true,
    seats: [
      { playerId: parts[0].playerId, result: parts[0].result as "win" | "loss" | "draw" },
      { playerId: parts[1].playerId, result: parts[1].result as "win" | "loss" | "draw" },
    ],
  };
}

export function goldEarnForResult(result: "win" | "loss" | "draw"): number {
  return goldRewardForResult(result);
}

/** Stage earn rows idempotently; returns how many were newly inserted. */
export async function stageGoldEarn(matchId: string, units: GoldEarnUnit[]): Promise<{ staged: number }> {
  if (units.length === 0) return { staged: 0 };
  const db = getDb();
  const res = await db
    .insert(goldEarnLedger)
    .values(units.map((u) => ({ matchId, playerId: u.playerId, amount: u.amount, result: u.result, policyVersion: GOLD_POLICY_VERSION })))
    .onConflictDoNothing({ target: [goldEarnLedger.matchId, goldEarnLedger.playerId] })
    .returning({ matchId: goldEarnLedger.matchId });
  return { staged: res.length };
}

/**
 * Matches whose earn ledger is incomplete (< 2 rows). No marker table:
 * every eligible match owes exactly two earn rows, so a short count is the
 * entire interrupted-or-never-processed set.
 */
export async function reconcileGoldEarn(limit: number = 50, award: (matchId: string) => Promise<{ status: string }>): Promise<{ processed: number; awarded: number }> {
  const db = getDb();
  const res = await db.execute(sql`
    select m.id as match_id
    from matches m
    left join gold_earn_ledger g on g.match_id = m.id
    where m.match_type in ('matchmaking', 'ranked')
      and m.verification = 'replay-verified'
    group by m.id, m.settled_at
    having count(g.*) < 2
    order by min(m.settled_at) asc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  const ids = (res.rows as Array<{ match_id: string }>).map((r) => String(r.match_id));
  let awarded = 0;
  for (const id of ids) {
    const r = await award(id);
    if (r.status === "awarded") awarded += 1;
  }
  return { processed: ids.length, awarded };
}

export async function getGoldTotals(playerId: string): Promise<{ earned: number; spent: number; balance: number }> {
  const db = getDb();
  const res = await db.execute(sql`
    select
      coalesce((select sum(amount) from gold_earn_ledger where player_id = ${playerId}::uuid), 0)::int
      + case when to_regclass('public.bot_gold_awards') is not null
        then coalesce((select sum(amount) from bot_gold_awards where player_id = ${playerId}::uuid), 0)::int
        else 0 end as earned,
      coalesce((select sum(cost) from gold_spend_ledger where player_id = ${playerId}::uuid), 0)::int as spent
  `);
  const row = (res.rows as Array<{ earned: number; spent: number }>)[0] ?? { earned: 0, spent: 0 };
  const earned = Number(row.earned);
  const spent = Number(row.spent);
  return { earned, spent, balance: earned - spent };
}

export async function getGoldBalance(playerId: string): Promise<GoldBalanceResponse> {
  const db = getDb();
  const [totals, earn, botEarn, spends] = await Promise.all([
    getGoldTotals(playerId),
    db.execute(sql`
      select g.match_id, g.result, g.amount, m.match_type, m.finished_at
      from gold_earn_ledger g join matches m on m.id = g.match_id
      where g.player_id = ${playerId}::uuid
      order by m.finished_at desc, g.match_id desc
      limit 10
    `),
    getBotGoldHistory(playerId, 10),
    db.execute(sql`
      select idempotency_key, card_id, from_level, to_level, cost, created_at
      from gold_spend_ledger
      where player_id = ${playerId}::uuid
      order by created_at desc
      limit 10
    `),
  ]);
  return {
    policyVersion: GOLD_POLICY_VERSION,
    balance: totals.balance,
    earned: totals.earned,
    spent: totals.spent,
    recentEarn: [
      ...(earn.rows as Array<Record<string, unknown>>).map((r) => ({
        matchId: String(r.match_id),
        matchType: String(r.match_type),
        result: r.result as "win" | "loss" | "draw",
        amount: Number(r.amount),
        finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
      })),
      ...botEarn.map((r) => ({
        matchId: r.matchId,
        matchType: "unranked-fallback",
        result: r.result,
        amount: r.amount,
        finishedAt: r.finishedAt,
      })),
    ]
      .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "") || (a.matchId < b.matchId ? -1 : 1))
      .slice(0, 10),
    recentSpends: (spends.rows as Array<Record<string, unknown>>).map((r) => ({
      idempotencyKey: String(r.idempotency_key),
      cardId: String(r.card_id),
      fromLevel: Number(r.from_level),
      toLevel: Number(r.to_level),
      cost: Number(r.cost),
      createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    })),
  };
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Paid single-level upgrade. Exactly one statement performs lock, replay
 * check, precondition checks, level advance and spend insert, so no
 * interleaving can double-charge, skip the ledger, or advance two levels.
 */
export async function upgradeCard(playerId: string, req: CardUpgradeRequest): Promise<CardUpgradeResponse> {
  if (!ordinaryCardIds().includes(req.cardId)) {
    return { status: "invalid-card", cardId: req.cardId, purchasedLevel: 1, goldCost: null, balance: (await getGoldTotals(playerId)).balance };
  }
  if (!Number.isInteger(req.expectedLevel) || req.expectedLevel < 1 || req.expectedLevel >= CARD_XP_MAX_LEVEL) {
    const db = getDb();
    const [totals, cur] = await Promise.all([
      getGoldTotals(playerId),
      db.execute(sql`select purchased_level from card_xp_progress where player_id = ${playerId}::uuid and card_id = ${req.cardId}`),
    ]);
    const purchasedLevel = Number((cur.rows as Array<{ purchased_level: number }>)[0]?.purchased_level ?? 1);
    return {
      status: req.expectedLevel >= CARD_XP_MAX_LEVEL ? "maxed" : "level-mismatch",
      cardId: req.cardId,
      purchasedLevel,
      goldCost: goldCostForLevel(purchasedLevel),
      balance: totals.balance,
    };
  }
  if (!UUID_RE.test(req.idempotencyKey)) {
    throw new Error("malformed idempotency key");
  }
  const cost = goldCostForLevel(req.expectedLevel)!;
  const xpReq = CARD_XP_LEVEL_REQUIREMENTS[req.expectedLevel]!;
  const db = getDb();
  const res = await db.execute(sql`
    with locks as materialized (
      select pg_advisory_xact_lock(hashtext('gold-upgrade:' || ${playerId}::text)) as l
    ),
    prior as (
      select idempotency_key, card_id, from_level, to_level, cost
      from gold_spend_ledger
      where idempotency_key = ${req.idempotencyKey}::uuid
    ),
    chk as (
      select
        ((select coalesce(sum(amount), 0) from gold_earn_ledger where player_id = ${playerId}::uuid)
          + case when to_regclass('public.bot_gold_awards') is not null
            then (select coalesce(sum(amount), 0) from bot_gold_awards where player_id = ${playerId}::uuid)
            else 0 end)
        - (select coalesce(sum(cost), 0) from gold_spend_ledger where player_id = ${playerId}::uuid) as balance,
        (select purchased_level from card_xp_progress where player_id = ${playerId}::uuid and card_id = ${req.cardId}) as cur_level,
        (select xp from card_xp_progress where player_id = ${playerId}::uuid and card_id = ${req.cardId}) as cur_xp
      from locks
      where not exists (select 1 from prior)
    ),
    gate as (
      select * from chk
      where coalesce(cur_level, 1) = ${req.expectedLevel}
        and coalesce(cur_xp, 0) >= ${xpReq}
        and balance >= ${cost}
    ),
    up as (
      update card_xp_progress p
      set purchased_level = ${req.expectedLevel} + 1, updated_at = now()
      from gate g
      where p.player_id = ${playerId}::uuid and p.card_id = ${req.cardId} and p.purchased_level = ${req.expectedLevel}
      returning p.player_id
    ),
    ins as (
      insert into gold_spend_ledger (idempotency_key, player_id, card_id, from_level, to_level, cost, policy_version)
      select ${req.idempotencyKey}::uuid, ${playerId}::uuid, ${req.cardId}, ${req.expectedLevel}, ${req.expectedLevel} + 1, ${cost}, ${GOLD_POLICY_VERSION}
      from up
      on conflict do nothing
      returning idempotency_key, card_id, from_level, to_level, cost
    )
    select
      (select row_to_json(prior) from prior) as prior,
      (select row_to_json(ins) from ins) as applied,
      (select row_to_json(chk) from chk) as chk
  `);
  const row = (res.rows as Array<{ prior: Record<string, unknown> | null; applied: Record<string, unknown> | null; chk: { balance: number; cur_level: number | null; cur_xp: number | null } | null }>)[0]!;
  const totals = await getGoldTotals(playerId);
  if (row.prior) {
    return {
      status: "duplicate",
      cardId: String(row.prior.card_id),
      purchasedLevel: Number(row.prior.to_level),
      goldCost: null,
      balance: totals.balance,
    };
  }
  if (row.applied) {
    return { status: "upgraded", cardId: req.cardId, purchasedLevel: req.expectedLevel + 1, goldCost: null, balance: totals.balance };
  }
  // No mutation happened. Map the observed state to a precise reason.
  const chk = row.chk;
  let status: CardUpgradeStatus = "conflict-retry";
  if (chk) {
    const curLevel = chk.cur_level ?? 1;
    if (curLevel !== req.expectedLevel) status = "level-mismatch";
    else if ((chk.cur_xp ?? 0) < xpReq) status = "insufficient-xp";
    else if (Number(chk.balance) < cost) status = "insufficient-gold";
  }
  const progress = await db.execute(sql`
    select purchased_level from card_xp_progress where player_id = ${playerId}::uuid and card_id = ${req.cardId}
  `);
  const purchasedLevel = Number((progress.rows as Array<{ purchased_level: number }>)[0]?.purchased_level ?? 1);
  return { status, cardId: req.cardId, purchasedLevel, goldCost: goldCostForLevel(purchasedLevel), balance: totals.balance };
}
