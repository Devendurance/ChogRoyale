// Pure client model for the server-authoritative Unranked AI fallback Card XP
// receipt. The client never derives XP from the battle result or deployment
// guesses. Only a structurally valid receipt for the ended match can expose
// earned XP to presentation code.

import type { BotCardXpMessage } from "@/lib/battle-protocol";
import {
  BOT_CARD_XP_MATCH_TOTAL_CAP,
  BOT_CARD_XP_PER_CARD_CAP,
  BOT_CARD_XP_POLICY_VERSION,
} from "@/lib/bot-card-xp";
import { BOT_GOLD_DAILY_CAP } from "@/lib/bot-gold";
import { CARD_LEVEL_PROFILES } from "@/lib/card-levels";

/** The ordinary card ids accepted by the authored card progression ladder. */
export const BOT_CARD_XP_KNOWN_CARD_IDS = Object.freeze(Object.keys(CARD_LEVEL_PROFILES)) as readonly string[];
/** Descriptive alias for callers that do not need the bot-specific prefix. */
export const KNOWN_ORDINARY_CARD_IDS = BOT_CARD_XP_KNOWN_CARD_IDS;

const KNOWN_CARD_IDS = new Set(BOT_CARD_XP_KNOWN_CARD_IDS);

const ELIGIBILITIES = [
  "eligible",
  "practice-earns-zero",
  "not-xp-eligible",
  "short-match",
  "too-few-deploys",
  "replay-mismatch",
  "duplicate",
  "awaiting-gold",
  "capped",
] as const satisfies readonly BotCardXpMessage["eligibility"][];

const STATUSES = ["confirmed", "pending", "refused", "capped"] as const satisfies readonly BotCardXpMessage["status"][];

type AwardedCard = BotCardXpMessage["awardedCards"][number];

export type BotCardXpValidationReason =
  | "not-an-object"
  | "match-missing"
  | "match-mismatch"
  | "wrong-source"
  | "invalid-eligibility"
  | "invalid-status"
  | "invalid-policy-version"
  | "invalid-total-xp"
  | "invalid-awarded-cards"
  | "invalid-card-id"
  | "duplicate-card-id"
  | "invalid-deployments"
  | "invalid-card-xp"
  | "card-xp-cap"
  | "match-xp-cap"
  | "total-xp-mismatch"
  | "invalid-rewarded-today"
  | "invalid-daily-cap"
  | "invalid-status-eligibility"
  | "invalid-status-xp";

export type BotCardXpValidation =
  | { ok: true; message: BotCardXpMessage }
  | { ok: false; message: null; reason: BotCardXpValidationReason };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);

function invalid(reason: BotCardXpValidationReason): BotCardXpValidation {
  return { ok: false, message: null, reason };
}

function statusEligibilityValid(status: BotCardXpMessage["status"], eligibility: BotCardXpMessage["eligibility"]): boolean {
  if (status === "confirmed") return eligibility === "eligible" || eligibility === "duplicate";
  if (status === "pending") return eligibility === "awaiting-gold" || eligibility === "replay-mismatch";
  if (status === "capped") return eligibility === "capped";
  return (
    eligibility === "practice-earns-zero" ||
    eligibility === "not-xp-eligible" ||
    eligibility === "short-match" ||
    eligibility === "too-few-deploys" ||
    eligibility === "replay-mismatch"
  );
}

/**
 * Validate an authoritative Card XP receipt before it can affect the result
 * UI. The expected match is optional for structural checks, but any supplied
 * match id is exact and a valid receipt always contains a non-empty id.
 */
