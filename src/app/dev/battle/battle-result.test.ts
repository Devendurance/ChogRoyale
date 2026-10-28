import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BotGoldMessage, EndMessage, StartMessage } from "@/lib/battle-protocol";
import BattleResult from "./BattleResult";
import { finaleView, opponentNameFor, practiceDifficultyLabel, settlementView, tallyAt, UNRANKED_FALLBACK_NO_REWARDS } from "./battle-result-model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const end = (over: Partial<EndMessage> = {}): EndMessage => ({ result: "win", reason: "core", crowns: [3, 1], ticks: 890, replayIdentical: true, stateHash: "private-state-hash", commands: 12, matchId: "private-match-id", ...over });
const start = { opponent: "RivalChog", ticksPerSecond: 10, mode: "private" } as unknown as StartMessage;
const practiceStart = {
  opponent: "untrusted-bot-label",
  ticksPerSecond: 10,
  mode: "practice",
  practiceOpponent: { kind: "bot", botId: "practice-medium-v1", difficulty: "medium", displayName: "AI Opponent" },
} as StartMessage;
const fallbackStart = {
  ...practiceStart,
  practiceOpponent: { ...practiceStart.practiceOpponent!, source: "unranked-fallback" },
} as StartMessage;
const botGold = (over: Partial<BotGoldMessage> = {}): BotGoldMessage => ({
  matchId: "private-match-id",
  source: "unranked-fallback",
  eligibility: "eligible",
  policyVersion: 1,
  amount: 20,
  status: "confirmed",
  rewardedToday: 1,
  dailyCap: 5,
  ...over,
});
const render = (props: Partial<React.ComponentProps<typeof BattleResult>> = {}) =>
  renderToStaticMarkup(React.createElement(BattleResult, { start, end: end(), abort: null, settlement: null, me: 0, playerName: "MyChog", ...props }));
const renderPractice = (props: Partial<React.ComponentProps<typeof BattleResult>> = {}) =>
  renderToStaticMarkup(React.createElement(BattleResult, { start: practiceStart, end: end({ practice: { opponentKind: "bot", noReward: true } }), abort: null, settlement: { matchId: "m", status: "disabled" }, me: 0, playerName: "MyChog", ...props }));
const renderFallback = (props: Partial<React.ComponentProps<typeof BattleResult>> = {}) =>
  renderToStaticMarkup(React.createElement(BattleResult, { start: fallbackStart, end: end({ practice: { opponentKind: "bot", noReward: true, source: "unranked-fallback" } }), abort: null, settlement: { matchId: "m", status: "disabled" }, me: 0, playerName: "MyChog", ...props }));

describe("finale view model", () => {
  it("reads crowns by seat and names the winner ribbon from the server result", () => {
    expect(finaleView(end(), null, 0, null, 10)).toMatchObject({ result: "win", title: "Victory", mine: 3, theirs: 1, winner: "mine", context: "Core broken · 1:29" });
    expect(finaleView(end({ result: "loss" }), null, 1, null, 10)).toMatchObject({ title: "Defeat", mine: 1, theirs: 3, winner: "theirs" });
    expect(finaleView(end({ result: "draw", reason: "overtime", crowns: [1, 1] }), null, 0, null, 10)).toMatchObject({ title: "Draw", winner: null });
  });
  it("waits longer only when a Core kill has crowns still in flight", () => {
    expect(finaleView(end(), null, 0, null, 10).revealDelayMs).toBeGreaterThan(finaleView(end({ reason: "timeout" }), null, 0, null, 10).revealDelayMs);
    expect(finaleView(null, "left", 0, null, 10)).toMatchObject({ result: "abort", title: "Battle interrupted", context: "left", settlement: null });
  });
  it("never presents a missing or pending settlement as recorded", () => {
    expect(settlementView(null)).toEqual({ state: "waiting", text: "Waiting for result confirmation" });
    expect(settlementView({ matchId: "m", status: "pending" }).state).toBe("pending");
    expect(settlementView({ matchId: "m", status: "already-settled" }).state).toBe("recorded");
    expect(settlementView({ matchId: "m", status: "refused" }).state).toBe("refused");
    expect(settlementView({ matchId: "m", status: "disabled" }).state).toBe("disabled");
  });
  it("tallies each side up to its own final count", () => {
    expect([0, 1, 2, 3, 4].map((step) => tallyAt(step, 2))).toEqual([0, 1, 2, 2, 2]);
  });
  it("marks Practice as no-reward and suppresses PvP settlement copy", () => {
    const view = finaleView(end({ practice: { opponentKind: "bot", noReward: true } }), null, 0, { matchId: "m", status: "disabled" }, 10);
    expect(view).toMatchObject({ practice: true, result: "win", title: "Victory", kicker: "Practice complete · AI Opponent", settlement: null, noRewards: "No rewards or progression are awarded in Practice." });
    expect(opponentNameFor(practiceStart)).toBe("AI Opponent");
    expect(opponentNameFor({ ...practiceStart, practiceOpponent: undefined })).toBe("AI Opponent");
  });
  it("distinguishes an Unranked AI fallback from solo Practice", () => {
    const view = finaleView(
      end({ practice: { opponentKind: "bot", noReward: true, source: "unranked-fallback" } }),
      null,
      0,
      { matchId: "m", status: "disabled" },
      10,
      "practice",
    );
    expect(view).toMatchObject({
      origin: "unranked-fallback",
      practice: true,
      kicker: "Unranked · AI Opponent",
      settlement: null,
      noRewards: UNRANKED_FALLBACK_NO_REWARDS,
      againLabel: "Find Opponent Again",
    });
    expect(finaleView(end(), null, 0, { matchId: "m", status: "settled" }, 10, "matchmaking")).toMatchObject({
      origin: "human",
      practice: false,
      settlement: { state: "recorded", text: "Result recorded" },
      noRewards: null,
    });
  });
  it("formats only server-supported practice difficulties", () => {
    expect(practiceDifficultyLabel("medium")).toBe("Medium");
    expect(practiceDifficultyLabel("hard")).toBe("Hard");
    expect(practiceDifficultyLabel("ultimate")).toBe("Ultimate");
    expect(practiceDifficultyLabel(undefined)).toBeNull();
  });
  it.each([
    ["win", "Victory"],
    ["loss", "Defeat"],
    ["draw", "Draw"],
  ] as const)("keeps the server result visible for Practice: %s", (result, title) => {
    const view = finaleView(end({ result, practice: { opponentKind: "bot", noReward: true } }), null, 0, null, 10, "practice");
    expect(view).toMatchObject({ result, title, practice: true, noRewards: expect.any(String) });
  });
});

