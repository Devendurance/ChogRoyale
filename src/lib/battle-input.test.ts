import { describe, expect, it } from "vitest";
import { ARENA_H, ARENA_W, DRAG_THRESHOLD_PX, TOUCH_LIFT_PX, aimPoint, endGesture, moveGesture, placementHint, screenToArena, startGesture, type Rect } from "@/lib/battle-input";
import { BattleSession, PRESETS, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";
import { troopDeployCheck, type PlayerIndex } from "@/lib/combat";

// Renderer's forward mapping (BattleCanvas sx/sy), expressed as a fraction of the rendered rect.
const toScreen = (x: number, y: number, rect: Rect, seat: PlayerIndex) => ({
  clientX: rect.left + (x / ARENA_W) * rect.width,
  clientY: rect.top + ((seat === 0 ? ARENA_H - y : y) / ARENA_H) * rect.height,
});

// Desktop 500x800, phone portrait FIT (343x548.8), phone landscape FIT (height-bound),
// 200% browser zoom (CSS rect halves) and a scrolled/offset fractional rect.
const RECTS: Record<string, Rect> = {
  desktop: { left: 16, top: 140, width: 500, height: 800 },
  portrait: { left: 16, top: 96, width: 343, height: 548.8 },
  landscape: { left: 292.5, top: 8, width: 222.5, height: 356 },
  zoom200: { left: 8, top: 70, width: 250, height: 400 },
  fractional: { left: 0.4, top: -233.7, width: 377.3, height: 603.68 },
};

describe("B3.1 drag input: screen to arena mapping", () => {
  it("round-trips every rendered cell for both seats across window sizes and zoom", () => {
    for (const [name, rect] of Object.entries(RECTS)) {
      for (const seat of [0, 1] as const) {
        for (let x = 0; x <= ARENA_W; x += 5) {
          for (let y = 0; y <= ARENA_H; y += 4) {
            const p = toScreen(x, y, rect, seat);
            expect(screenToArena(p.clientX, p.clientY, rect, seat), `${name} seat${seat} ${x},${y}`).toEqual({ x, y });
          }
        }
      }
    }
  });

  it("flips vertically per seat so each player's own side is at the bottom", () => {
    const r = RECTS.desktop!;
    const bottomCenter = { x: r.left + r.width / 2, y: r.top + r.height - 1 };
    expect(screenToArena(bottomCenter.x, bottomCenter.y, r, 0)).toEqual({ x: 50, y: 0 });
    expect(screenToArena(bottomCenter.x, bottomCenter.y, r, 1)).toEqual({ x: 50, y: 160 });
  });

  it("returns null off the board and for a collapsed canvas", () => {
    const r = RECTS.portrait!;
    expect(screenToArena(r.left - 1, r.top + 10, r, 0)).toBeNull();
    expect(screenToArena(r.left + 10, r.top + r.height + 1, r, 1)).toBeNull();
    expect(screenToArena(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 0)).toBeNull();
  });

  it("lifts the aim point above the finger for touch only", () => {
    expect(aimPoint({ pointerType: "touch", clientX: 100, clientY: 300 })).toEqual({ clientX: 100, clientY: 300 - TOUCH_LIFT_PX });
    expect(aimPoint({ pointerType: "mouse", clientX: 100, clientY: 300 })).toEqual({ clientX: 100, clientY: 300 });
    expect(aimPoint({ pointerType: "pen", clientX: 100, clientY: 300 })).toEqual({ clientX: 100, clientY: 300 });
  });
});

describe("B3.1 drag input: gestures", () => {
  const rect = RECTS.desktop!;
  const map = (cx: number, cy: number) => screenToArena(cx, cy, rect, 0);
  const down = { pointerId: 7, pointerType: "mouse", clientX: 100, clientY: 1000 };

  it("treats a press that never travels past the threshold as a tap", () => {
    let g = startGesture("choglings", down);
    g = moveGesture(g, { ...down, clientX: 100 + DRAG_THRESHOLD_PX - 1 })!;
    expect(g.dragging).toBe(false);
    expect(endGesture(g, down, false, map)).toEqual({ kind: "tap" });
  });

  it("deploys once at the released board point for a mouse drag", () => {
    let g = startGesture("choglings", down);
    const target = toScreen(30, 40, rect, 0);
    g = moveGesture(g, { ...down, ...target })!;
    expect(g.dragging).toBe(true);
    expect(endGesture(g, { ...down, ...target }, false, map)).toEqual({ kind: "deploy", cardId: "choglings", x: 30, y: 40 });
    // The gesture is cleared after the first end, so a following lostpointercapture is ignored.
    expect(endGesture(null, { ...down, ...target }, true, map)).toEqual({ kind: "ignore" });
  });

  it("deploys at the lifted point for a touch drag", () => {
    const touch = { ...down, pointerType: "touch" };
    const finger = toScreen(60, 30, rect, 0);
    let g = startGesture("archer", touch);
    g = moveGesture(g, { ...touch, ...finger })!;
    const end = endGesture(g, { ...touch, ...finger }, false, map);
    expect(end).toEqual({ kind: "deploy", cardId: "archer", ...map(finger.clientX, finger.clientY - TOUCH_LIFT_PX)! });
    expect(end.kind === "deploy" && end.y).toBeGreaterThan(30);
  });

  it("cancels drags released off the board and any pointercancel", () => {
    let g = startGesture("choglings", down);
    g = moveGesture(g, { ...down, clientX: 600, clientY: 1000 })!;
    expect(endGesture(g, { ...down, clientX: rect.left + rect.width + 20, clientY: 500 }, false, map)).toEqual({ kind: "cancel" });
    const onBoard = toScreen(50, 30, rect, 0);
    expect(endGesture(g, { ...down, ...onBoard }, true, map)).toEqual({ kind: "cancel" });
  });

  it("ignores samples from a different pointer", () => {
    const g = startGesture("choglings", down);
    expect(moveGesture(g, { ...down, pointerId: 8, clientX: 400 })).toBeNull();
    expect(endGesture(g, { ...down, pointerId: 8 }, false, map)).toEqual({ kind: "ignore" });
  });
});

describe("B3.1 drag input: advisory placement hints", () => {
  const SEED = "feedfacefeedfacefeedfacefeedface";
  const rng = (): SessionRandom => ({ seed: () => SEED, int: () => 0 });
  function started() {
    const s = new BattleSession(rng());
    s.join({ playerId: "pa", username: "alice" });
    s.join({ playerId: "pb", username: "bob" });
    s.setReady("pa", makeLoadout([...PRESETS.swarm!.cards], "scout"));
    s.setReady("pb", makeLoadout([...PRESETS.siege!.cards], "reaver"));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    return s;
  }
  const slotFor = (s: BattleSession, seat: PlayerIndex) => s.slotOf(s.seatOf("pa") === seat ? "pa" : "pb");

  function compareGrid(s: BattleSession, seat: PlayerIndex) {
    const start = s.startMessage(slotFor(s, seat));
    const frame = s.frame(seat);
    const troop = frame.hand.map((id) => start.catalog[id]!).find((c) => c.kind === "troop" && c.cost <= frame.energy)!;
    expect(troop).toBeTruthy();
    let mismatches = 0;
    for (let x = 0; x <= 100; x++) {
      for (let y = 0; y <= 160; y++) {
        if (placementHint(troop, { x, y }, start, frame).ok !== troopDeployCheck(s.state!.structures, seat, x, y).ok) mismatches++;
      }
    }
    return mismatches;
  }

  it("matches the engine's troop deploy check on every cell for both seats", () => {
    const s = started();
    expect(compareGrid(s, 0)).toBe(0);
    expect(compareGrid(s, 1)).toBe(0);
  });

  it("matches the engine once a fallen enemy tower opens a pocket", () => {
    const s = started();
    for (const seat of [0, 1] as const) {
      const tower = s.state!.structures.find((t) => t.structure === "tower" && t.owner !== seat && t.x < 50)!;
      tower.alive = false;
      tower.hp = 0;
    }
    expect(compareGrid(s, 0)).toBe(0);
    expect(compareGrid(s, 1)).toBe(0);
  });

  it("flags insufficient energy and allows affordable spells anywhere", () => {
    const s = started();
    const start = s.startMessage(slotFor(s, 0));
    s.state!.energy[0] = 0;
    const frame = s.frame(0);
    const card = start.catalog[frame.hand[0]!]!;
    expect(placementHint(card, { x: 50, y: 30 }, start, frame)).toEqual({ ok: false, reason: `Need ${card.cost} more energy` });
    const rich = { ...frame, energy: 10, hand: ["chaos_bolt"] };
    expect(placementHint(start.catalog.chaos_bolt ?? { id: "chaos_bolt", name: "Bolt", cost: 2, kind: "spell", air: false, radius: 8, description: "" }, { x: 50, y: 140 }, start, rich)).toEqual({ ok: true });
    expect(placementHint(start.catalog[frame.hand[0]!], { x: 50, y: 30 }, start, { ...frame, hand: [] })).toEqual({ ok: false, reason: "Card not in hand" });
  });
});
