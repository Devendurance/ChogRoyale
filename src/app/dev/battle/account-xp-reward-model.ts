// Pure client model for the server-authoritative Account XP receipt delivered
// by a battle room. The battle result must never infer XP from the winner,
// duration or mode. Only a structurally valid, context-matching receipt can
// expose an Account XP amount or a level-up to presentation code.

import type { AccountXpMessage } from "@/lib/battle-protocol";
import {
  ACCOUNT_XP_MAX_LEVEL,
  ACCOUNT_XP_POLICY_VERSION,
  type AccountXpReceipt,
  type AccountXpReceiptStatus,
  type AccountXpSource,
  validateAccountXpReceipt,
} from "@/lib/account-xp";

/** Context owned by the active battle and authenticated player. */
export interface AccountXpRewardContext {
  /** The ended room's authoritative match id. */
  matchId?: string | null;
  /** The public route origin for this room. */
  source?: AccountXpSource | null;
  /** The authenticated player's server id. */
  playerId?: string | null;
  /** Optional policy pin for callers that persist the expected version. */
  policyVersion?: number | null;
}

type BaseValidation = ReturnType<typeof validateAccountXpReceipt>;
type BaseValidationReason = Extract<BaseValidation, { ok: false }>["reason"];

export type AccountXpRewardValidationReason =
  | BaseValidationReason
  | "match-mismatch"
  | "source-mismatch"
  | "player-mismatch"
  | "policy-mismatch"
  | "bad-level-snapshot";

export type AccountXpRewardValidation =
  | { ok: true; receipt: AccountXpReceipt }
  | { ok: false; receipt: null; reason: AccountXpRewardValidationReason };

function invalid(reason: AccountXpRewardValidationReason): AccountXpRewardValidation {
  return { ok: false, receipt: null, reason };
}

/**
 * Validate a battle receipt in two layers. `validateAccountXpReceipt` owns
 * the wire contract and current policy version. This function adds the
 * active room/player context, which keeps a valid receipt from another room,
 * origin or account out of the result screen.
 *
 * Omitted context fields perform structural-only validation. A supplied
 * `null` is still an expectation and therefore rejects the non-null server
 * value, which prevents callers from accidentally accepting an unbound
 * receipt when they have an explicit empty context.
 */
export function validateAccountXpReward(value: unknown, context: AccountXpRewardContext = {}): AccountXpRewardValidation {
  const parsed = validateAccountXpReceipt(value);
  if (!parsed.ok) return invalid(parsed.reason);

  if (context.matchId !== undefined && parsed.receipt.matchId !== context.matchId) return invalid("match-mismatch");
  if (context.source !== undefined && parsed.receipt.source !== context.source) return invalid("source-mismatch");
  if (context.playerId !== undefined && parsed.receipt.playerId !== context.playerId) return invalid("player-mismatch");
  if (context.policyVersion !== undefined && parsed.receipt.policyVersion !== context.policyVersion) return invalid("policy-mismatch");
  if (
    (parsed.receipt.levelBefore !== null && (parsed.receipt.levelBefore < 1 || parsed.receipt.levelBefore > ACCOUNT_XP_MAX_LEVEL)) ||
    (parsed.receipt.levelAfter !== null && (parsed.receipt.levelAfter < 1 || parsed.receipt.levelAfter > ACCOUNT_XP_MAX_LEVEL))
  ) return invalid("bad-level-snapshot");

  return parsed;
}

/** Aliases used by battle message handlers and result presenters. */
export const validateAccountXpRewardMessage = validateAccountXpReward;
export const validateAccountXpMessage = validateAccountXpReward;
export const validateAccountXpReceiptForContext = validateAccountXpReward;

/** The accepted receipt for the active match, or null before delivery. */
export type AccountXpRewardReceipt = AccountXpReceipt | null;

export interface AccountXpRewardAcceptance {
  receipt: AccountXpRewardReceipt;
  accepted: boolean;
  reason: AccountXpRewardValidationReason | "accepted" | "lower-priority" | "duplicate";
}

function receiptRank(receipt: AccountXpReceipt): number {
  if (receipt.status === "confirmed") return 3;
  if (receipt.status === "pending") return 1;
  // A terminal refusal/cap is stronger than a pending retry, but never
  // stronger than a confirmed award already accepted by the client.
  return 2;
}

/**
 * Merge one server receipt without allowing delivery order to regress the
 * visible state. Confirmed wins over every late message. A terminal refusal
 * or cap wins over a pending retry. Equal terminal receipts are idempotent.
 */