describe("battle finale render", () => {
  it("keeps self above the opponent for both seats and every outcome with official crown art", () => {
    for (const me of [0, 1]) for (const result of ["win", "loss", "draw"] as const) {
      const html = render({ me, end: end({ result, crowns: [3, 1] }) });
      expect(html.indexOf("chud-finale-ribbon--mine")).toBeLessThan(html.indexOf("chud-finale-ribbon--foe"));
      const mine = html.slice(html.indexOf("chud-finale-ribbon--mine"), html.indexOf("chud-finale-vs"));
      expect(mine).toContain("MyChog");
      expect(mine).toContain(`aria-label="${me === 0 ? "3 crowns" : "1 crown"}"`);
      expect(html).toContain('src="/assets/brand/v1/chog-royale-crown.webp"');
      expect(html).not.toContain("game-icon-glint");
    }
  });
  it("labels the local player, badges the winner and keeps evidence out of the markup", () => {
    const html = render();
    expect(html).toContain("Victory");
    expect(html).toMatch(/chud-finale-ribbon--mine" data-winner="true"/);
    expect(html).toMatch(/ribbon--mine" data-winner="true"><div class="chud-finale-who"><i class="chud-finale-you">You<\/i><span class="chud-finale-name" title="MyChog">MyChog<\/span><span class="chud-finale-badge">Winner<\/span>/);
    expect(html).toContain("Waiting for result confirmation");
    expect(html).toContain('aria-label="3 crowns"');
    for (const secret of ["private-state-hash", "private-match-id"]) expect(html).not.toContain(secret);
  });
  it("badges the opponent on a defeat and renders a recorded chip only from the server", () => {
    const html = render({ end: end({ result: "loss", crowns: [0, 2], reason: "crowns" }), settlement: { matchId: "m", status: "settled" } });
    expect(html).toMatch(/chud-finale-ribbon--foe" data-winner="true"/);
    expect(html).toContain('data-state="recorded"');
    expect(html).toContain("Crown lead");
  });
  it("shows only the You tag while the own name is unknown, never a borrowed name", () => {
    const html = render({ playerName: undefined });
    expect(html).toMatch(/<i class="chud-finale-you">You<\/i><span class="chud-finale-badge">Winner<\/span>/);
    expect(html.match(/chud-finale-name/g)).toHaveLength(1);
  });
  it("shows an interrupted battle without a scoreboard or settlement line", () => {
    const html = render({ end: null, abort: "Your opponent left." });
    expect(html).toContain("Battle interrupted");
    expect(html).toContain("Your opponent left.");
    expect(html).not.toContain("chud-finale-versus");
    expect(html).not.toContain("result confirmation");
  });
  it("renders Practice as AI Opponent with explicit no-reward copy and replay controls", () => {
    const html = renderPractice();
    expect(html).toContain("Practice complete");
    expect(html).toContain("Victory");
    expect(html).toContain("AI Opponent");
    expect(html).toContain("No rewards or progression are awarded in Practice.");
    expect(html).not.toContain("untrusted-bot-label");
    expect(html).not.toContain("Result recording is unavailable");
    expect(html).toContain(">Battle Again <");
    expect(html).not.toContain("Find Opponent Again");
    expect(html).toContain(">Back to Battle Hall <");
  });
  it("renders fallback provenance and only offers Find Opponent Again through the existing callback", () => {
    const withoutCallback = renderFallback();
    expect(withoutCallback).toContain("Unranked · AI Opponent");
    expect(withoutCallback).toContain("No AI Gold reward confirmed.");
    expect(withoutCallback).toContain("AI Opponent · Medium difficulty");
    expect(withoutCallback).not.toContain("Result recording is unavailable");
    expect(withoutCallback).not.toContain("Find Opponent Again");

    const withCallback = renderFallback({ onAgain: () => {} });
    expect(withCallback).toContain(">Find Opponent Again <");
    expect(withCallback).toContain(">Back to Battle Hall <");
  });
  it("renders only a server-confirmed fallback Gold reward and balance", () => {
    const html = renderFallback({ botGold: botGold(), goldBalance: 120 });
    expect(html).toContain("Gold earned");
    expect(html).toContain("+20 Gold earned");
    expect(html).toContain("Daily AI rewards: 1 / 5");
    expect(html).toContain("Gold balance: 120");
    expect(html).toContain('data-state="confirmed"');
  });
  it("marks duplicate confirmed Gold without presenting a second payout", () => {
    const html = renderFallback({ botGold: botGold({ eligibility: "duplicate", amount: 10, rewardedToday: 4 }) });
    expect(html).toContain("+10 Gold earned");
    expect(html).toContain("Already recorded for this battle.");
    expect(html).toContain("Daily AI rewards: 4 / 5");
  });
  it("keeps pending fallback Gold separate from a confirmed amount", () => {
    const html = renderFallback({ botGold: botGold({ status: "pending", eligibility: "eligible", amount: 0 }) });
    expect(html).toContain("Gold reward verification pending");
    expect(html).toContain("Check your Gold balance later.");
    expect(html).not.toContain("+20 Gold earned");
    expect(html).toContain('data-state="pending"');
  });
  it.each([
    ["capped", "capped", "No Gold awarded for this battle.", "capped"],
    ["short-match", "refused", "AI Gold requires at least 60 seconds of combat.", "short-match"],
    ["too-few-deploys", "refused", "Deploy at least 3 ordinary cards during the battle to qualify.", "too-few-deploys"],
    ["replay-mismatch", "refused", "No Gold awarded.", "replay-mismatch"],
  ] as const)("renders the authoritative fallback refusal state: %s", (eligibility, status, copy, state) => {
    const html = renderFallback({ botGold: botGold({ eligibility, status, amount: 0 }) });
    expect(html).toContain(copy);
    expect(html).toContain(`data-state="${state}"`);
    expect(html).not.toContain("Gold earned");
  });
  it("keeps no-message fallback, Practice, and PvP reward presentation safe", () => {
    const fallback = renderFallback();
    expect(fallback).toContain("No AI Gold reward confirmed.");
    expect(fallback).toContain('data-state="no-rewards"');

    const practice = renderPractice({ botGold: botGold() });
    expect(practice).toContain("No rewards or progression are awarded in Practice.");
    expect(practice).not.toContain("Gold earned");

    const pvp = render({ botGold: botGold(), goldBalance: 120 });
    expect(pvp).toContain("Waiting for result confirmation");
    expect(pvp).not.toContain("Gold earned");
    expect(pvp).not.toContain("Balance 120");
  });
  it.each([
    ["medium", "Medium"],
    ["hard", "Hard"],
    ["ultimate", "Ultimate"],
  ] as const)("renders the authoritative %s difficulty in the result", (difficulty, label) => {
    const html = renderPractice({
      start: { ...practiceStart, practiceOpponent: { ...practiceStart.practiceOpponent!, difficulty } },
    });
    expect(html).toContain(`AI Opponent · ${label} difficulty`);
    expect(html).toContain(`data-difficulty="${difficulty}"`);
  });
  it("keeps the AI label and no-reward state when difficulty is missing", () => {
    const html = renderPractice({ start: { ...practiceStart, practiceOpponent: undefined } });
    expect(html).toContain("AI Opponent");
    expect(html).toContain("No rewards or progression are awarded in Practice.");
    expect(html).toContain('data-difficulty="unknown"');
    expect(html).not.toContain("Medium difficulty");
  });
});
