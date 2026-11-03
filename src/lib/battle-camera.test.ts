import { describe, expect, it } from "vitest";
import { arenaToClient, boardClientRect, boardLayout, cameraFor, canvasResolution } from "./battle-camera";
import { screenToArena } from "./battle-input";

describe("battle camera layout", () => {
  it("fills a phone's width and keeps the whole board above the hand", () => {
    const l = boardLayout(390, 844, { top: 6, bottom: 170 });
    expect(l.width).toBeCloseTo(390, 6);
    expect(l.height).toBeCloseTo(624, 6);
    expect(l.left).toBeCloseTo(0, 6);
    expect(l.top).toBeGreaterThanOrEqual(6);
    expect(l.top + l.height).toBeLessThanOrEqual(844 - 170 + 1e-6);
  });

  it("is height-limited on a tablet and centres the board in the world", () => {
    const l = boardLayout(768, 1024, { top: 6, bottom: 200 });
    expect(l.height).toBeCloseTo(818, 6);
    expect(l.width).toBeCloseTo(511.25, 6);
    expect(l.left).toBeCloseTo((768 - 511.25) / 2, 6);
    expect(l.width / l.height).toBeCloseTo(100 / 160, 9);
  });

  it("matches the old host fill exactly when the host is already 100:160", () => {
    const l = boardLayout(378, 604.8);
    expect(l.left).toBeCloseTo(0, 9);
    expect(l.top).toBeCloseTo(0, 9);
    expect(l.width).toBeCloseTo(378, 6);
  });

  it("caps runaway insets and survives zero-sized stages", () => {
    const l = boardLayout(0, 0, { top: 9999, bottom: 9999 });
    expect(l.scale).toBeGreaterThan(0);
    expect(Number.isFinite(l.left + l.top)).toBe(true);
  });

  it("maps pointer points through the board rect, not the full-screen canvas", () => {
    const stageW = 768;
    const stageH = 1024;
    const l = boardLayout(stageW, stageH, { top: 6, bottom: 200 });
    // The canvas element is offset and CSS-zoomed by 2x; both scale together.
    const canvas = { left: 10, top: 20, width: stageW * 2, height: stageH * 2 };
    const board = boardClientRect(l, canvas, stageW, stageH);
    for (const seat of [0, 1] as const) {
      for (const p of [{ x: 30, y: 40 }, { x: 70, y: 120 }, { x: 50, y: 80 }, { x: 0, y: 0 }, { x: 100, y: 160 }]) {
        const c = arenaToClient(p, board, seat);
        expect(screenToArena(c.x, c.y, board, seat)).toEqual(p);
      }
    }
    // The forest beside the board is world art, never a deploy target.
    expect(screenToArena(canvas.left + 4, canvas.top + stageH, board, 0)).toBeNull();
  });

  it("points the camera at the board point under the stage centre", () => {
    const l = boardLayout(390, 844, { top: 6, bottom: 170 });
    const c = cameraFor(l, 390, 844, 2);
    expect(c.zoom).toBeCloseTo(l.scale * 2, 9);
    // Stage centre in CSS px back to board px.
    expect(l.left + c.centerX * l.scale).toBeCloseTo(195, 6);
    expect(l.top + c.centerY * l.scale).toBeCloseTo(422, 6);
  });

  it("keeps device resolution within the fill budget", () => {
    expect(canvasResolution(390, 844, 3)).toBe(2);
    expect(canvasResolution(390, 844, 1)).toBe(1);
    expect(canvasResolution(1024, 1366, 2) ** 2 * 1024 * 1366).toBeLessThanOrEqual(4_200_001);
  });
});
