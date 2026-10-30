import { describe, expect, it } from "vitest";

import type { AccountXpMessage } from "@/lib/battle-protocol";
import { ACCOUNT_XP_POLICY_VERSION } from "@/lib/account-xp";
import {
  acceptAccountXpReward,
  accountXpLevelUpKey,
  accountXpRewardPresentation,
  accountXpRewardView,
  consumeAccountXpLevelUp,
  isNewAccountXpLevelUp,
  markAccountXpLevelUpSeen,
  reduceAccountXpReward,
  validateAccountXpMessage,
  validateAccountXpReceiptForContext,
  validateAccountXpReward,
} from "./account-xp-reward-model";

const receipt = (overrides: Partial<AccountXpMessage> = {}): AccountXpMessage => ({
  matchId: "match-1",
  source: "matchmaking",
  policyVersion: ACCOUNT_XP_POLICY_VERSION,
  status: "confirmed",
  eligibility: "eligible",
  result: "win",
  amount: 100,
  playerId: "player-1",
  totalXp: 325,
  levelBefore: 2,
  levelAfter: 3,
  leveledUp: true,
  ...overrides,
});

const context = {
  matchId: "match-1",
  source: "matchmaking" as const,
  playerId: "player-1",
  policyVersion: ACCOUNT_XP_POLICY_VERSION,
};

describe("Account XP battle receipt validation", () => {
  it("reuses the strict receipt validator and applies active match context", () => {
    expect(validateAccountXpReward(receipt(), context)).toMatchObject({ ok: true, receipt: receipt() });
    expect(validateAccountXpMessage(receipt(), context)).toMatchObject({ ok: true });
    expect(validateAccountXpReceiptForContext(receipt(), context)).toMatchObject({ ok: true });
    expect(validateAccountXpReward(receipt({ levelAfter: 101 }), context)).toMatchObject({ ok: false, reason: "bad-level-snapshot" });
  });

  it.each([
    ["match", { matchId: "other-match" }, "match-mismatch"],
    ["source", { source: "unranked-fallback" }, "source-mismatch"],
    ["player", { playerId: "other-player" }, "player-mismatch"],
    ["policy", { policyVersion: 99 }, "policy-mismatch"],
  ] as const)("rejects a contextual %s mismatch", (_label, mismatch, reason) => {
    expect(validateAccountXpReward(receipt(), { ...context, ...mismatch })).toMatchObject({ ok: false, reason });
  });

  it("preserves structural failures from validateAccountXpReceipt", () => {
    expect(validateAccountXpReward({ ...receipt(), status: "pending", amount: 1, result: null, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }, context)).toMatchObject({ ok: false, reason: "unconfirmed-amount" });
    expect(validateAccountXpReward({ ...receipt(), policyVersion: 99 }, context)).toMatchObject({ ok: false, reason: "bad-policy-version" });
  });
});

