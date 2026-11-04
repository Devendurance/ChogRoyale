import { describe, expect, it, vi } from "vitest";
import { MatchArming, type ArmingClock } from "@/server/battle/arming";

function fakeClock() {
  const timers: Array<{ fn: () => void; cleared: boolean }> = [];
  const clock: ArmingClock = {
    setTimeout: (fn) => {
      const timer = { fn, cleared: false };
      timers.push(timer);
      return { clear: () => { timer.cleared = true; } };
    },
  };
  return { clock, fire: () => { for (const t of timers) if (!t.cleared) t.fn(); } };
}

const arm = (slots: number[], timeoutMs = 1000, now?: () => number) => {
  const { clock, fire } = fakeClock();
  const onGo = vi.fn();
  const onExpired = vi.fn();
  return { arming: new MatchArming(slots, timeoutMs, clock, { onGo, onExpired }, now), onGo, onExpired, fire };
};

describe("MatchArming", () => {
  it("starts only when every required seat is ready", () => {
    const { arming, onGo } = arm([0, 1]);
    expect(arming.markReady(0)).toBe(true);
    expect(onGo).not.toHaveBeenCalled();
    expect(arming.active).toBe(true);
    arming.markReady(1);
    expect(onGo).toHaveBeenCalledOnce();
    expect(arming.active).toBe(false);
  });

  it("a repeated ready cannot satisfy a second seat", () => {
    const { arming, onGo } = arm([0, 1]);
    arming.markReady(0);
    expect(arming.markReady(0)).toBe(false);
    expect(onGo).not.toHaveBeenCalled();
  });

  it("refuses a seat outside the match", () => {
    const { arming, onGo } = arm([0]);
    expect(arming.markReady(1)).toBe(false);
    expect(onGo).not.toHaveBeenCalled();
  });

  it("expires with exactly the seats that never became ready", () => {
    const { arming, onExpired, onGo, fire } = arm([0, 1]);
    arming.markReady(1);
    fire();
    expect(onExpired).toHaveBeenCalledExactlyOnceWith([0]);
    expect(onGo).not.toHaveBeenCalled();
  });

  it("a drop clears only that seat, and it must report again", () => {
    const { arming, onGo } = arm([0, 1]);
    arming.markReady(0);
    arming.clear(0);
    arming.markReady(1);
    expect(onGo).not.toHaveBeenCalled();
    arming.markReady(0);
    expect(onGo).toHaveBeenCalledOnce();
  });

  it("a drop and return cannot extend the deadline", () => {
    let t = 0;
    const { arming, onExpired, fire } = arm([0], 1000, () => t);
    t = 400;
    arming.markReady(0);
    expect(arming.active).toBe(false);
    const late = arm([0], 1000, () => t);
    t = 900;
    late.arming.clear(0);
    expect(late.arming.remainingMs).toBe(500);
    t = 5000;
    expect(late.arming.remainingMs).toBe(0);
    late.fire();
    expect(late.onExpired).toHaveBeenCalledOnce();
    expect(onExpired).not.toHaveBeenCalled();
    fire();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("a cancelled wait fires neither handler", () => {
    const { arming, onGo, onExpired, fire } = arm([0, 1]);
    arming.cancel();
    arming.markReady(0);
    arming.markReady(1);
    fire();
    expect(onGo).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
  });
});
