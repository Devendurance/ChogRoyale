// V2.1i Verified Unranked AI Card XP persistence. Bot XP awards live in a
// dedicated ledger keyed by (match, player, card); the shared recompute in
// db/card-xp.ts adds them to PvP ledger rows so one canonical total feeds
// progression, eligibility and upgrades. Retries and restarts resolve to
// the same rows; concurrent PvP and bot applies converge on identical
// totals because every apply recomputes from all committed ledger rows.
import { sql } from "drizzle-orm";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { botCardXpAwards, botCardXpRuns } from "@/db/schema";
import { BOT_CARD_XP_POLICY_VERSION } from "@/lib/bot-card-xp";

export interface BotCardXpUnit {
  cardId: string;
  deployments: number;
  xp: number;
}

/** Idempotent per-card awards. Returns how many rows were newly inserted. */
export async function stageBotCardXp(
  matchId: string,
  playerId: string,
  units: BotCardXpUnit[],
  policyVersion: number = BOT_CARD_XP_POLICY_VERSION
): Promise<{ staged: number }> {
  if (units.length === 0) return { staged: 0 };
  const db = getDb();
  const res = await db
    .insert(botCardXpAwards)
    .values(
      units.map((u) => ({
        matchId,
        playerId,
        cardId: u.cardId,
        deployments: u.deployments,
        xp: u.xp,
        policyVersion,
      }))
    )
    .onConflictDoNothing({ target: [botCardXpAwards.matchId, botCardXpAwards.playerId, botCardXpAwards.cardId] })
    .returning({ matchId: botCardXpAwards.matchId });
  return { staged: res.length };
}

/** Claim (or re-claim) the per-match processing marker. True when fresh. */
export async function claimBotXpRun(matchId: string, playerId: string, details: Record<string, unknown> = {}): Promise<{ fresh: boolean }> {
  const db = getDb();
  const res = await db
    .insert(botCardXpRuns)
    .values({ matchId, playerId, status: "pending", details })
    .onConflictDoNothing({ target: [botCardXpRuns.matchId, botCardXpRuns.playerId] })
    .returning({ matchId: botCardXpRuns.matchId });
  return { fresh: res.length > 0 };
}

export async function getBotXpRun(matchId: string, playerId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(botCardXpRuns)
    .where(and(eq(botCardXpRuns.matchId, matchId), eq(botCardXpRuns.playerId, playerId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Awarded bot XP rows for one match (idempotent retry reads). */
export async function getBotXpAwards(matchId: string, playerId: string): Promise<Array<{ cardId: string; deployments: number; xp: number }>> {
  const db = getDb();
  const rows = await db
    .select({ cardId: botCardXpAwards.cardId, deployments: botCardXpAwards.deployments, xp: botCardXpAwards.xp })
    .from(botCardXpAwards)
    .where(and(eq(botCardXpAwards.matchId, matchId), eq(botCardXpAwards.playerId, playerId)));
  return rows.map((r) => ({ cardId: r.cardId, deployments: Number(r.deployments), xp: Number(r.xp) }));
}

export async function markBotXpRun(
  matchId: string,
  playerId: string,
  status: "done" | "refused" | "capped",
  awardsCreated: number,
  details: Record<string, unknown> = {}
): Promise<void> {
  const db = getDb();
  await db
    .update(botCardXpRuns)
    .set({ status, applied: status === "done", awardsCreated, details })
    .where(and(eq(botCardXpRuns.matchId, matchId), eq(botCardXpRuns.playerId, playerId)));
}

/** Confirmed Gold award for a bot match (shared daily allowance gate). */
export async function getBotGoldAward(matchId: string, playerId: string): Promise<{ amount: number } | null> {
  const db = getDb();
  const res = await db.execute(sql`
    select amount from bot_gold_awards
    where match_id = ${matchId} and player_id = ${playerId}::uuid
    limit 1
  `);
  const row = (res.rows as Array<{ amount: number }>)[0];
  return row ? { amount: Number(row.amount) } : null;
}

/** Pending bot XP work: eligible evidence with a pending or missing run. */
export async function pendingBotXpMatches(limit = 50): Promise<Array<{ matchId: string; playerId: string }>> {
  const db = getDb();
  const res = await db.execute(sql`
    select m.match_id, m.player_id
    from bot_matches m
    left join bot_card_xp_runs r on r.match_id = m.match_id and r.player_id = m.player_id
    where m.source = 'unranked-fallback' and m.xp_eligible = true
      and (r.match_id is null or r.status = 'pending')
    order by m.finished_at asc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  return (res.rows as Array<{ match_id: string; player_id: string }>).map((r) => ({ matchId: String(r.match_id), playerId: String(r.player_id) }));
}
