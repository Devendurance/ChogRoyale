// B3.1 battle input helpers. Client-safe and pure: screen-to-arena mapping,
// drag gesture state and advisory placement hints. Hints only shape the UI.
// The server validates every deploy and its ack is the only verdict.

import type { BattleFrame, CardInfo, Seat, StartMessage } from "./battle-protocol";

export const ARENA_W = 100;
export const ARENA_H = 160;
/** Pointer travel (CSS px) before a press on a card becomes a drag. */
export const DRAG_THRESHOLD_PX = 8;
/** Touch drags aim this far (CSS px) above the finger so it doesn't cover the ghost. */
export const TOUCH_LIFT_PX = 44;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ArenaPoint {
  x: number;
  y: number;
}
export interface PointerSample {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Maps a viewport point onto arena cells using the canvas's rendered rect, so
 * CSS scaling, browser zoom and device pixel ratio cancel out. Seat 0 views the
 * board flipped vertically (own side at the bottom), matching the renderer.
 * Returns null when the point is off the board.
 */
export function screenToArena(clientX: number, clientY: number, rect: Rect, seat: Seat): ArenaPoint | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
  const sy = fy * ARENA_H;
  return { x: clamp(Math.round(fx * ARENA_W), 0, ARENA_W), y: clamp(Math.round(seat === 0 ? ARENA_H - sy : sy), 0, ARENA_H) };
}

/** The point a drag aims at: lifted above the finger for touch, exact for mouse and pen. */
export function aimPoint(p: Pick<PointerSample, "pointerType" | "clientX" | "clientY">): { clientX: number; clientY: number } {
  return { clientX: p.clientX, clientY: p.clientY - (p.pointerType === "touch" ? TOUCH_LIFT_PX : 0) };
}

export interface Gesture {
  cardId: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  dragging: boolean;
}

export function startGesture(cardId: string, p: PointerSample): Gesture {
  return { cardId, pointerId: p.pointerId, pointerType: p.pointerType, startX: p.clientX, startY: p.clientY, dragging: false };
}

/** Returns the updated gesture, or null when the sample belongs to another pointer. */
export function moveGesture(g: Gesture | null, p: PointerSample): Gesture | null {
  if (!g || g.pointerId !== p.pointerId) return null;
  if (g.dragging || Math.hypot(p.clientX - g.startX, p.clientY - g.startY) < DRAG_THRESHOLD_PX) return g;
  return { ...g, dragging: true };
}

export type GestureEnd = { kind: "ignore" } | { kind: "tap" } | { kind: "cancel" } | { kind: "deploy"; cardId: string; x: number; y: number };

/**
 * Resolves a released or cancelled gesture. A press that never became a drag
 * is a tap (the card's click toggles selection). A drag released off the
 * board, or any cancelled drag, sends nothing.
 */
export function endGesture(g: Gesture | null, p: PointerSample, cancelled: boolean, toArena: (clientX: number, clientY: number) => ArenaPoint | null): GestureEnd {
  if (!g || g.pointerId !== p.pointerId) return { kind: "ignore" };
  if (!g.dragging) return cancelled ? { kind: "cancel" } : { kind: "tap" };
  if (cancelled) return { kind: "cancel" };
  const aim = aimPoint({ ...p, pointerType: g.pointerType });
  const at = toArena(aim.clientX, aim.clientY);
  return at ? { kind: "deploy", cardId: g.cardId, x: at.x, y: at.y } : { kind: "cancel" };
}

export interface ArenaRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Own territory plus pockets opened by fallen enemy towers, for highlighting. */
export function deployZones(start: StartMessage, frame: BattleFrame): ArenaRect[] {
  const { river, deploy, ownTerritory } = start.geometry;
  const seat = start.seat;
  const zones: ArenaRect[] = [{ minX: deploy.minX, maxX: deploy.maxX, ...ownTerritory }];
  const rows = seat === 0 ? { minY: river.maxY + 1, maxY: river.maxY + deploy.pocketDepth } : { minY: river.minY - deploy.pocketDepth, maxY: river.minY - 1 };
  const split = deploy.laneSplitX;
  const down = (left: boolean) => frame.structures.some((s) => s.kind === "tower" && s.owner !== seat && !s.alive && (left ? s.x < split : s.x > split));
  if (down(true)) zones.push({ minX: deploy.minX, maxX: split - 1, ...rows });
  if (down(false)) zones.push({ minX: split + 1, maxX: deploy.maxX, ...rows });
  return zones;
}

export type PlacementHint = { ok: true } | { ok: false; reason: string };

/** Advisory mirror of the engine's deploy checks. Never authoritative. */
export function placementHint(card: CardInfo | undefined, at: ArenaPoint, start: StartMessage, frame: BattleFrame): PlacementHint {
  if (!card || !frame.hand.includes(card.id)) return { ok: false, reason: "Card not in hand" };
  if (card.cost > frame.energy) return { ok: false, reason: `Need ${card.cost - frame.energy} more energy` };
  if (card.kind === "spell") return { ok: true };
  if (card.kind === "commander" && frame.commanders.some((c) => c.owner === start.seat)) return { ok: false, reason: "Commander already deployed" };
  const { river, deploy } = start.geometry;
  if (at.x < deploy.minX || at.x > deploy.maxX) return { ok: false, reason: "Outside arena territory" };
  if (at.y >= river.minY && at.y <= river.maxY) return { ok: false, reason: "On river or bridge" };
  const solids = [
    ...frame.structures.filter((s) => s.alive).map((s) => ({ x: s.x, y: s.y, r: s.kind === "core" ? 4 : 3 })),
    ...frame.buildings.map((b) => ({ x: b.x, y: b.y, r: b.footprint })),
  ];
  if (solids.some((s) => Math.abs(at.x - s.x) <= s.r + 2 && Math.abs(at.y - s.y) <= s.r + 2)) return { ok: false, reason: "On a structure" };
  const inZone = deployZones(start, frame).some((z) => at.x >= z.minX && at.x <= z.maxX && at.y >= z.minY && at.y <= z.maxY);
  return inZone ? { ok: true } : { ok: false, reason: "Outside your territory" };
}
