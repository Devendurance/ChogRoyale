import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EndMessage, StartMessage } from "@/lib/battle-protocol";
import BattleResult from "./BattleResult";
import { finaleView, settlementView, tallyAt } from "./battle-result-model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const end = (over: Partial<EndMessage> = {}): EndMessage => ({ result: "win", reason: "core", crowns: [3, 1], ticks: 890, replayIdentical: true, stateHash: "private-state-hash", commands: 12, matchId: "private-match-id", ...over });
const start = { opponent: "RivalChog", ticksPerSecond: 10, mode: "private" } as unknown as StartMessage;
const render = (props: Partial<React.ComponentProps<typeof BattleResult>> = {}) =>
  renderToStaticMarkup(React.createElement(BattleResult, { start, end: end(), abort: null, settlement: null, me: 0, playerName: "MyChog", ...props }));

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
});

describe("battle finale render", () => {
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
});