export function validateBotCardXpMessage(value: unknown, expectedMatchId?: string | null): BotCardXpValidation {
  if (!isRecord(value)) return invalid("not-an-object");
  if (typeof value.matchId !== "string" || value.matchId.trim().length === 0) return invalid("match-missing");
  if (expectedMatchId !== undefined && value.matchId !== expectedMatchId) return invalid("match-mismatch");
  if (value.source !== "unranked-fallback") return invalid("wrong-source");
  if (!isOneOf(value.eligibility, ELIGIBILITIES)) return invalid("invalid-eligibility");
  if (!isOneOf(value.status, STATUSES)) return invalid("invalid-status");
  if (!isInteger(value.policyVersion) || value.policyVersion !== BOT_CARD_XP_POLICY_VERSION) return invalid("invalid-policy-version");
  if (!isInteger(value.totalXp) || value.totalXp < 0) return invalid("invalid-total-xp");
  if (!Array.isArray(value.awardedCards)) return invalid("invalid-awarded-cards");

  const seen = new Set<string>();
  let reconciledTotal = 0;
  for (const raw of value.awardedCards) {
    if (!isRecord(raw)) return invalid("invalid-awarded-cards");
    if (typeof raw.cardId !== "string" || !KNOWN_CARD_IDS.has(raw.cardId)) return invalid("invalid-card-id");
    if (seen.has(raw.cardId)) return invalid("duplicate-card-id");
    seen.add(raw.cardId);
    // Award rows describe accepted deployments, so a row with no deployment
    // is malformed even though XP itself is allowed to be zero by the wire
    // contract.
    if (!isInteger(raw.deployments) || raw.deployments < 1) return invalid("invalid-deployments");
    if (!isInteger(raw.xp) || raw.xp < 0) return invalid("invalid-card-xp");
    if (raw.xp > BOT_CARD_XP_PER_CARD_CAP) return invalid("card-xp-cap");
    reconciledTotal += raw.xp;
    if (!Number.isSafeInteger(reconciledTotal)) return invalid("match-xp-cap");
  }

  if (reconciledTotal > BOT_CARD_XP_MATCH_TOTAL_CAP || value.totalXp > BOT_CARD_XP_MATCH_TOTAL_CAP) return invalid("match-xp-cap");
  if (reconciledTotal !== value.totalXp) return invalid("total-xp-mismatch");

  if (!isInteger(value.rewardedToday) || value.rewardedToday < 0) return invalid("invalid-rewarded-today");
  // This policy shares the Gold daily allowance. Pinning the current cap
  // prevents a forged receipt from claiming a larger allowance.
  if (!isInteger(value.dailyCap) || value.dailyCap !== BOT_GOLD_DAILY_CAP || value.rewardedToday > value.dailyCap) {
    return invalid("invalid-daily-cap");
  }

  const status = value.status as BotCardXpMessage["status"];
  const eligibility = value.eligibility as BotCardXpMessage["eligibility"];
  if (!statusEligibilityValid(status, eligibility)) return invalid("invalid-status-eligibility");

  // Pending, refused and capped outcomes never carry usable XP. This also
  // prevents a malformed receipt from smuggling a non-confirmed award into a
  // presentation layer that only checks totalXp.
  if (status !== "confirmed" && (value.totalXp !== 0 || value.awardedCards.length !== 0)) return invalid("invalid-status-xp");

  return { ok: true, message: value as unknown as BotCardXpMessage };
}

export function isBotCardXpMessage(value: unknown, expectedMatchId?: string | null): value is BotCardXpMessage {
  return validateBotCardXpMessage(value, expectedMatchId).ok;
}

export type BotCardXpReceipt = BotCardXpMessage | null;

export interface BotCardXpAcceptance {
  receipt: BotCardXpReceipt;
  accepted: boolean;
  reason: BotCardXpValidationReason | "accepted" | "lower-priority" | "duplicate";
}

function receiptRank(message: BotCardXpMessage): number {
  if (message.status === "confirmed") return 3;
  if (message.status === "pending") return 1;
  return 2;
}

/**
 * Merge one room receipt into the currently accepted receipt. Confirmation is
 * monotonic. A late pending/refused/capped message cannot erase confirmed XP,
 * and a receipt for another match cannot enter the reducer.
 */
export function reduceBotCardXpMessage(previous: BotCardXpReceipt, incoming: unknown, expectedMatchId?: string | null): BotCardXpAcceptance {
  const validation = validateBotCardXpMessage(incoming, expectedMatchId);
  if (!validation.ok) return { receipt: previous, accepted: false, reason: validation.reason };
  const next = validation.message;
  if (!previous) return { receipt: next, accepted: true, reason: "accepted" };
  if (next.matchId !== previous.matchId) return { receipt: previous, accepted: false, reason: "match-mismatch" };

  const nextRank = receiptRank(next);
  const previousRank = receiptRank(previous);
  if (nextRank > previousRank) return { receipt: next, accepted: true, reason: "accepted" };
  if (nextRank < previousRank) return { receipt: previous, accepted: false, reason: "lower-priority" };

  // A pending retry with a newer server counter is useful progress. Equal
  // terminal receipts, including confirmed duplicate receipts, stay stable so
  // a replay cannot make the result flicker between labels.
  if (next.status === "pending" && previous.status === "pending" && next.rewardedToday > previous.rewardedToday) {
    return { receipt: next, accepted: true, reason: "accepted" };
  }
  return { receipt: previous, accepted: false, reason: "duplicate" };
}

