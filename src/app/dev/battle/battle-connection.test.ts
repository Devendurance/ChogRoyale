import { describe, expect, it, vi } from "vitest";
import { attachOwnedRoom, createRoomOwner, leaveRoom } from "./battle-connection";
import { matchArming } from "./hud-view";

class FakeRoom {
  handlers = new Map<string, (m: unknown) => void>();
  closes: Array<(code: number) => void> = [];
  onMessage(type: string, handler: (m: unknown) => void) {
    this.handlers.set(type, handler);
  }
  onLeave(handler: (code: number) => void) {
    this.closes.push(handler);
  }
  deliver(type: string, message: unknown) {
    this.handlers.get(type)?.(message);
  }
  close(code = 4000) {
    for (const handler of this.closes) handler(code);
  }
}

describe("battle room ownership", () => {
  it("ignores a finished room's late close once a new room owns the session", () => {
    const owner = createRoomOwner<FakeRoom>();
    const finished = new FakeRoom();
    const next = new FakeRoom();
    const stage: string[] = [];
    const cleanup = vi.fn();
    attachOwnedRoom(finished, owner).onClose(() => stage.push("closed"), cleanup);
    attachOwnedRoom(next, owner).onClose(() => stage.push("next closed"));
    finished.close();
    expect(stage).toEqual([]);
    expect(cleanup).toHaveBeenCalledOnce();
    next.close();
    expect(stage).toEqual(["next closed"]);
  });

  it("ignores a late close after a reset released the session", () => {
    const owner = createRoomOwner<FakeRoom>();
    const finished = new FakeRoom();
    const stage: string[] = [];
    attachOwnedRoom(finished, owner).onClose(() => stage.push("closed"));
    owner.release();
    finished.close();
    expect(stage).toEqual([]);
  });

  it("still reports a real drop of the current room exactly once", () => {
    const owner = createRoomOwner<FakeRoom>();
    const room = new FakeRoom();
    const codes: number[] = [];
    attachOwnedRoom(room, owner).onClose((code) => codes.push(code));
    room.close(1006);
    room.close(1006);
    expect(codes).toEqual([1006]);
  });

  it("drops late frames from a replaced room", () => {
    const owner = createRoomOwner<FakeRoom>();
    const old = new FakeRoom();
    const next = new FakeRoom();
    const frames: number[] = [];
    attachOwnedRoom(old, owner).on<number>("frame", (tick) => frames.push(tick));
    old.deliver("frame", 900);
    attachOwnedRoom(next, owner).on<number>("frame", (tick) => frames.push(tick));
    old.deliver("frame", 901);
    next.deliver("frame", 1);
    expect(frames).toEqual([900, 1]);
  });

  it("releasing a replaced room does not disown its successor", () => {
    const owner = createRoomOwner<FakeRoom>();
    const old = new FakeRoom();
    const next = new FakeRoom();
    owner.claim(old);
    owner.claim(next);
    owner.release(old);
    expect(owner.owns(next)).toBe(true);
  });

  it("leaves once and swallows a dead socket", async () => {
    const leave = vi.fn(() => Promise.reject(new Error("socket closed")));
    const room = { leave };
    leaveRoom(room);
    leaveRoom(room);
    leaveRoom(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(leave).toHaveBeenCalledOnce();
  });
});

describe("matchArming", () => {
  const end = { result: "win" } as never;
  it("holds only while the server has not produced tick 1", () => {
    const start = { arming: { timeoutMs: 1000 } };
    expect(matchArming(start, null, null, null)).toBe(true);
    expect(matchArming(start, { tick: 0 }, null, null)).toBe(true);
    expect(matchArming(start, { tick: 1 }, null, null)).toBe(false);
  });
  it("never holds for a server without arming, a finished match or an abort", () => {
    expect(matchArming({}, null, null, null)).toBe(false);
    expect(matchArming(null, null, null, null)).toBe(false);
    expect(matchArming({ arming: { timeoutMs: 1 } }, null, end, null)).toBe(false);
    expect(matchArming({ arming: { timeoutMs: 1 } }, null, null, "aborted")).toBe(false);
  });
});
