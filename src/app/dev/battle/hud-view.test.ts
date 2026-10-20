import { describe, expect, it } from "vitest";
import { abilityView, scoreView, timerView } from "./hud-view";
import type { AbilityView, BattleFrame, EndMessage } from "@/lib/battle-protocol";

const frame = (over: Partial<BattleFrame>): BattleFrame =>
  ({
    tick: 100,
    phase: "active",
    clockTicks: 900,
    crowns: [0, 0],
    chaos: [],
    troops: [],
    commanders: [],
    structures: [],
    buildings: [],
    projectiles: [],
    impacts: [],
    events: [],
    ...over,
  }) as BattleFrame;

const end = (over: Partial<EndMessage>): EndMessage =>
  ({ result: "win", reason: "towers", crowns: [3, 1], ticks: 1450, ...over }) as EndMessage;

describe("scoreView", () => {
  it("maps crowns by perspective for both seats", () => {
    const f = frame({ crowns: [2, 1] });
    expect(scoreView(f, null, 0)).toEqual({ mine: 2, theirs: 1 });
    expect(scoreView(f, null, 1)).toEqual({ mine: 1, theirs: 2 });
  });
  it("prefers end.crowns over the frame once ended", () => {
    expect(scoreView(frame({ crowns: [1, 1] }), end({ crowns: [3, 0] }), 0)).toEqual({ mine: 3, theirs: 0 });
    expect(scoreView(frame({ crowns: [1, 1] }), end({ crowns: [3, 0] }), 1)).toEqual({ mine: 0, theirs: 3 });
  });
  it("defaults to zero crowns without a frame", () => {
    expect(scoreView(null, null, 0)).toEqual({ mine: 0, theirs: 0 });
  });
});

describe("timerView", () => {
  it("shows mm:ss remaining in regulation", () => {
    const v = timerView(frame({ clockTicks: 900, phase: "active", tick: 900 }), null);
    expect(v.text).toBe("1:30");
    expect(v.badge).toBeNull();
    expect(v.mult).toBe(1);
  });
  it("badges 2x and 3x phases via the mult field", () => {
    // The badge mirrors the EnergyMeter convention: phaseMult(tick + 1),
    // so the upcoming multiplier shows one tick early.
    expect(timerView(frame({ tick: 1198 }), null).mult).toBe(1);
    expect(timerView(frame({ tick: 1199 }), null).mult).toBe(2);
    expect(timerView(frame({ tick: 2399 }), null).mult).toBe(3);
  });
  it("shows OT in overtime and Final once ended", () => {
    expect(timerView(frame({ phase: "overtime", clockTicks: 300 }), null)).toMatchObject({ text: "0:30", badge: "OT" });
    expect(timerView(frame({}), end({ ticks: 1500 })).badge).toBe("Final");
    expect(timerView(null, end({ ticks: 1500 })).text).toBe("2:30");
  });
});

describe("abilityView", () => {
  const ab = (over: Partial<AbilityView>): AbilityView =>
    ({ abilityId: "scout-shadow-step", cost: 1, readyAt: 0, cooldownTicks: 160, activeUntil: null, ready: true, blockedBy: null, ...over }) as AbilityView;

  it("READY when ready and unblocked", () => {
    expect(abilityView(ab({}), 100)).toMatchObject({ label: "READY", cooldownFrac: 0, disabled: false, blockedBy: null });
  });
  it("cooldown fraction from remaining ticks", () => {
    const v = abilityView(ab({ ready: false, readyAt: 180 }), 100);
    expect(v.label).toBe("COOLDOWN");
    expect(v.cooldownFrac).toBeCloseTo(80 / 160, 5);
    expect(v.cooldownSecs).toBe(8);
    expect(v.disabled).toBe(true);
  });
  it("blocked shows the reason and disables", () => {
    const v = abilityView(ab({ blockedBy: "Insufficient energy" }), 100);
    expect(v.label).toBe("BLOCKED");
    expect(v.blockedBy).toBe("Insufficient energy");
    expect(v.disabled).toBe(true);
  });
  it("active effect reads ACTIVE and disables", () => {
    expect(abilityView(ab({ activeUntil: 150 }), 100).label).toBe("ACTIVE");
    expect(abilityView(ab({ activeUntil: 100 }), 100).label).toBe("READY");
  });
});