export function acceptBotCardXpMessage(previous: BotCardXpReceipt, incoming: unknown, expectedMatchId?: string | null): BotCardXpReceipt {
  return reduceBotCardXpMessage(previous, incoming, expectedMatchId).receipt;
}

export type BotCardXpPresentationState =
  | "confirmed"
  | "duplicate"
  | "awaiting-gold"
  | "pending"
  | "capped"
  | "practice-earns-zero"
  | "not-xp-eligible"
  | "short-match"
  | "too-few-deploys"
  | "replay-mismatch"
  | "refused"
  | "no-message";

export interface BotCardXpPresentation {
  state: BotCardXpPresentationState;
  /** Confirmed earned XP, or null until the server confirms it. */
  earnedXp: number | null;
  /** Alias retained for result rows that use the receipt field name. */
  totalXp: number | null;
  /** Confirmed card rows, or an empty list for every non-confirmed state. */
  awardedCards: AwardedCard[];
  title: string;
  text: string;
  eligibility: BotCardXpMessage["eligibility"] | null;
  message: BotCardXpMessage | null;
}

const NO_MESSAGE_TEXT = "No AI Card XP reward confirmed.";

function noMessage(): BotCardXpPresentation {
  return {
    state: "no-message",
    earnedXp: null,
    totalXp: null,
    awardedCards: [],
    title: "Card XP reward",
    text: NO_MESSAGE_TEXT,
    eligibility: null,
    message: null,
  };
}

/** Translate an accepted server receipt into honest result-screen copy. */
export function botCardXpView(receipt: BotCardXpReceipt | unknown, expectedMatchId?: string | null): BotCardXpPresentation {
  if (receipt === null || receipt === undefined) return noMessage();
  const validation = validateBotCardXpMessage(receipt, expectedMatchId);
  if (!validation.ok) return noMessage();

  const message = validation.message;
  const confirmed = message.status === "confirmed";
  if (confirmed) {
    const duplicate = message.eligibility === "duplicate";
    return {
      state: duplicate ? "duplicate" : "confirmed",
      earnedXp: message.totalXp,
      totalXp: message.totalXp,
      awardedCards: [...message.awardedCards],
      title: duplicate ? "Card XP already recorded" : "Card XP earned",
      text: duplicate ? `+${message.totalXp} Card XP already recorded` : `+${message.totalXp} Card XP earned`,
      eligibility: message.eligibility,
      message,
    };
  }

  if (message.status === "pending" && message.eligibility === "awaiting-gold") {
    return {
      state: "awaiting-gold",
      earnedXp: null,
      totalXp: null,
      awardedCards: [],
      title: "Card XP verification pending",
      text: "Waiting for battle reward verification.",
      eligibility: message.eligibility,
      message,
    };
  }

  if (message.status === "pending") {
    return {
      state: "pending",
      earnedXp: null,
      totalXp: null,
      awardedCards: [],
      title: "Card XP verification pending",
      text: "Check your card progress later.",
      eligibility: message.eligibility,
      message,
    };
  }

  if (message.status === "capped" || message.eligibility === "capped") {
    return {
      state: "capped",
      earnedXp: null,
      totalXp: null,
      awardedCards: [],
      title: "Daily AI Card XP limit reached",
      text: "No Card XP awarded for this battle.",
      eligibility: message.eligibility,
      message,
    };
  }

  const state: BotCardXpPresentationState =
    message.eligibility === "practice-earns-zero" ||
    message.eligibility === "not-xp-eligible" ||
    message.eligibility === "short-match" ||
    message.eligibility === "too-few-deploys" ||
    message.eligibility === "replay-mismatch"
      ? message.eligibility
      : "refused";
  const text =
    state === "short-match"
      ? "Card XP requires at least 60 seconds of combat."
      : state === "too-few-deploys"
        ? "Deploy accepted ordinary cards to earn Card XP."
        : state === "replay-mismatch"
          ? "No Card XP awarded because the battle could not be verified."
          : state === "practice-earns-zero"
            ? "Practice battles do not earn Card XP."
            : state === "not-xp-eligible"
              ? "No Card XP awarded for this battle."
              : "No Card XP awarded for this battle.";
  return {
    state,
    earnedXp: null,
    totalXp: null,
    awardedCards: [],
    title: "No Card XP awarded",
    text,
    eligibility: message.eligibility,
    message,
  };
}

/** Descriptive alias for callers that use presentation terminology. */
export const botCardXpPresentation = botCardXpView;