describe("Account XP receipt ordering", () => {
  it("accepts pending, upgrades to confirmed, and ignores a late pending retry", () => {
    const pending = receipt({
      status: "pending",
      eligibility: "unknown",
      result: null,
      amount: 0,
      totalXp: null,
      levelBefore: null,
      levelAfter: null,
      leveledUp: null,
    });
    const first = reduceAccountXpReward(null, pending, context);
    expect(first).toMatchObject({ accepted: true, receipt: pending });

    const confirmed = reduceAccountXpReward(first.receipt, receipt(), context);
    expect(confirmed).toMatchObject({ accepted: true, receipt: receipt() });

    const late = reduceAccountXpReward(confirmed.receipt, pending, context);
    expect(late).toMatchObject({ accepted: false, reason: "lower-priority", receipt: receipt() });
  });

  it("accepts a terminal cap over pending but never over confirmed", () => {
    const pending = receipt({
      status: "pending",
      eligibility: "unknown",
      result: null,
      amount: 0,
      totalXp: null,
      levelBefore: null,
      levelAfter: null,
      leveledUp: null,
    });
    const capped = receipt({
      status: "capped",
      eligibility: "capped",
      result: "win",
      amount: 0,
      totalXp: null,
      levelBefore: null,
      levelAfter: null,
      leveledUp: null,
    });
    const accepted = reduceAccountXpReward(null, pending, context);
    const terminal = reduceAccountXpReward(accepted.receipt, capped, context);
    expect(terminal).toMatchObject({ accepted: true, receipt: capped });
    expect(reduceAccountXpReward(receipt(), capped, context)).toMatchObject({ accepted: false, reason: "lower-priority", receipt: receipt() });
  });

  it("keeps duplicate terminal receipts stable and isolates another match", () => {
    const first = acceptAccountXpReward(null, receipt(), context);
    expect(acceptAccountXpReward(first, receipt({ amount: 0, eligibility: "duplicate" }), context)).toBe(first);
    expect(acceptAccountXpReward(first, receipt({ matchId: "other-match" }), context)).toBe(first);
  });
});

describe("Account XP reward presentation", () => {
  it.each([
    [receipt(), "confirmed", "Account XP earned"],
    [receipt({ eligibility: "duplicate" }), "duplicate", "Account XP already recorded"],
    [receipt({ status: "pending", eligibility: "unknown", result: null, amount: 0, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }), "pending", "Account XP verification pending"],
    [receipt({ status: "pending", eligibility: "awaiting-gold", result: null, amount: 0, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }), "awaiting-gold", "Account XP verification pending"],
    [receipt({ status: "capped", eligibility: "capped", amount: 0, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }), "capped", "Daily Account XP limit reached"],
    [receipt({ status: "refused", eligibility: "short-match", amount: 0, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }), "short-match", "No Account XP awarded"],
    [receipt({ status: "refused", eligibility: "practice-earns-zero", amount: 0, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }), "practice-earns-zero", "No Account XP awarded"],
  ] as const)("maps server receipt to state %s", (value, state, title) => {
    const view = accountXpRewardView(value, context);
    expect(view).toMatchObject({ state, title, eligibility: value.eligibility });
    if (state === "confirmed" || state === "duplicate") expect(view.earnedXp).toBe(value.amount);
    else expect(view.earnedXp).toBeNull();
  });

  it("never fabricates a reward when no receipt or context match exists", () => {
    expect(accountXpRewardView(null, context)).toMatchObject({ state: "no-message", earnedXp: null, levelUpKey: null });
    expect(accountXpRewardView(receipt({ matchId: "other-match" }), context)).toMatchObject({ state: "no-message", amount: null });
    expect(accountXpRewardPresentation(receipt(), context)).toEqual(accountXpRewardView(receipt(), context));
  });
});

describe("Account XP level-up dedupe", () => {
  it("keys only confirmed server-proven transitions", () => {
    expect(accountXpLevelUpKey(receipt(), context)).toBe("player-1:match-1:2->3");
    expect(accountXpLevelUpKey(receipt({ leveledUp: false }), context)).toBeNull();
    expect(accountXpLevelUpKey(receipt({ status: "pending", eligibility: "unknown", result: null, amount: 0, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }), context)).toBeNull();
  });

  it("consumes one crossing and suppresses duplicate delivery", () => {
    const seen = new Set<string>();
    expect(isNewAccountXpLevelUp(receipt(), seen, context)).toBe(true);
    expect(markAccountXpLevelUpSeen(receipt(), seen, context)).toBe(true);
    expect(isNewAccountXpLevelUp(receipt(), seen, context)).toBe(false);
    expect(markAccountXpLevelUpSeen(receipt(), seen, context)).toBe(false);
    expect(consumeAccountXpLevelUp(receipt({ matchId: "match-2" }), seen, { ...context, matchId: "match-2" })).toBe(true);
    expect(seen.size).toBe(2);
  });
});
