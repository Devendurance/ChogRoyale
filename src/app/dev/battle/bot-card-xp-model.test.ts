import { describe, expect, it } from "vitest";
import type { BotCardXpMessage } from "@/lib/battle-protocol";
import {
  BOT_CARD_XP_KNOWN_CARD_IDS,
  acceptBotCardXpMessage,
  botCardXpPresentation,
  botCardXpView,
  reduceBotCardXpMessage,
  validateBotCardXpMessage,
} from "./bot-card-xp-model";

const card = (overrides: Partial<BotCardXpMessage["awardedCards"][number]> = {}) => ({
  cardId: "choglings",
  deployments: 3,
  xp: 2,
  ...overrides,
});

const message = (overrides: Partial<BotCardXpMessage> = {}): BotCardXpMessage => ({
  matchId: "fallback-match-1",
  source: "unranked-fallback",
  eligibility: "eligible",
  policyVersion: 1,
  totalXp: 2,
  status: "confirmed",
  awardedCards: [card()],
  rewardedToday: 1,
  dailyCap: 5,
  ...overrides,
});

describe("bot Card XP receipt validation", () => {
  it("accepts a matching confirmed receipt with known ordinary cards", () => {
    expect(validateBotCardXpMessage(message(), "fallback-match-1")).toMatchObject({ ok: true });
    expect(BOT_CARD_XP_KNOWN_CARD_IDS).toHaveLength(20);
  });

  it("requires the exact ended match and fallback source", () => {
    expect(validateBotCardXpMessage(message({ matchId: "other-match" }), "fallback-match-1")).toMatchObject({ ok: false, reason: "match-mismatch" });
    expect(validateBotCardXpMessage(message({ matchId: null }), "fallback-match-1")).toMatchObject({ ok: false, reason: "match-missing" });
    expect(validateBotCardXpMessage(message({ source: "practice" as never }), "fallback-match-1")).toMatchObject({ ok: false, reason: "wrong-source" });
  });

  it("pins the policy version and validates status and eligibility pairs", () => {
    expect(validateBotCardXpMessage(message({ policyVersion: 2 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-policy-version" });
    expect(validateBotCardXpMessage(message({ status: "confirmed", eligibility: "short-match", totalXp: 0, awardedCards: [] }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-status-eligibility" });
    expect(validateBotCardXpMessage(message({ status: "capped", eligibility: "eligible", totalXp: 0, awardedCards: [] }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-status-eligibility" });
    expect(validateBotCardXpMessage(message({ status: "pending", eligibility: "awaiting-gold", totalXp: 0, awardedCards: [] }), "fallback-match-1")).toMatchObject({ ok: true });
  });

  it("rejects unknown, duplicate and malformed card rows", () => {
    expect(validateBotCardXpMessage(message({ awardedCards: [card({ cardId: "fake_card" }),], totalXp: 2 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-card-id" });
    expect(validateBotCardXpMessage(message({ awardedCards: [card(), card()], totalXp: 4 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "duplicate-card-id" });
    expect(validateBotCardXpMessage(message({ awardedCards: [card({ deployments: 0 }),], totalXp: 2 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-deployments" });
    expect(validateBotCardXpMessage(message({ awardedCards: [card({ xp: -1 }),], totalXp: -1 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-total-xp" });
    expect(validateBotCardXpMessage(message({ awardedCards: [card({ xp: 3 }),], totalXp: 3 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "card-xp-cap" });
  });

  it("reconciles totals and enforces the per-match cap", () => {
    expect(validateBotCardXpMessage(message({ totalXp: 1 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "total-xp-mismatch" });
    const six = [
      card({ cardId: "choglings" }),
      card({ cardId: "chaos_archer" }),
      card({ cardId: "boulderback" }),
    ];
    expect(validateBotCardXpMessage(message({ awardedCards: six, totalXp: 6 }), "fallback-match-1")).toMatchObject({ ok: true });
    expect(validateBotCardXpMessage(message({ awardedCards: [...six, card({ cardId: "frostshell" })], totalXp: 8 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "match-xp-cap" });
  });

  it("requires daily counters to be bounded and integer-valued", () => {
    expect(validateBotCardXpMessage(message({ rewardedToday: 6 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-daily-cap" });
    expect(validateBotCardXpMessage(message({ rewardedToday: 1.5 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-rewarded-today" });
    expect(validateBotCardXpMessage(message({ dailyCap: 10 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-daily-cap" });
  });

  it("does not let non-confirmed receipts carry usable XP", () => {
    expect(validateBotCardXpMessage(message({ status: "pending", eligibility: "awaiting-gold", totalXp: 2 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-status-xp" });
    expect(validateBotCardXpMessage(message({ status: "refused", eligibility: "too-few-deploys", totalXp: 0, awardedCards: [] }), "fallback-match-1")).toMatchObject({ ok: true });
  });
});

describe("bot Card XP receipt ordering", () => {
  it("upgrades pending to confirmed and rejects a late downgrade", () => {
    const pending = message({ status: "pending", eligibility: "awaiting-gold", totalXp: 0, awardedCards: [] });
    const confirmed = message();
    const first = reduceBotCardXpMessage(null, pending, "fallback-match-1");
    expect(first).toMatchObject({ accepted: true, receipt: pending });
    const second = reduceBotCardXpMessage(first.receipt, confirmed, "fallback-match-1");
    expect(second).toMatchObject({ accepted: true, receipt: confirmed });
    expect(reduceBotCardXpMessage(second.receipt, pending, "fallback-match-1")).toMatchObject({ accepted: false, reason: "lower-priority", receipt: confirmed });
  });

  it("rejects wrong-match receipts and keeps confirmed duplicates honest", () => {
    const confirmed = message();
    expect(reduceBotCardXpMessage(confirmed, message({ matchId: "other-match" }), "fallback-match-1")).toMatchObject({ accepted: false, reason: "match-mismatch", receipt: confirmed });
    const duplicate = message({ eligibility: "duplicate" });
    expect(botCardXpView(duplicate, "fallback-match-1")).toMatchObject({ state: "duplicate", earnedXp: 2, totalXp: 2 });
    expect(acceptBotCardXpMessage(confirmed, duplicate, "fallback-match-1")).toBe(confirmed);
  });
});

describe("bot Card XP presentation", () => {
  it.each([
    [message(), "confirmed"],
    [message({ eligibility: "duplicate" }), "duplicate"],
    [message({ status: "pending", eligibility: "awaiting-gold", totalXp: 0, awardedCards: [] }), "awaiting-gold"],
    [message({ status: "capped", eligibility: "capped", totalXp: 0, awardedCards: [] }), "capped"],
    [message({ status: "refused", eligibility: "too-few-deploys", totalXp: 0, awardedCards: [] }), "too-few-deploys"],
  ] as const)("maps %s to an explicit state", (value, state) => {
    const view = botCardXpView(value, "fallback-match-1");
    expect(view.state).toBe(state);
    if (state === "confirmed" || state === "duplicate") {
      expect(view.earnedXp).toBe(value.totalXp);
      expect(view.awardedCards).toEqual(value.awardedCards);
    } else {
      expect(view.earnedXp).toBeNull();
      expect(view.awardedCards).toEqual([]);
    }
  });

  it("never fabricates XP for missing, stale or malformed receipts", () => {
    expect(botCardXpView(null, "fallback-match-1")).toMatchObject({ state: "no-message", earnedXp: null, totalXp: null });
    expect(botCardXpView(message({ matchId: "different" }), "fallback-match-1")).toMatchObject({ state: "no-message", earnedXp: null });
    expect(botCardXpView(message({ status: "pending", eligibility: "awaiting-gold", totalXp: 0, awardedCards: [] }), "fallback-match-1")).toMatchObject({ state: "awaiting-gold", earnedXp: null, totalXp: null });
  });

  it("keeps the presentation alias equivalent", () => {
    expect(botCardXpPresentation(message(), "fallback-match-1")).toEqual(botCardXpView(message(), "fallback-match-1"));
  });
});
