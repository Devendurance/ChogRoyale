// Client-only battle camera composition. The Phaser canvas fills the whole
// battle stage and draws one continuous world; the authoritative 100x160 board
// (500x800 board px) is placed inside it by this pure layout. Gameplay
// coordinates never change: only where the board lands on screen.

import type { ArenaPoint, Rect } from "./battle-input";
import { ARENA_H, ARENA_W } from "./battle-input";
import type { Seat } from "./battle-protocol";

export const BOARD_PX_W = 500;
export const BOARD_PX_H = 800;

/** Stage areas (CSS px) covered by overlaid controls. The world still renders
 * under them; the board is fitted into what remains so play is never hidden. */
export interface WorldInsets {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

/** Board placement in stage CSS px. `scale` is CSS px per board px. */
export interface BoardLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

const finite = (v: number | undefined, fallback = 0) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : fallback);

/**
 * Fits the complete board, at its true 5:8 aspect, inside the stage minus the
 * insets, then centres it in that free area. The stage itself is not resized:
 * everything around the board is rendered world, never page chrome.
 */
export function boardLayout(stageW: number, stageH: number, insets: WorldInsets = { top: 0, bottom: 0 }): BoardLayout {
  const w = finite(stageW, BOARD_PX_W);
  const h = finite(stageH, BOARD_PX_H);
  const top = Math.min(finite(insets.top), h * 0.4);
  const bottom = Math.min(finite(insets.bottom), h * 0.45);
  const left = Math.min(finite(insets.left), w * 0.3);
  const right = Math.min(finite(insets.right), w * 0.3);
  const availW = Math.max(1, w - left - right);
  const availH = Math.max(1, h - top - bottom);
  const scale = Math.min(availW / BOARD_PX_W, availH / BOARD_PX_H);
  const width = BOARD_PX_W * scale;
  const height = BOARD_PX_H * scale;
  return { left: left + (availW - width) / 2, top: top + (availH - height) / 2, width, height, scale };
}

/** The board's client rect, given the canvas's client rect and the stage size
 * the layout was computed for. CSS zoom or transforms scale both together. */
export function boardClientRect(layout: BoardLayout, canvasRect: Rect, stageW: number, stageH: number): Rect {
  const kx = stageW > 0 ? canvasRect.width / stageW : 1;
  const ky = stageH > 0 ? canvasRect.height / stageH : 1;
  return { left: canvasRect.left + layout.left * kx, top: canvasRect.top + layout.top * ky, width: layout.width * kx, height: layout.height * ky };
}

/** Phaser camera for a layout: zoom in canvas px per board px and the board
 * point that sits at the canvas centre. `resolution` is canvas px per CSS px. */
export function cameraFor(layout: BoardLayout, stageW: number, stageH: number, resolution: number) {
  return {
    zoom: layout.scale * resolution,
    centerX: (stageW / 2 - layout.left) / layout.scale,
    centerY: (stageH / 2 - layout.top) / layout.scale,
  };
}

/** Canvas backing resolution: device pixels, capped so a large tablet canvas
 * stays within a sane fill budget. */
export function canvasResolution(stageW: number, stageH: number, dpr: number, maxPixels = 4_200_000): number {
  const area = Math.max(1, stageW * stageH);
  return Math.max(1, Math.min(dpr || 1, 2, Math.sqrt(maxPixels / area)));
}

/** Arena point back to a client point (crown origins, tests). Inverse of screenToArena. */
export function arenaToClient(p: ArenaPoint, board: Rect, seat: Seat): { x: number; y: number } {
  return { x: board.left + (p.x / ARENA_W) * board.width, y: board.top + ((seat === 0 ? ARENA_H - p.y : p.y) / ARENA_H) * board.height };
}