export function reduceAccountXpReward(
  previous: AccountXpRewardReceipt | AccountXpMessage,
  incoming: unknown,
  context: AccountXpRewardContext = {},
): AccountXpRewardAcceptance {
  const previousParsed = previous ? validateAccountXpReceipt(previous) : null;
  const prior = previousParsed?.ok ? previousParsed.receipt : null;
  const parsed = validateAccountXpReward(incoming, context);
  if (!parsed.ok) return { receipt: prior, accepted: false, reason: parsed.reason };

  const next = parsed.receipt;
  if (!prior) return { receipt: next, accepted: true, reason: "accepted" };
  if (next.matchId !== prior.matchId) return { receipt: prior, accepted: false, reason: "match-mismatch" };

  const nextRank = receiptRank(next);
  const previousRank = receiptRank(prior);
  if (nextRank > previousRank) return { receipt: next, accepted: true, reason: "accepted" };
  if (nextRank < previousRank) return { receipt: prior, accepted: false, reason: "lower-priority" };

  // There is no client-side counter in an Account XP receipt. Keep the first
  // pending/terminal/confirmed value at an equal rank, so duplicate delivery
  // cannot flicker the result or replace an earned amount with zero.
  return { receipt: prior, accepted: false, reason: "duplicate" };
}

export function acceptAccountXpReward(
  previous: AccountXpRewardReceipt,
  incoming: unknown,
  context: AccountXpRewardContext = {},
): AccountXpRewardReceipt {
  const reduced = reduceAccountXpReward(previous, incoming, context);
  if (!reduced.accepted && previous) return previous;
  return reduced.receipt;
}

export const reduceAccountXpMessage = reduceAccountXpReward;
export const acceptAccountXpMessage = acceptAccountXpReward;

export type AccountXpRewardPresentationState =
  | "confirmed"
  | "duplicate"
  | "pending"
  | "capped"
  | "flag-off"
  | "practice-earns-zero"
  | "private-earns-zero"
  | "ranked-closed"
  | "ineligible-type"
  | "unverified"
  | "replay-mismatch"
  | "short-match"
  | "too-few-deploys"
  | "fake-bot-participant"
  | "awaiting-gold"
  | "pre-release"
  | "refused"
  | "no-message";

export interface AccountXpRewardPresentation {
  state: AccountXpRewardPresentationState;
  /** Confirmed XP only. All unconfirmed states expose null. */
  earnedXp: number | null;
  /** Alias for callers that use the receipt's amount field. */
  amount: number | null;
  /** Confirmed lifetime total only. */
  totalXp: number | null;
  /** Authoritative level snapshots, retained for level-up copy. */
  levelBefore: number | null;
  levelAfter: number | null;
  /** True only for a confirmed, server-proven threshold crossing. */
  leveledUp: boolean;
  /** Stable transition key, or null when no level-up is displayable. */
  levelUpKey: string | null;
  title: string;
  text: string;
  eligibility: AccountXpReceipt["eligibility"] | null;
  message: AccountXpMessage | null;
  receipt: AccountXpReceipt | null;
}

const NO_MESSAGE_TEXT = "No Account XP reward confirmed.";

function noMessage(): AccountXpRewardPresentation {
  return {
    state: "no-message",
    earnedXp: null,
    amount: null,
    totalXp: null,
    levelBefore: null,
    levelAfter: null,
    leveledUp: false,
    levelUpKey: null,
    title: "Account XP outcome unknown",
    text: NO_MESSAGE_TEXT,
    eligibility: null,
    message: null,
    receipt: null,
  };
}

function refusedState(eligibility: AccountXpReceipt["eligibility"]): AccountXpRewardPresentationState {
  if (
    eligibility === "flag-off" ||
    eligibility === "practice-earns-zero" ||
    eligibility === "private-earns-zero" ||
    eligibility === "ranked-closed" ||
    eligibility === "ineligible-type" ||
    eligibility === "unverified" ||
    eligibility === "replay-mismatch" ||
    eligibility === "short-match" ||
    eligibility === "too-few-deploys" ||
    eligibility === "fake-bot-participant" ||
    eligibility === "awaiting-gold" ||
    eligibility === "pre-release"
  ) {
    return eligibility;
  }
  return "refused";
}

function refusedText(state: AccountXpRewardPresentationState): string {
  switch (state) {
    case "practice-earns-zero":
      return "Practice battles do not earn Account XP.";
    case "private-earns-zero":
      return "Private battles do not earn Account XP.";
    case "ranked-closed":
      return "Ranked Account XP is not active yet.";
    case "short-match":
      return "Account XP requires at least 60 seconds of combat.";
    case "too-few-deploys":
      return "Deploy at least 3 accepted ordinary cards to earn Account XP.";
    case "replay-mismatch":
      return "No Account XP awarded because the battle could not be verified.";
    case "unverified":
      return "No Account XP awarded because the battle is not verified.";
    case "awaiting-gold":
      return "Waiting for battle reward verification.";
    case "pre-release":
      return "Account XP was not active for this battle.";
    case "flag-off":
      return "Account XP is not active yet.";
    default:
      return "No Account XP was awarded for this battle.";
  }
}

/**
 * Translate an accepted receipt into honest result-screen copy. Invalid or
 * mismatched receipts deliberately collapse to the no-message state.
 */
