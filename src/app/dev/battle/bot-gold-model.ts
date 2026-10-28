// Pure client model for the server-authoritative Unranked AI fallback Gold
// message. This module never derives a reward from the battle result. A Gold
// amount is displayable only after a matching, valid confirmed message.

import type { BotGoldMessage } from "@/lib/battle-protocol";

const ELIGIBILITIES = [
  "eligible",
  "practice-earns-zero",
  "short-match",
  "too-few-deploys",
  "replay-mismatch",
  "duplicate",
  "capped",
] as const satisfies readonly BotGoldMessage["eligibility"][];

const STATUSES = ["confirmed", "pending", "refused", "capped"] as const satisfies readonly BotGoldMessage["status"][];

export type BotGoldValidationReason =
  | "not-an-object"
  | "match-missing"
  | "match-mismatch"
  | "wrong-source"
  | "invalid-eligibility"
  | "invalid-policy-version"
  | "invalid-amount"
  | "invalid-status-amount"
  | "invalid-rewarded-today"
  | "invalid-daily-cap";

export type BotGoldValidation =
  | { ok: true; message: BotGoldMessage }
  | { ok: false; message: null; reason: BotGoldValidationReason };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);

/**
 * Validate a message received from the battle room before it can affect the
 * result UI. The expected match is optional for callers that only need a
 * structural check, but a valid message always has a non-empty match ID.
 */
export function validateBotGoldMessage(value: unknown, expectedMatchId?: string | null): BotGoldValidation {
  if (!isRecord(value)) return { ok: false, message: null, reason: "not-an-object" };
  if (typeof value.matchId !== "string" || value.matchId.trim().length === 0) return { ok: false, message: null, reason: "match-missing" };
  if (expectedMatchId !== undefined && value.matchId !== expectedMatchId) return { ok: false, message: null, reason: "match-mismatch" };
  if (value.source !== "unranked-fallback") return { ok: false, message: null, reason: "wrong-source" };
  if (!isOneOf(value.eligibility, ELIGIBILITIES)) return { ok: false, message: null, reason: "invalid-eligibility" };
  if (!isOneOf(value.status, STATUSES)) return { ok: false, message: null, reason: "invalid-status-amount" };
  if (!isInteger(value.policyVersion) || value.policyVersion < 1) return { ok: false, message: null, reason: "invalid-policy-version" };
  if (!isInteger(value.amount) || value.amount < 0) return { ok: false, message: null, reason: "invalid-amount" };
  if (!isInteger(value.rewardedToday) || value.rewardedToday < 0) return { ok: false, message: null, reason: "invalid-rewarded-today" };
  if (!isInteger(value.dailyCap) || value.dailyCap < 1 || value.rewardedToday > value.dailyCap) return { ok: false, message: null, reason: "invalid-daily-cap" };

  // Confirmed is the only state that can carry spendable Gold. A refusal,
  // cap or pending verification must never make the client invent an amount.
  if (value.status === "confirmed" && value.eligibility !== "eligible" && value.eligibility !== "duplicate") {
    return { ok: false, message: null, reason: "invalid-status-amount" };
  }
  if (value.status !== "confirmed" && value.amount !== 0) return { ok: false, message: null, reason: "invalid-status-amount" };

  return { ok: true, message: value as unknown as BotGoldMessage };
}

export function isBotGoldMessage(value: unknown, expectedMatchId?: string | null): value is BotGoldMessage {
  return validateBotGoldMessage(value, expectedMatchId).ok;
}

/** The currently visible receipt. Null means no authoritative receipt arrived. */
export type BotGoldReceipt = BotGoldMessage | null;

/**
 * Receipt precedence is monotonic. A confirmed award wins over every late
 * pending/refused payload. A terminal refusal or cap wins over a late pending
 * payload. Equal terminal messages are idempotent and keep the first outcome,
 * so a replayed message cannot make the result flicker.
 */
function receiptRank(message: BotGoldMessage): number {
  if (message.status === "confirmed") return 3;
  if (message.status === "pending") return 1;
  return 2;
}

export interface BotGoldAcceptance {
  receipt: BotGoldReceipt;
  accepted: boolean;
  reason: BotGoldValidationReason | "lower-priority" | "duplicate";
}

