"use client";

import { useLayoutEffect, useState } from "react";
import type { BattleFrame, StartMessage } from "@/lib/battle-protocol";
import { arenaToClient } from "@/lib/battle-camera";
import { deployZones, type Rect } from "@/lib/battle-input";
import type { TutorialLane } from "@/lib/tutorial-camp";

interface PocketRect {
  lane: TutorialLane;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Draws the actual forward pocket from the authoritative frame and deploy
 * geometry. This is presentation only; the server still validates the deploy.
 */
export default function TrainingPocketHighlight({
  start,
  frame,
  towerLanes,
  boardRef,
}: {
  start: StartMessage;
  frame: BattleFrame;
  towerLanes: TutorialLane[];
  boardRef: React.RefObject<HTMLElement | null>;
}) {
  const [pockets, setPockets] = useState<PocketRect[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const host = boardRef.current;
      const boardEl = host?.querySelector("[data-board-rect]") ?? host?.querySelector('[data-testid="battle-board"]');
      if (!boardEl) {
        setPockets([]);
        return;
      }
      const raw = boardEl.getBoundingClientRect();
      const board: Rect = { left: raw.left, top: raw.top, width: raw.width, height: raw.height };
      const split = start.geometry.deploy.laneSplitX;
      const next: PocketRect[] = [];
      for (const zone of deployZones(start, frame).slice(1)) {
        const lane: TutorialLane = zone.maxX < split ? "left" : "right";
        if (!towerLanes.includes(lane)) continue;
        const a = arenaToClient({ x: zone.minX, y: zone.maxY }, board, start.seat);
        const b = arenaToClient({ x: zone.maxX, y: zone.minY }, board, start.seat);
        next.push({
          lane,
          left: Math.min(a.x, b.x),
          top: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
        });
      }
      setPockets(next);
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [boardRef, frame, start, towerLanes]);

  return (
    <>
      {pockets.map((pocket) => (
        <div
          key={`${pocket.lane}:${Math.round(pocket.left)}:${Math.round(pocket.top)}`}
          className="chud-training-pocket"
          data-lane={pocket.lane}
          aria-hidden="true"
          style={{ left: pocket.left, top: pocket.top, width: pocket.width, height: pocket.height }}
        >
          <span>New ground</span>
        </div>
      ))}
    </>
  );
}
