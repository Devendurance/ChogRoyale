// P2a card XP persistence. Awards flow over settled replay-verified
// matchmaking/ranked rows only; private rooms never award (farming gate).
// The ledger is authoritative and recompute-based: progress.xp always
// equals the sum of its ledger rows, and the level is re-derived from the
// single policy ladder on every apply, so XP and level can never disagree
// and concurrent applies converge instead of losing updates.
import { asc, inArray, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cardXpAwards, cardXpProgress, cardXpRuns, matchEvidence, matchParticipants, matches } from "@/db/schema";
import { CARDS_V1 } from "@/lib/combat";
import {
  CARD_XP_LEVEL_REQUIREMENTS,
  CARD_XP_MAX_LEVEL,
  CARD_XP_POLICY_VERSION,
  cardLevelForXp,
  goldCostForLevel,
  type CardXpEntry,
} from "@/lib/card-xp";

export const CARD_XP_ELIGIBLE_TYPES = ["matchmaking", "ranked"] as const;

/**
 * Seat-ordered participant mapping. Replay commands address seats
 * (players[cmd.player]), so the two participant rows must resolve to
 * exactly seat 0 and seat 1 in that order. Database row order is
 * unspecified, and an unordered mapping silently reverses XP ownership.
 * Pure: unit-tested without a database.
 */
export function seatOrderedPlayers(
  rows: Array<{ seat: number; playerId: string }>
): { ok: true; players: [{ playerId: string }, { playerId: string }] } | { ok: false; reason: string } {
  if (rows.length !== 2) return { ok: false, reason: "seats-count" };
  const bySeat = [...rows].sort((a, b) => a.seat - b.seat);
  const [s0, s1] = bySeat;
  if (!s0 || !s1 || s0.seat !== 0 || s1.seat !== 1) return { ok: false, reason: "seats-invalid" };
  if (s0.playerId === s1.playerId) return { ok: false, reason: "seats-not-distinct" };
  return { ok: true, players: [{ playerId: s0.playerId }, { playerId: s1.playerId }] };
}

export interface CardUsageUnit {
  playerId: string;
  cardId: string;
  deployments: number;
  xp: number;
}

/** Canonical ordinary card ids: the 20 deckable non-commander cards. */
export function ordinaryCardIds(): string[] {
  return Object.keys(CARDS_V1).sort();
}

interface SettledMatch {
  matchId: string;
  matchType: string;
  verification: string;
  players: [{ playerId: string }, { playerId: string }];
  evidence: { formatVersion: number; config: unknown; commands: unknown };
}

export async function getAwardableMatch(matchId: string): Promise<
  { ok: false; reason: string } | { ok: true; match: SettledMatch }
> {
  const db = getDb();
  const mrows = await db
    .select({ matchType: matches.matchType, verification: matches.verification })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const m = mrows[0];
  if (!m) return { ok: false, reason: "unknown-match" };
  if (!(CARD_XP_ELIGIBLE_TYPES as readonly string[]).includes(m.matchType)) {
    return { ok: false, reason: `ineligible-type:${m.matchType}` };
  }
  if (m.verification !== "replay-verified") return { ok: false, reason: `unverified:${m.verification}` };
  const parts = await db
    .select({ seat: matchParticipants.seat, playerId: matchParticipants.playerId })
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(asc(matchParticipants.seat));
  const ordered = seatOrderedPlayers(parts);
  if (!ordered.ok) return { ok: false, reason: ordered.reason };
  const ev = await db.select({ evidence: matchEvidence.evidence }).from(matchEvidence).where(eq(matchEvidence.matchId, matchId)).limit(1);
  const stored = ev[0]?.evidence as SettledMatch["evidence"] | undefined;
  if (!stored || !Array.isArray(stored.commands) || typeof stored.config !== "object" || stored.config === null) {
    return { ok: false, reason: "evidence-missing" };
  }
  return { ok: true, match: { matchId, matchType: m.matchType, verification: m.verification, players: ordered.players, evidence: stored } };
}

/**
 * Stage ledger rows plus the run marker, idempotently. Returns true when
 * this call staged the marker (fresh work), false when already staged.
 */
