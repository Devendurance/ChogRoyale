// P6c Gold-funded card upgrade sponsorship (Model B). The sponsor pays
// Gold from their own legitimately earned balance; the recipient advances
// exactly ONE purchased ordinary-card level. No XP, card copies, levels or
// Gold move between accounts. The recipient must have earned the XP
// requirement through real gameplay; recipient XP is never consumed.
//
// Atomicity follows the P2b upgrade discipline: one statement takes
// advisory locks, replays the idempotency key, re-checks every precondition
// (friendship age, blocks, recipient level/XP, sponsor balance, TEST caps)
// and performs the recipient advance plus the sponsor spend plus the
// receipt row together. Statement-level atomicity means Gold is never spent
// without the upgrade, and the receipt never exists without the spend.
// Locks always order least-then-greatest on the shared 'gold-upgrade:'
// namespace, which is deadlock-free against single-key self-upgrades.
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { giftSponsorships, type GiftSponsorship } from "@/db/schema";
import { ordinaryCardIds } from "@/db/card-xp";
import { canGiftToFriend } from "@/db/gifting";
import { getGoldTotals } from "@/db/gold";
import { CARD_XP_LEVEL_REQUIREMENTS, CARD_XP_MAX_LEVEL, goldCostForLevel } from "@/lib/card-xp";
import { GOLD_POLICY_VERSION } from "@/lib/gold";

/** Provisional TEST-only caps, not production-approved numbers. */
export const SPONSORSHIP_RECIPIENT_DAY_MAX = 1;
export const SPONSORSHIP_SENDER_WEEK_MAX = 3;
export const SPONSORSHIP_PAIR_CARD_WEEK_MAX = 1;
export const SPONSORSHIP_POLICY_VERSION = 1;

export type SponsorshipStatus =
  | "sponsored"
  | "duplicate"
  | "invalid-card"
  | "level-mismatch"
  | "maxed"
  | "insufficient-xp"
  | "insufficient-gold"
  | "not-eligible"
  | "cap-recipient-day"
  | "cap-sender-week"
  | "cap-pair-week"
  | "conflict-retry";

export interface SponsorshipRequest {
  recipientId: string;
  cardId: string;
  expectedLevel: number;
  idempotencyKey: string;
}

export interface SponsorshipResponse {
  status: SponsorshipStatus;
  cardId: string;
  /** Recipient's purchased level after the operation, or as observed. */
  recipientLevel: number;
  /** Cost charged (sponsored/duplicate) or cost to advance from observed. */
  goldCost: number | null;
  sponsorBalance: number;
  receiptId: string | null;
}

export interface SponsorshipReceipt {
  id: string;
  sponsorId: string;
  recipientId: string;
  cardId: string;
  fromLevel: number;
  toLevel: number;
  cost: number;
  createdAt: string;
}

