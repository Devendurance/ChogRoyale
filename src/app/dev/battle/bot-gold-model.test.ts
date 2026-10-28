import { describe, expect, it } from "vitest";
import type { BotGoldMessage } from "@/lib/battle-protocol";
import {
  acceptBotGoldMessage,
  botGoldPresentation,
  botGoldView,
  reduceBotGoldMessage,
  validateBotGoldMessage,
} from "./bot-gold-model";

const message = (overrides: Partial<BotGoldMessage> = {}): BotGoldMessage => ({
  matchId: "fallback-match-1",
  source: "unranked-fallback",
  eligibility: "eligible",
  policyVersion: 1,
  amount: 20,
  status: "confirmed",
  rewardedToday: 1,
  dailyCap: 5,
  ...overrides,
});
describe("bot Gold message validation", () => {
  it("accepts only a matching Unranked fallback message", () => {
    expect(validateBotGoldMessage(message(), "fallback-match-1")).toMatchObject({ ok: true });
    expect(validateBotGoldMessage(message({ matchId: "other-match" }), "fallback-match-1")).toMatchObject({ ok: false, reason: "match-mismatch" });
    expect(validateBotGoldMessage(message({ source: "unranked-fallback" as const }), "fallback-match-1")).toMatchObject({ ok: true });
    expect(validateBotGoldMessage(message({ source: "wrong-source" as never }), "fallback-match-1")).toMatchObject({ ok: false, reason: "wrong-source" });
  });

  it("requires a non-negative server amount and zero for unconfirmed outcomes", () => {
    expect(validateBotGoldMessage(message({ status: "pending", amount: 20 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-status-amount" });
    expect(validateBotGoldMessage(message({ status: "confirmed", amount: 0 }), "fallback-match-1")).toMatchObject({ ok: true });
    expect(validateBotGoldMessage(message({ status: "confirmed", amount: -1 }), "fallback-match-1")).toMatchObject({ ok: false, reason: "invalid-amount" });
    expect(validateBotGoldMessage(message({ status: "capped", eligibility: "capped", amount: 0 }), "fallback-match-1")).toMatchObject({ ok: true });
  });
});
describe("bot Gold receipt ordering", () => {
  it("accepts a pending receipt, upgrades it to confirmed, and ignores a late pending replay", () => {
    const pending = message({ status: "pending", amount: 0, eligibility: "replay-mismatch" });
    const confirmed = message({ status: "confirmed", amount: 20, eligibility: "eligible" });
    const first = reduceBotGoldMessage(null, pending, "fallback-match-1");
    expect(first).toMatchObject({ accepted: true, receipt: pending });
    const second = reduceBotGoldMessage(first.receipt, confirmed, "fallback-match-1");
    expect(second).toMatchObject({ accepted: true, receipt: confirmed });
    const late = reduceBotGoldMessage(second.receipt, pending, "fallback-match-1");
    expect(late).toMatchObject({ accepted: false, receipt: confirmed, reason: "lower-priority" });
  });

  it("keeps duplicate terminal messages idempotent and rejects another match", () => {
    const confirmed = message();
    expect(acceptBotGoldMessage(confirmed, { ...confirmed }, "fallback-match-1")).toBe(confirmed);
    expect(acceptBotGoldMessage(confirmed, message({ matchId: "other-match" }), "fallback-match-1")).toBe(confirmed);
  });
});

describe("bot Gold presentation", () => {
  it.each([
    [message(), "confirmed", "Gold earned"],
    [message({ eligibility: "duplicate" }), "duplicate", "Gold earned"],
    [message({ status: "pending", amount: 0, eligibility: "eligible" }), "pending", "Gold reward verification pending"],
    [message({ status: "capped", amount: 0, eligibility: "capped" }), "capped", "Daily AI Gold limit reached"],
    [message({ status: "refused", amount: 0, eligibility: "short-match" }), "short-match", "No Gold awarded"],
    [message({ status: "refused", amount: 0, eligibility: "too-few-deploys" }), "too-few-deploys", "No Gold awarded"],
    [message({ status: "refused", amount: 0, eligibility: "replay-mismatch" }), "replay-mismatch", "Gold reward could not be verified."],
    [message({ status: "refused", amount: 0, eligibility: "eligible" }), "refused", "No Gold awarded"],
  ] as const)("maps %s to honest copy", (value, state, title) => {
    const view = botGoldView(value, "fallback-match-1");
    expect(view).toMatchObject({ state, title, eligibility: value.eligibility });
    if (state === "confirmed" || state === "duplicate") expect(view.amount).toBe(value.amount);
    else expect(view.amount).toBeNull();
  });

  it("uses an explicit no-message fallback and never fabricates Gold", () => {
    expect(botGoldView(null, "fallback-match-1")).toMatchObject({ state: "no-message", amount: null, title: "Gold reward" });
    expect(botGoldView(undefined, "fallback-match-1").text).toContain("No AI Gold reward confirmed");
    expect(botGoldView(message({ matchId: "different", status: "confirmed", amount: 999 }), "fallback-match-1")).toMatchObject({ state: "no-message", amount: null });
  });

  it("keeps the presentation alias equivalent", () => {
    expect(botGoldPresentation(message(), "fallback-match-1")).toEqual(botGoldView(message(), "fallback-match-1"));
  });
});