/** Merge one room message into the already accepted receipt. */
export function reduceBotGoldMessage(previous: BotGoldReceipt, incoming: unknown, expectedMatchId?: string | null): BotGoldAcceptance {
  const validation = validateBotGoldMessage(incoming, expectedMatchId);
  if (!validation.ok) return { receipt: previous, accepted: false, reason: validation.reason };
  const next = validation.message;
  if (!previous) return { receipt: next, accepted: true, reason: "duplicate" };
  if (next.matchId !== previous.matchId) return { receipt: previous, accepted: false, reason: "match-mismatch" };

  const nextRank = receiptRank(next);
  const previousRank = receiptRank(previous);
  if (nextRank > previousRank) return { receipt: next, accepted: true, reason: "duplicate" };
  if (nextRank < previousRank) return { receipt: previous, accepted: false, reason: "lower-priority" };

  // While a pending receipt is being retried, a larger server counter is
  // useful progress. Equal terminal outcomes stay stable, including the
  // eligible/duplicate distinction on a repeated confirmed award.
  if (next.status === "pending" && previous.status === "pending" && next.rewardedToday > previous.rewardedToday) {
    return { receipt: next, accepted: true, reason: "duplicate" };
  }
  return { receipt: previous, accepted: false, reason: "duplicate" };
}

/** Convenience reducer for callers that only need the accepted receipt. */
export function acceptBotGoldMessage(previous: BotGoldReceipt, incoming: unknown, expectedMatchId?: string | null): BotGoldReceipt {
  return reduceBotGoldMessage(previous, incoming, expectedMatchId).receipt;
}

export type BotGoldPresentationState =
  | "confirmed"
  | "duplicate"
  | "pending"
  | "capped"
  | "short-match"
  | "too-few-deploys"
  | "replay-mismatch"
  | "refused"
  | "no-message";

export interface BotGoldPresentation {
  state: BotGoldPresentationState;
  /** Null whenever Gold was not confirmed by the server. */
  amount: number | null;
  /** Short label suitable for the result reward row. */
  title: string;
  /** Honest explanation. It never contains a made-up number. */
  text: string;
  eligibility: BotGoldMessage["eligibility"] | null;
  message: BotGoldMessage | null;
}

const NO_MESSAGE_TEXT = "No AI Gold reward confirmed.";

/** Translate an accepted server receipt into result-screen copy. */
export function botGoldView(receipt: BotGoldReceipt | unknown, expectedMatchId?: string | null): BotGoldPresentation {
  if (receipt === null || receipt === undefined) {
    return { state: "no-message", amount: null, title: "Gold reward", text: NO_MESSAGE_TEXT, eligibility: null, message: null };
  }
  const validation = validateBotGoldMessage(receipt, expectedMatchId);
  if (!validation.ok) {
    return { state: "no-message", amount: null, title: "Gold reward", text: NO_MESSAGE_TEXT, eligibility: null, message: null };
  }

  const message = validation.message;
  if (message.status === "confirmed") {
    if (message.eligibility === "duplicate") {
      return {
        state: "duplicate",
        amount: message.amount,
        title: "Gold earned",
        text: `+${message.amount} Gold earned`,
        eligibility: message.eligibility,
        message,
      };
    }
    return {
      state: "confirmed",
      amount: message.amount,
      title: "Gold earned",
      text: `+${message.amount} Gold earned`,
      eligibility: message.eligibility,
      message,
    };
  }

  if (message.status === "pending") {
    return {
      state: "pending",
      amount: null,
      title: "Gold reward verification pending",
      text: "Check your Gold balance later.",
      eligibility: message.eligibility,
      message,
    };
  }

  if (message.status === "capped" || message.eligibility === "capped") {
    return {
      state: "capped",
      amount: null,
      title: "Daily AI Gold limit reached",
      text: "No Gold awarded for this battle.",
      eligibility: message.eligibility,
      message,
    };
  }

  if (message.eligibility === "short-match") {
    return {
      state: "short-match",
      amount: null,
      title: "No Gold awarded",
      text: "AI Gold requires at least 60 seconds of combat.",
      eligibility: message.eligibility,
      message,
    };
  }
  if (message.eligibility === "too-few-deploys") {
    return {
      state: "too-few-deploys",
      amount: null,
      title: "No Gold awarded",
      text: "Deploy at least 3 ordinary cards during the battle to qualify.",
      eligibility: message.eligibility,
      message,
    };
  }
  if (message.eligibility === "replay-mismatch") {
    return {
      state: "replay-mismatch",
      amount: null,
      title: "Gold reward could not be verified.",
      text: "No Gold awarded.",
      eligibility: message.eligibility,
      message,
    };
  }
  return {
    state: "refused",
    amount: null,
    title: "No Gold awarded",
    text: "No Gold awarded for this battle.",
    eligibility: message.eligibility,
    message,
  };
}

/** Descriptive alias for callers that prefer the word used by the UI. */
export const botGoldPresentation = botGoldView;
