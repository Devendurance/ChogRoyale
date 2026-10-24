// P5e.1 friendship age + card gifting foundation (read-only eligibility).
// No gift transaction, inventory mint, XP/Gold movement or UI lives here.
// The future P5e.2 gift mutation must recheck canGiftToFriend inside its
// authoritative write; never rely on a cached eligibility response.

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { friendships, players } from "@/db/schema";
import { blockBetween } from "@/db/blocks";
import { pairKey } from "@/db/friendships";

export const FRIENDSHIP_GIFT_DAYS = 30;
export const FRIENDSHIP_GIFT_MS = FRIENDSHIP_GIFT_DAYS * 24 * 60 * 60 * 1000;

export type GiftIneligibilityReason =
  | "self"
  | "not-friends"
  | "pending"
  | "unavailable"
  | "no-acceptance-record"
  | "too-new"
  | "eligible";

export interface GiftEligibility {
  eligible: boolean;
  reason: GiftIneligibilityReason;
  /** Earliest time the pair could qualify, only when a real acceptedAt pins it. */
  nextEligibleAt: string | null;
}

function tooNew(acceptedAt: Date): GiftEligibility {
  return {
    eligible: false,
    reason: "too-new",
    nextEligibleAt: new Date(acceptedAt.getTime() + FRIENDSHIP_GIFT_MS).toISOString(),
  };
}

/** Server/database clock. Eligibility never trusts client-supplied dates. */
export async function giftNowMs(): Promise<number> {
  const rows = (await getDb().execute(sql`SELECT now() as now`)) as unknown as
    | Array<{ now: string | Date }>
    | { rows?: Array<{ now: string | Date }> };
  const first = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
  const raw = first?.now;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  return Number.isFinite(ms) ? (ms as number) : Date.now();
}

function onboardedStatus(row: { onboardingStatus: string; usernameKey: string | null; avatarId: string | null; accountStatus: string } | undefined): boolean {
  return !!row && row.accountStatus === "active" && row.onboardingStatus === "complete" && !!row.usernameKey && !!row.avatarId;
}

/**
 * Typed 30-day gift eligibility for an ordered sender -> recipient pair.
 * Safe to surface: blocked pairs (either direction), missing onboarding,
 * unknown players and non-friends all collapse to neutral outcomes that
 * reveal no direction or private state. No writes, no transfers.
 *
 * `nowMsOverride` exists for deterministic tests only. The read API never
 * passes it, so production always uses the server/database clock.
 */
export async function canGiftToFriend(
  senderId: string,
  recipientId: string,
  opts?: { nowMsOverride?: number }
): Promise<GiftEligibility> {
  if (senderId === recipientId) return { eligible: false, reason: "self", nextEligibleAt: null };

  const db = getDb();
  const [userA, userB] = pairKey(senderId, recipientId);

  const [senderRows, recipientRows, pairRows] = await Promise.all([
    db.select({ id: players.id, onboardingStatus: players.onboardingStatus, usernameKey: players.usernameKey, avatarId: players.avatarId, accountStatus: players.accountStatus }).from(players).where(eq(players.id, senderId)).limit(1),
    db.select({ id: players.id, onboardingStatus: players.onboardingStatus, usernameKey: players.usernameKey, avatarId: players.avatarId, accountStatus: players.accountStatus }).from(players).where(eq(players.id, recipientId)).limit(1),
    db.select().from(friendships).where(sql`${friendships.userA} = ${userA} and ${friendships.userB} = ${userB}`).limit(1),
  ]);

  const sender = senderRows[0];
  const recipient = recipientRows[0];
  if (!sender || !recipient) return { eligible: false, reason: "not-friends", nextEligibleAt: null };
  if (!onboardedStatus(sender) || !onboardedStatus(recipient)) {
    return { eligible: false, reason: "unavailable", nextEligibleAt: null };
  }

  // Blocks in either direction invalidate eligibility. Neutral outcome:
  // the caller cannot tell who blocked whom.
  const blocked = await blockBetween(senderId, recipientId);
  if (blocked.aBlocksB || blocked.bBlocksA) return { eligible: false, reason: "unavailable", nextEligibleAt: null };

  const row = pairRows[0];
  if (!row) return { eligible: false, reason: "not-friends", nextEligibleAt: null };
  if (row.status !== "accepted") return { eligible: false, reason: "pending", nextEligibleAt: null };

  // Legacy accepted rows without a trustworthy acceptance timestamp never
  // gain eligibility. Never fabricated, never grandfathered.
  const acceptedAt = row.acceptedAt ? new Date(row.acceptedAt) : null;
  if (!acceptedAt || Number.isNaN(acceptedAt.getTime())) {
    return { eligible: false, reason: "no-acceptance-record", nextEligibleAt: null };
  }

  const nowMs = opts?.nowMsOverride ?? (await giftNowMs());
  if (acceptedAt.getTime() > nowMs) return tooNew(acceptedAt);
  if (nowMs - acceptedAt.getTime() < FRIENDSHIP_GIFT_MS) return tooNew(acceptedAt);
  return { eligible: true, reason: "eligible", nextEligibleAt: null };
}