export async function stageCardXp(matchId: string, usage: CardUsageUnit[], status: "done" | "no-eligible", details: Record<string, unknown> = {}): Promise<{ fresh: boolean; units: number }> {
  const db = getDb();
  if (usage.length > 0) {
    await db
      .insert(cardXpAwards)
      .values(usage.map((u) => ({ matchId, playerId: u.playerId, cardId: u.cardId, deployments: u.deployments, xp: u.xp, policyVersion: CARD_XP_POLICY_VERSION })))
      .onConflictDoNothing({ target: [cardXpAwards.matchId, cardXpAwards.playerId, cardXpAwards.cardId] });
  }
  const marker = await db
    .insert(cardXpRuns)
    .values({ matchId, status, applied: false, awardsCreated: usage.length, details })
    .onConflictDoNothing({ target: [cardXpRuns.matchId] })
    .returning({ matchId: cardXpRuns.matchId });
  return { fresh: marker.length > 0, units: usage.length };
}

/**
 * Apply one staged (or interrupted) run: recompute every affected
 * (player, card) total from the full ledger, upsert progress with the
 * policy level ladder, stamp the marker. Single statement, re-runnable:
 * only applied=false markers move. Absolute-set upserts recompute from
 * the whole ledger, so concurrent applies converge instead of
 * double-counting (no row locks needed: re-running can only rewrite the
 * same totals, and every run re-derives from all committed ledger rows).
 */
/**
 * Canonical XP recompute shared by the PvP and bot award paths: absolute
 * per-(player, card) totals from BOTH the PvP ledger and the bot ledger,
 * upserted in one statement. Every apply re-derives from all committed
 * ledger rows, so concurrent PvP and bot applies converge instead of
 * double-counting or losing XP, and retries can only rewrite identical
 * totals. Missing bot tables (pre-0025 schema) degrade to PvP-only totals.
 * Progress levels follow the single policy ladder; purchased levels are
 * never touched here.
 */
export async function applyCardXpTotals(pairs: Array<{ playerId: string; cardId: string }>): Promise<{ units: number }> {
  if (pairs.length === 0) return { units: 0 };
  const db = getDb();
  const t = CARD_XP_LEVEL_REQUIREMENTS;
  // Keep the existing PvP ledger usable before the bot XP migration lands.
  // PostgreSQL resolves table names while parsing, so a CASE around a
  // missing bot table would still fail. Only include the bot subquery after
  // the relation has been confirmed present.
  const botTable = await db.execute(sql`select to_regclass('public.bot_card_xp_awards') as table_name`);
  const hasBotAwards = Boolean((botTable.rows as Array<{ table_name: string | null }>)[0]?.table_name);
  const res = await db.execute(sql`
    with affected(player_id, card_id) as (
      values ${sql.join(pairs.map((p) => sql`(${p.playerId}::uuid, ${p.cardId})`), sql`, `)}
    ),
    totals as (
      select v.player_id, v.card_id,
        coalesce((select sum(a.xp) from card_xp_awards a where a.player_id = v.player_id and a.card_id = v.card_id), 0)::int
        ${hasBotAwards ? sql`+ coalesce((select sum(b.xp) from bot_card_xp_awards b where b.player_id = v.player_id and b.card_id = v.card_id), 0)::int` : sql``} as xp
      from affected v
      group by v.player_id, v.card_id
    ),
    computed as (
      select
        t.player_id, t.card_id, t.xp,
        (1
          + (t.xp >= ${t[1]}::int)::int + (t.xp >= ${t[2]}::int)::int + (t.xp >= ${t[3]}::int)::int
          + (t.xp >= ${t[4]}::int)::int + (t.xp >= ${t[5]}::int)::int + (t.xp >= ${t[6]}::int)::int
          + (t.xp >= ${t[7]}::int)::int + (t.xp >= ${t[8]}::int)::int + (t.xp >= ${t[9]}::int)::int
        ) as level
      from totals t
    ),
    up as (
      insert into card_xp_progress (player_id, card_id, xp, level, updated_at)
      select player_id, card_id, xp, least(level, ${CARD_XP_MAX_LEVEL})::smallint, now() from computed
      on conflict (player_id, card_id) do update set
        xp = excluded.xp,
        level = excluded.level,
        updated_at = now()
      returning player_id
    )
    select (select count(*)::int from up) as units
  `);
  const row = (res.rows as Array<{ units: number }>)[0] ?? { units: 0 };
  return { units: Number(row.units) };
}