export interface SponsorshipQuote {
  eligible: boolean;
  reason: SponsorshipStatus | "eligible";
  cardId: string;
  /** Recipient's current purchased level, only when the sponsor may act. */
  nextLevel: number | null;
  /** Server-calculated Gold cost, only when the sponsor may act. */
  cost: number | null;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function toReceipt(row: GiftSponsorship): SponsorshipReceipt {
  return {
    id: row.id,
    sponsorId: row.sponsorId,
    recipientId: row.recipientId,
    cardId: row.cardId,
    fromLevel: row.fromLevel,
    toLevel: row.toLevel,
    cost: row.cost,
    createdAt: row.createdAt.toISOString(),
  };
}

interface ChkRow {
  balance: number;
  cur_level: number | null;
  cur_xp: number | null;
  friend_ok: boolean;
  blocks: number;
  rday: number;
  sweek: number;
  pairweek: number;
}

interface PriorRow {
  idempotency_key: string;
  sponsor_id: string;
  recipient_id: string;
  card_id: string;
  from_level: number;
  to_level: number;
  cost: number;
}

/**
 * Sponsored single-level upgrade. Exactly one statement performs locks,
 * replay check, precondition checks, recipient advance, sponsor spend and
 * receipt insert, so no interleaving can charge without advancing, advance
 * without charging, or record a receipt without the spend.
 */
export async function sponsorUpgrade(sponsorId: string, req: SponsorshipRequest): Promise<SponsorshipResponse> {
  const db = getDb();
  if (!ordinaryCardIds().includes(req.cardId)) {
    return { status: "invalid-card", cardId: req.cardId, recipientLevel: 1, goldCost: null, sponsorBalance: (await getGoldTotals(sponsorId)).balance, receiptId: null };
  }
  if (!Number.isInteger(req.expectedLevel) || req.expectedLevel < 1 || req.expectedLevel >= CARD_XP_MAX_LEVEL) {
    const [totals, cur] = await Promise.all([
      getGoldTotals(sponsorId),
      db.execute(sql`select purchased_level from card_xp_progress where player_id = ${req.recipientId}::uuid and card_id = ${req.cardId}`),
    ]);
    const recipientLevel = Number((cur.rows as Array<{ purchased_level: number }>)[0]?.purchased_level ?? 1);
    return {
      status: req.expectedLevel >= CARD_XP_MAX_LEVEL ? "maxed" : "level-mismatch",
      cardId: req.cardId,
      recipientLevel,
      goldCost: goldCostForLevel(recipientLevel),
      sponsorBalance: totals.balance,
      receiptId: null,
    };
  }
  if (!UUID_RE.test(req.idempotencyKey)) {
    throw new Error("malformed idempotency key");
  }
  const cost = goldCostForLevel(req.expectedLevel)!;
  const xpReq = CARD_XP_LEVEL_REQUIREMENTS[req.expectedLevel]!;
  const low = sponsorId < req.recipientId ? sponsorId : req.recipientId;
  const high = sponsorId < req.recipientId ? req.recipientId : sponsorId;
  const res = await db.execute(sql`
    with lock1 as materialized (
      select pg_advisory_xact_lock(hashtext('gold-upgrade:' || ${low}::text)) as l
    ),
    locks as materialized (
      select pg_advisory_xact_lock(hashtext('gold-upgrade:' || ${high}::text)) as l from lock1
    ),
    prior as (
      select idempotency_key, sponsor_id, recipient_id, card_id, from_level, to_level, cost
      from gift_sponsorships
      where idempotency_key = ${req.idempotencyKey}::uuid
    ),
    chk as (
      select
        (select coalesce(sum(amount), 0) from gold_earn_ledger where player_id = ${sponsorId}::uuid)
        - (select coalesce(sum(cost), 0) from gold_spend_ledger where player_id = ${sponsorId}::uuid) as balance,
        (select purchased_level from card_xp_progress where player_id = ${req.recipientId}::uuid and card_id = ${req.cardId}) as cur_level,
        (select xp from card_xp_progress where player_id = ${req.recipientId}::uuid and card_id = ${req.cardId}) as cur_xp,
        coalesce((select count(*) = 1 from friendships
          where ((user_a = ${low}::uuid and user_b = ${high}::uuid))
            and status = 'accepted'
            and accepted_at is not null
            and accepted_at <= now() - interval '30 days'), false) as friend_ok,
        (select count(*) from player_blocks
          where (blocker = ${sponsorId}::uuid and blocked = ${req.recipientId}::uuid)
             or (blocker = ${req.recipientId}::uuid and blocked = ${sponsorId}::uuid)) as blocks,
        (select count(*) from gift_sponsorships where recipient_id = ${req.recipientId}::uuid and created_at > now() - interval '1 day') as rday,
        (select count(*) from gift_sponsorships where sponsor_id = ${sponsorId}::uuid and created_at > now() - interval '7 days') as sweek,
        (select count(*) from gift_sponsorships where sponsor_id = ${sponsorId}::uuid and recipient_id = ${req.recipientId}::uuid and card_id = ${req.cardId} and created_at > now() - interval '7 days') as pairweek
      from locks
      where not exists (select 1 from prior)
    ),
    gate as (
      select * from chk
      where coalesce(cur_level, 1) = ${req.expectedLevel}
        and coalesce(cur_xp, 0) >= ${xpReq}
        and friend_ok
        and blocks = 0
        and rday < ${SPONSORSHIP_RECIPIENT_DAY_MAX}
        and sweek < ${SPONSORSHIP_SENDER_WEEK_MAX}
        and pairweek < ${SPONSORSHIP_PAIR_CARD_WEEK_MAX}
        and balance >= ${cost}
    ),
    up as (
      update card_xp_progress p
      set purchased_level = ${req.expectedLevel} + 1, updated_at = now()
      from gate g
      where p.player_id = ${req.recipientId}::uuid and p.card_id = ${req.cardId} and p.purchased_level = ${req.expectedLevel}
      returning p.player_id
    ),
    ins_spend as (
      insert into gold_spend_ledger (idempotency_key, player_id, card_id, from_level, to_level, cost, policy_version)
      select ${req.idempotencyKey}::uuid, ${sponsorId}::uuid, ${req.cardId}, ${req.expectedLevel}, ${req.expectedLevel} + 1, ${cost}, ${GOLD_POLICY_VERSION}
      from up
      on conflict do nothing
      returning idempotency_key, card_id, from_level, to_level, cost
    ),
    ins_gift as (
      insert into gift_sponsorships (idempotency_key, sponsor_id, recipient_id, card_id, from_level, to_level, cost, policy_version)
      select ${req.idempotencyKey}::uuid, ${sponsorId}::uuid, ${req.recipientId}::uuid, ${req.cardId}, ${req.expectedLevel}, ${req.expectedLevel} + 1, ${cost}, ${SPONSORSHIP_POLICY_VERSION}
      from ins_spend
      on conflict do nothing
      returning id, idempotency_key, card_id, from_level, to_level, cost
    )
    select
      (select row_to_json(prior) from prior) as prior,
      (select row_to_json(ins_gift) from ins_gift) as applied,
      (select row_to_json(chk) from chk) as chk
  `);
  const row = (res.rows as Array<{ prior: PriorRow | null; applied: (PriorRow & { id: string }) | null; chk: ChkRow | null }>)[0]!;
  const sponsorBalance = (await getGoldTotals(sponsorId)).balance;
  if (row.prior) {
    return {
      status: "duplicate",
      cardId: String(row.prior.card_id),
      recipientLevel: Number(row.prior.to_level),
      goldCost: null,
      sponsorBalance,
      receiptId: null,
    };
  }
  if (row.applied) {
    return {
      status: "sponsored",
      cardId: req.cardId,
      recipientLevel: req.expectedLevel + 1,
      goldCost: null,
      sponsorBalance,
      receiptId: String((row.applied as { id: string }).id),
    };
  }
  // No mutation happened. Map the observed state to a precise reason.
  // Order is deterministic: level, XP, eligibility, caps, funds.
  const chk = row.chk;
  let status: SponsorshipStatus = "conflict-retry";
  if (chk) {
    const curLevel = chk.cur_level ?? 1;
    if (curLevel !== req.expectedLevel) status = "level-mismatch";
    else if ((chk.cur_xp ?? 0) < xpReq) status = "insufficient-xp";
    else if (!chk.friend_ok || Number(chk.blocks) > 0) status = "not-eligible";
    else if (Number(chk.pairweek) >= SPONSORSHIP_PAIR_CARD_WEEK_MAX) status = "cap-pair-week";
    else if (Number(chk.rday) >= SPONSORSHIP_RECIPIENT_DAY_MAX) status = "cap-recipient-day";
    else if (Number(chk.sweek) >= SPONSORSHIP_SENDER_WEEK_MAX) status = "cap-sender-week";
    else if (Number(chk.balance) < cost) status = "insufficient-gold";
  }
  const progress = await db.execute(sql`
    select purchased_level from card_xp_progress where player_id = ${req.recipientId}::uuid and card_id = ${req.cardId}
  `);
  const recipientLevel = Number((progress.rows as Array<{ purchased_level: number }>)[0]?.purchased_level ?? 1);
  return { status, cardId: req.cardId, recipientLevel, goldCost: goldCostForLevel(recipientLevel), sponsorBalance, receiptId: null };
}

/**
 * Advisory sponsorship quote. Reuses the authoritative eligibility helper
 * and reads server state, but never mutates. The mutation re-checks
 * everything atomically, so a quote is never an authorization.
 */
export async function getSponsorshipQuote(sponsorId: string, recipientId: string, cardId: string): Promise<SponsorshipQuote> {
  const base = { cardId, nextLevel: null as number | null, cost: null as number | null };
  if (!ordinaryCardIds().includes(cardId)) {
    return { ...base, eligible: false, reason: "invalid-card" };
  }
  const eligibility = await canGiftToFriend(sponsorId, recipientId);
  if (!eligibility.eligible) {
    const reason = eligibility.reason === "eligible" ? "not-eligible" : eligibility.reason;
    return { ...base, eligible: false, reason: (reason === "pending" || reason === "no-acceptance-record" || reason === "too-new" ? "not-eligible" : reason) as SponsorshipQuote["reason"] };
  }
  const db = getDb();
  const [progress, totals, caps] = await Promise.all([
    db.execute(sql`select purchased_level, xp from card_xp_progress where player_id = ${recipientId}::uuid and card_id = ${cardId}`),
    getGoldTotals(sponsorId),
    db.execute(sql`
      select
        (select count(*) from gift_sponsorships where recipient_id = ${recipientId}::uuid and created_at > now() - interval '1 day') as rday,
        (select count(*) from gift_sponsorships where sponsor_id = ${sponsorId}::uuid and created_at > now() - interval '7 days') as sweek,
        (select count(*) from gift_sponsorships where sponsor_id = ${sponsorId}::uuid and recipient_id = ${recipientId}::uuid and card_id = ${cardId} and created_at > now() - interval '7 days') as pairweek
    `),
  ]);
  const prow = (progress.rows as Array<{ purchased_level: number; xp: number }>)[0];
  const curLevel = Number(prow?.purchased_level ?? 1);
  const curXp = Number(prow?.xp ?? 0);
  if (curLevel >= CARD_XP_MAX_LEVEL) return { ...base, eligible: false, reason: "maxed" };
  const cost = goldCostForLevel(curLevel)!;
  const xpReq = CARD_XP_LEVEL_REQUIREMENTS[curLevel]!;
  if (curXp < xpReq) return { ...base, eligible: false, reason: "insufficient-xp" };
  const cap = (caps.rows as Array<{ rday: number; sweek: number; pairweek: number }>)[0]!;
  if (Number(cap.rday) >= SPONSORSHIP_RECIPIENT_DAY_MAX) return { ...base, eligible: false, reason: "cap-recipient-day" };
  if (Number(cap.sweek) >= SPONSORSHIP_SENDER_WEEK_MAX) return { ...base, eligible: false, reason: "cap-sender-week" };
  if (Number(cap.pairweek) >= SPONSORSHIP_PAIR_CARD_WEEK_MAX) return { ...base, eligible: false, reason: "cap-pair-week" };
  if (totals.balance < cost) return { ...base, eligible: false, reason: "insufficient-gold" };
  return { ...base, eligible: true, reason: "eligible", nextLevel: curLevel, cost };
}

export async function listSponsorshipsSent(sponsorId: string): Promise<SponsorshipReceipt[]> {
  const rows = await getDb().select().from(giftSponsorships).where(eq(giftSponsorships.sponsorId, sponsorId)).orderBy(desc(giftSponsorships.createdAt));
  return rows.map(toReceipt);
}

export async function listSponsorshipsReceived(recipientId: string): Promise<SponsorshipReceipt[]> {
  const rows = await getDb().select().from(giftSponsorships).where(eq(giftSponsorships.recipientId, recipientId)).orderBy(desc(giftSponsorships.createdAt));
  return rows.map(toReceipt);
}