export function accountXpRewardView(
  receipt: AccountXpRewardReceipt | unknown,
  context: AccountXpRewardContext = {},
): AccountXpRewardPresentation {
  if (receipt === null || receipt === undefined) return noMessage();
  const parsed = validateAccountXpReward(receipt, context);
  if (!parsed.ok) return noMessage();

  const message = parsed.receipt;
  const levelUp = message.status === "confirmed" && message.leveledUp === true &&
    message.levelBefore !== null && message.levelAfter !== null && message.levelAfter > message.levelBefore;
  const levelUpKey = levelUp ? accountXpLevelUpKey(message, context) : null;

  if (message.status === "confirmed") {
    const duplicate = message.eligibility === "duplicate";
    return {
      state: duplicate ? "duplicate" : "confirmed",
      earnedXp: message.amount,
      amount: message.amount,
      totalXp: message.totalXp,
      levelBefore: message.levelBefore,
      levelAfter: message.levelAfter,
      leveledUp: levelUp,
      levelUpKey,
      title: duplicate ? "Account XP already recorded" : "Account XP earned",
      text: duplicate ? `+${message.amount} Account XP already recorded.` : `+${message.amount} Account XP earned.`,
      eligibility: message.eligibility,
      message: message as AccountXpMessage,
      receipt: message,
    };
  }

  if (message.status === "pending") {
    const state = message.eligibility === "awaiting-gold" ? "awaiting-gold" : "pending";
    return {
      state,
      earnedXp: null,
      amount: null,
      totalXp: null,
      levelBefore: null,
      levelAfter: null,
      leveledUp: false,
      levelUpKey: null,
      title: "Account XP verification pending",
      text: state === "pending" ? "Check your account progression later." : refusedText(state),
      eligibility: message.eligibility,
      message: message as AccountXpMessage,
      receipt: message,
    };
  }

  if (message.status === "capped" || message.eligibility === "capped") {
    return {
      state: "capped",
      earnedXp: null,
      amount: null,
      totalXp: null,
      levelBefore: null,
      levelAfter: null,
      leveledUp: false,
      levelUpKey: null,
      title: "Daily Account XP limit reached",
      text: "The Account XP daily limit has been reached.",
      eligibility: message.eligibility,
      message: message as AccountXpMessage,
      receipt: message,
    };
  }

  const state = refusedState(message.eligibility);
  return {
    state,
    earnedXp: null,
    amount: null,
    totalXp: null,
    levelBefore: null,
    levelAfter: null,
    leveledUp: false,
    levelUpKey: null,
    title: "No Account XP awarded",
    text: refusedText(state),
    eligibility: message.eligibility,
    message: message as AccountXpMessage,
    receipt: message,
  };
}

export const accountXpRewardPresentation = accountXpRewardView;
export const accountXpView = accountXpRewardView;

/**
 * Stable identity for a confirmed threshold crossing. The server snapshots
 * are authoritative, so no level is inferred from total XP here.
 */
export function accountXpLevelUpKey(
  receipt: AccountXpReceipt | unknown,
  context: AccountXpRewardContext = {},
): string | null {
  const parsed = validateAccountXpReward(receipt, context);
  if (!parsed.ok || parsed.receipt.status !== "confirmed" || parsed.receipt.leveledUp !== true) return null;
  const value = parsed.receipt;
  if (value.levelBefore === null || value.levelAfter === null || value.levelAfter <= value.levelBefore) return null;
  return `${value.playerId}:${value.matchId}:${value.levelBefore}->${value.levelAfter}`;
}

export const accountXpLevelUpId = accountXpLevelUpKey;

/** Read-only check for a crossing that has not yet been consumed. */
export function isNewAccountXpLevelUp(
  receipt: AccountXpReceipt | unknown,
  seen: ReadonlySet<string>,
  context: AccountXpRewardContext = {},
): boolean {
  const key = accountXpLevelUpKey(receipt, context);
  return key !== null && !seen.has(key);
}

/** Alias phrased for result animation callers. */
export const shouldShowAccountXpLevelUp = isNewAccountXpLevelUp;

/**
 * Mark a crossing as consumed and return whether it should be shown. The set
 * is caller-owned so it can live across room message retries without making
 * the model global.
 */
export function markAccountXpLevelUpSeen(
  receipt: AccountXpReceipt | unknown,
  seen: Set<string>,
  context: AccountXpRewardContext = {},
): boolean {
  const key = accountXpLevelUpKey(receipt, context);
  if (key === null || seen.has(key)) return false;
  seen.add(key);
  return true;
}

export const consumeAccountXpLevelUp = markAccountXpLevelUpSeen;

// Keep these imports visible to TypeScript consumers that use the protocol
// type directly while preserving one source of truth for policy constants.
export type { AccountXpMessage, AccountXpReceiptStatus };
export { ACCOUNT_XP_POLICY_VERSION };