export async function applyCardXp(matchId: string): Promise<{ applied: boolean; units: number }> {
  const db = getDb();
  const affected = await db.execute(sql`
    select distinct a.player_id, a.card_id
    from card_xp_awards a
    join card_xp_runs r on r.match_id = a.match_id
    where r.match_id = ${matchId}::uuid and r.applied = false
  `);
  const pairs = (affected.rows as Array<{ player_id: string; card_id: string }>).map((r) => ({ playerId: String(r.player_id), cardId: String(r.card_id) }));
  const { units } = await applyCardXpTotals(pairs);
  const fin = await db.execute(sql`
    update card_xp_runs r
    set applied = true
    where r.match_id = ${matchId}::uuid and r.applied = false
    returning r.match_id
  `);
  const runs = (fin.rows as Array<{ match_id: string }>).length;
  return { applied: runs > 0, units };
}

/**
 * Finish every settled eligible match whose run marker is missing (never
 * processed) or unapplied (interrupted). Oldest first, bounded. The caller
 * supplies usage computation over stored evidence; matches whose evidence
 * cannot be read are left untouched, never force-awarded.
 */
export async function reconcileCardXp(
  limit: number = 50,
  award: (matchId: string) => Promise<{ status: string }>
): Promise<{ processed: number; awarded: number }> {
  const db = getDb();
  const res = await db.execute(sql`
    select m.id as match_id
    from matches m
    left join card_xp_runs r on r.match_id = m.id
    where m.match_type in ('matchmaking', 'ranked')
      and m.verification = 'replay-verified'
      and (r.match_id is null or r.applied = false)
    order by m.settled_at asc
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

/**
 * Purchased levels for a set of players, for the P2c match-start snapshot.
 * Missing rows mean Level 1; values are clamped to 1..10 so no stored or
 * forged value can escape the policy range. Never throws for a missing
 * table: callers treat a rejection as all-Level-1 (fail-closed).
 */
export async function getPurchasedLevels(playerIds: string[]): Promise<Record<string, Record<string, number>>> {
  const db = getDb();
  const out: Record<string, Record<string, number>> = {};
  for (const pid of playerIds) out[pid] = {};
  if (playerIds.length === 0) return out;
  const rows = await db.select().from(cardXpProgress).where(inArray(cardXpProgress.playerId, playerIds as [string, ...string[]]));
  for (const r of rows) {
    const lv = Number(r.purchasedLevel);
    out[r.playerId]![r.cardId] = Number.isInteger(lv) && lv >= 1 && lv <= 10 ? lv : 1;
  }
  return out;
}

/**
 * Server-owned progression for one player across all 20 ordinary cards.
 * `level` is the actual purchased level (XP alone never advances it);
 * `xpLevel` is the XP-unlocked potential. Upgrade eligibility needs the XP
 * requirement for the next purchased level plus enough Gold balance.
 */
export async function getMyCardXp(playerId: string): Promise<{
  policyVersion: number;
  maxLevel: number;
  gold: number;
  cards: CardXpEntry[];
}> {
  const db = getDb();
  const [rows, gold] = await Promise.all([
    db.select().from(cardXpProgress).where(eq(cardXpProgress.playerId, playerId)),
    db.execute(sql`
      select (coalesce((select sum(amount) from gold_earn_ledger where player_id = ${playerId}::uuid), 0)::int
        + case when to_regclass('public.bot_gold_awards') is not null
          then coalesce((select sum(amount) from bot_gold_awards where player_id = ${playerId}::uuid), 0)::int
          else 0 end)
        - coalesce((select sum(cost) from gold_spend_ledger where player_id = ${playerId}::uuid), 0)::int as balance
    `),
  ]);
  const balance = Number((gold.rows as Array<{ balance: number }>)[0]?.balance ?? 0);
  const byCard = new Map(rows.map((r) => [r.cardId, r]));
  return {
    policyVersion: CARD_XP_POLICY_VERSION,
    maxLevel: CARD_XP_MAX_LEVEL,
    gold: balance,
    cards: ordinaryCardIds().map((cardId) => {
      const row = byCard.get(cardId);
      const xp = row?.xp ?? 0;
      const xpLevel = row ? Number(row.level) : cardLevelForXp(0);
      const purchased = row ? Number(row.purchasedLevel) : 1;
      const maxed = purchased >= CARD_XP_MAX_LEVEL;
      const goldCost = goldCostForLevel(purchased);
      return {
        cardId,
        level: purchased,
        xpLevel,
        xp,
        xpTarget: maxed ? null : CARD_XP_LEVEL_REQUIREMENTS[purchased]!,
        goldCost,
        eligible: !maxed && xp >= CARD_XP_LEVEL_REQUIREMENTS[purchased]! && balance >= goldCost!,
        maxed,
      };
    }),
  };
}
