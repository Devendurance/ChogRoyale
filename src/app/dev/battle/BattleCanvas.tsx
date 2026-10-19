"use client";

// Phaser view/controller only. Draws the latest authoritative frame (with
// visual-only interpolation) and reports board clicks in arena coordinates.
// It never computes damage, energy, targeting or outcomes.

import { useEffect, useRef } from "react";
import type { BattleFrame, CardInfo, FrameEvent, StartMessage } from "@/lib/battle-protocol";
import { deployZones, screenToArena, type ArenaPoint } from "@/lib/battle-input";

const S = 5; // pixels per arena unit
const OWN = 0x3b82f6;
const FOE = 0xef4444;
const FAMILY_COLOR: Record<string, number> = { ember_rift: 0xf97316, frost_crossing: 0x67e8f9, energy_surge: 0xfacc15, rift_shift: 0xa855f7, chaos_rally: 0x22c55e };

export interface CanvasFeed {
  start: StartMessage;
  frame: BattleFrame | null;
  prev: BattleFrame | null;
  receivedAt: number;
  selected: CardInfo | null;
  /** Placement preview (drag or hover). Advisory only, never sent as truth. */
  ghost: { cardId: string; x: number; y: number; ok: boolean } | null;
}

/** Maps a viewport point to arena cells for this client's seat, or null off the board. */
export type BoardMapper = (clientX: number, clientY: number) => ArenaPoint | null;

interface Fx {
  kind: "ring" | "flash" | "death" | "boom";
  x: number;
  y: number;
  r: number;
  color: number;
  until: number;
}

interface Props {
  feed: React.RefObject<CanvasFeed | null>;
  mapRef: React.RefObject<BoardMapper | null>;
  onBoardTap: (at: ArenaPoint) => void;
  onBoardHover: (at: ArenaPoint | null) => void;
}

export default function BattleCanvas({ feed, mapRef, onBoardTap, onBoardHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);

  // One mapper for taps and drags: the rendered canvas rect absorbs FIT
  // scaling, zoom and DPR, and the seat decides the vertical flip.
  useEffect(() => {
    mapRef.current = (cx, cy) => {
      const canvas = host.current?.querySelector("canvas");
      const f = feed.current;
      return canvas && f ? screenToArena(cx, cy, canvas.getBoundingClientRect(), f.start.seat) : null;
    };
    return () => {
      mapRef.current = null;
    };
  }, [feed, mapRef]);

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let cancelled = false;
    void import("phaser").then((Phaser) => {
      if (cancelled || !host.current) return;
      const W = 100 * S;
      const H = 160 * S;
      const fx: Fx[] = [];
      let lastEventTick = -1;
      const labels = new Map<string, import("phaser").GameObjects.Text>();

      class Arena extends Phaser.Scene {
        g!: import("phaser").GameObjects.Graphics;
        create() {
          this.g = this.add.graphics();
        }
        update() {
          const f = feed.current;
          const g = this.g;
          g.clear();
          if (!f || !f.frame) return;
          const { start, frame, prev } = f;
          const seat = start.seat;
          const sx = (x: number) => x * S;
          const sy = (y: number) => (seat === 0 ? 160 - y : y) * S;
          const col = (owner: number) => (owner === seat ? OWN : FOE);
          const t = Math.min(1, (performance.now() - f.receivedAt) / 100);
          const prevPos = new Map<string, { x: number; y: number }>();
          for (const u of [...(prev?.troops ?? []), ...(prev?.commanders ?? [])]) prevPos.set(u.id, u);
          const lerp = (id: string, x: number, y: number) => {
            const p = prevPos.get(id);
            return p ? { x: p.x + (x - p.x) * t, y: p.y + (y - p.y) * t } : { x, y };
          };
          const geo = start.geometry;
          const bandY = (minY: number, maxY: number) => {
            const a = sy(minY);
            const b = sy(maxY + 1);
            return { y: Math.min(a, b), h: Math.abs(a - b) };
          };
          // Ground, own territory, river, bridges, ford.
          g.fillStyle(0x1f3b2a, 1).fillRect(0, 0, W, H);
          const placing = f.ghost ? start.catalog[f.ghost.cardId] : f.selected;
          if (placing && placing.kind !== "spell") {
            for (const z of deployZones(start, frame)) {
              const b = bandY(z.minY, z.maxY);
              g.fillStyle(0x22c55e, 0.12).fillRect(sx(z.minX), b.y, (z.maxX - z.minX + 1) * S, b.h);
              g.lineStyle(1, 0x22c55e, 0.5).strokeRect(sx(z.minX), b.y, (z.maxX - z.minX + 1) * S, b.h);
            }
          }
          const river = bandY(geo.river.minY, geo.river.maxY);
          g.fillStyle(0x1e40af, 1).fillRect(0, river.y, W, river.h);
          g.fillStyle(0x8b5a2b, 1);
          for (const br of geo.bridges) g.fillRect(sx(br.minX), river.y, (br.maxX - br.minX + 1) * S, river.h);
          if (frame.riftOpen) g.fillStyle(0xa855f7, 0.75).fillRect(sx(geo.ford.minX), river.y, (geo.ford.maxX - geo.ford.minX + 1) * S, river.h);
          g.lineStyle(1, 0xffffff, 0.15).lineBetween(W / 2, 0, W / 2, H);
          // Chaos regions: warning outlined, active filled. Board-wide pulses tint the border.
          for (const c of frame.chaos) {
            const color = FAMILY_COLOR[c.family] ?? 0xffffff;
            if (c.zones.length === 0) {
              g.lineStyle(c.state === "active" ? 8 : 3, color, c.state === "active" ? 0.8 : 0.5).strokeRect(2, 2, W - 4, H - 4);
            }
            for (const z of c.zones) {
              const zr = geo.zones[z];
              if (!zr) continue;
              const b = bandY(zr.minY, zr.maxY);
              if (c.state === "active") g.fillStyle(color, 0.22).fillRect(0, b.y, W, b.h);
              g.lineStyle(2, color, c.state === "active" ? 0.9 : 0.6).strokeRect(1, b.y + 1, W - 2, b.h - 2);
            }
          }
          const hpBar = (x: number, y: number, w: number, hp: number, max: number, shield = 0) => {
            g.fillStyle(0x000000, 0.6).fillRect(x - w / 2, y, w, 4);
            g.fillStyle(hp / max > 0.5 ? 0x22c55e : hp / max > 0.25 ? 0xeab308 : 0xef4444, 1).fillRect(x - w / 2, y, (w * Math.max(0, hp)) / max, 4);
            if (shield > 0) g.fillStyle(0xe5e7eb, 1).fillRect(x - w / 2, y - 3, Math.min(w, (w * shield) / max), 2);
          };
          const seen = new Set<string>();
          const label = (id: string, text: string, x: number, y: number) => {
            seen.add(id);
            let l = labels.get(id);
            if (!l) {
              l = this.add.text(0, 0, text, { fontSize: "11px", color: "#ffffff", fontFamily: "monospace" }).setOrigin(0.5).setDepth(10);
              labels.set(id, l);
            }
            l.setText(text).setPosition(x, y);
          };
          for (const s of frame.structures) {
            const r = (s.kind === "core" ? 4 : 3) * S + S / 2;
            const x = sx(s.x);
            const y = sy(s.y);
            g.fillStyle(s.alive ? col(s.owner) : 0x4b5563, s.alive ? 0.9 : 0.5).fillRect(x - r, y - r, r * 2, r * 2);
            g.lineStyle(2, 0x111827, 1).strokeRect(x - r, y - r, r * 2, r * 2);
            if (s.alive) hpBar(x, y - r - 7, r * 2, s.hp, s.maxHp);
            label(s.id, s.alive ? `${s.kind === "core" ? "CORE" : "T"} ${s.hp}` : "rubble", x, y);
          }
          for (const b of frame.buildings) {
            const r = (b.footprint + 0.5) * S;
            const x = sx(b.x);
            const y = sy(b.y);
            g.fillStyle(col(b.owner), 0.6).fillRect(x - r, y - r, r * 2, r * 2);
            g.lineStyle(2, b.cardId === "rift_sentry" ? 0xfbbf24 : b.cardId === "chog_burrow" ? 0xa78bfa : 0xd1d5db, 1).strokeRect(x - r, y - r, r * 2, r * 2);
            hpBar(x, y - r - 6, r * 2, b.hp, b.maxHp);
            label(b.id, b.cardId === "rift_sentry" ? "SEN" : b.cardId === "chog_burrow" ? "BUR" : "TOT", x, y);
            if (b.nextSpawnAt !== undefined && b.spawnsLeft && b.spawnsLeft > 0) {
              const frac = 1 - Math.max(0, Math.min(1, (b.nextSpawnAt - frame.tick) / 50));
              g.lineStyle(2, 0xa78bfa, 0.9).beginPath().arc(x, y - r - 10, 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2).strokePath();
            }
          }
          for (const i of frame.impacts) {
            const r = (start.catalog[i.cardId]?.radius ?? 6) * S;
            g.lineStyle(2, 0xfde047, 0.9).strokeCircle(sx(i.x), sy(i.y), r);
          }
          for (const u of frame.troops) {
            const p = lerp(u.id, u.x, u.y);
            const x = sx(p.x);
            const y = sy(p.y);
            if (u.air) {
              g.fillStyle(0x000000, 0.3).fillCircle(x, y + 6, 4);
              g.fillStyle(col(u.owner), 1).fillTriangle(x, y - 9, x - 7, y + 3, x + 7, y + 3);
            } else g.fillStyle(col(u.owner), 1).fillCircle(x, y, 6);
            hpBar(x, y - 14, 14, u.hp, u.maxHp, u.shield);
            label(u.id, (start.catalog[u.cardId]?.name ?? u.cardId).slice(0, 2), x, y);
          }
          for (const c of frame.commanders) {
            const p = lerp(c.id, c.x, c.y);
            const x = sx(p.x);
            const y = sy(p.y);
            g.fillStyle(col(c.owner), 1).fillCircle(x, y, 10);
            g.lineStyle(3, 0xfbbf24, 1).strokeCircle(x, y, 11);
            hpBar(x, y - 19, 24, c.hp, c.maxHp, c.shield);
            label(c.id, c.cls.slice(0, 2).toUpperCase(), x, y);
          }
          // Structure no-go margins while placing a ground card.
          if (placing && placing.kind !== "spell") {
            for (const s of [...frame.structures.filter((s) => s.alive).map((s) => ({ x: s.x, y: s.y, r: s.kind === "core" ? 4 : 3 })), ...frame.buildings.map((b) => ({ x: b.x, y: b.y, r: b.footprint }))]) {
              const r = (s.r + 2.5) * S;
              g.lineStyle(1, 0xef4444, 0.6).strokeRect(sx(s.x) - r, sy(s.y) - r, r * 2, r * 2);
            }
          }
          const all = new Map<string, { x: number; y: number }>();
          for (const u of [...frame.troops, ...frame.commanders, ...frame.buildings, ...frame.structures]) all.set(u.id, u);
          for (const pr of frame.projectiles) {
            const tgt = all.get(pr.targetId);
            g.fillStyle(0xfef08a, 1).fillCircle(sx(pr.x), sy(pr.y), 3);
            if (tgt) g.lineStyle(1, 0xfef08a, 0.4).lineBetween(sx(pr.x), sy(pr.y), sx(tgt.x), sy(tgt.y));
          }
          // Transient event effects, collected once per authoritative tick.
          if (frame.tick !== lastEventTick) {
            lastEventTick = frame.tick;
            const prevAll = new Map<string, { x: number; y: number }>();
            for (const u of [...(prev?.troops ?? []), ...(prev?.commanders ?? []), ...(prev?.buildings ?? [])]) prevAll.set(u.id, u);
            for (const e of frame.events as FrameEvent[]) {
              const at = (id: unknown) => all.get(String(id)) ?? prevAll.get(String(id));
              const until = frame.tick + 6;
              if (e.type === "deploy") {
                const p = at((e.entityIds as unknown[] | undefined)?.[0]);
                if (p) fx.push({ kind: "ring", x: p.x, y: p.y, r: 5, color: Number(e.player) === seat ? 0x22c55e : 0xf87171, until: frame.tick + 6 });
              } else if (e.type === "spell_cast" || e.type === "spell_impact") fx.push({ kind: "flash", x: Number(e.x), y: Number(e.y), r: start.catalog[String(e.cardId)]?.radius ?? 6, color: 0xfde047, until });
              else if (e.type === "ability_fired") fx.push({ kind: "ring", x: Number(e.x), y: Number(e.y), r: Number(e.radius ?? 4), color: 0xfbbf24, until: frame.tick + 8 });
              else if (e.type === "shockwave") {
                const p = at(e.entityId);
                if (p) fx.push({ kind: "ring", x: p.x, y: p.y, r: 4, color: 0xf97316, until: frame.tick + 3 });
              } else if (e.type === "death") {
                const p = at(e.entityId);
                if (p) fx.push({ kind: "death", x: p.x, y: p.y, r: 2, color: 0xffffff, until: frame.tick + 5 });
              } else if (e.type === "structure_destroyed") {
                const p = at(e.entityId);
                if (p) fx.push({ kind: "boom", x: p.x, y: p.y, r: 8, color: 0xf97316, until: frame.tick + 12 });
              }
            }
          }
          for (let i = fx.length - 1; i >= 0; i--) {
            const e = fx[i]!;
            if (e.until < frame.tick) {
              fx.splice(i, 1);
              continue;
            }
            const x = sx(e.x);
            const y = sy(e.y);
            if (e.kind === "flash") g.fillStyle(e.color, 0.3).fillCircle(x, y, e.r * S);
            else if (e.kind === "ring") g.lineStyle(3, e.color, 0.9).strokeCircle(x, y, e.r * S);
            else if (e.kind === "boom") g.fillStyle(e.color, 0.5).fillCircle(x, y, e.r * S);
            else g.lineStyle(2, e.color, 0.9).lineBetween(x - 5, y - 5, x + 5, y + 5).lineBetween(x - 5, y + 5, x + 5, y - 5);
          }
          // Placement ghost: green when the advisory check passes, red otherwise.
          if (f.ghost) {
            const card = start.catalog[f.ghost.cardId];
            const r = Math.max(card?.radius ?? 0, card?.kind === "building" ? 3 : 2) * S;
            const color = f.ghost.ok ? 0x22c55e : 0xef4444;
            const x = sx(f.ghost.x);
            const y = sy(f.ghost.y);
            g.fillStyle(color, 0.3).fillCircle(x, y, r);
            g.lineStyle(2, color, 1).strokeCircle(x, y, r).lineBetween(x - 6, y, x + 6, y).lineBetween(x, y - 6, x, y + 6);
          }
          // Drop labels for entities that no longer exist (no stuck corpses).
          for (const [id, l] of labels) {
            if (seen.has(id)) continue;
            l.destroy();
            labels.delete(id);
          }
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: W,
        height: H,
        backgroundColor: "#0b1210",
        scene: Arena,
        // Input is handled by DOM pointer events on the host. Phaser's touch
        // capture would otherwise preventDefault and fight those handlers.
        input: { keyboard: false, mouse: false, touch: false, gamepad: false },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
      });
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [feed]);

  // A press that starts and ends on the board without travelling is a tap.
  return (
    <div
      ref={host}
      data-testid="battle-board"
      style={{ width: "100%", maxWidth: 500, aspectRatio: "100 / 160", touchAction: "none" }}
      onPointerDown={(e) => {
        if (e.button === 0) press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) return;
        const at = mapRef.current?.(e.clientX, e.clientY);
        if (at) onBoardTap(at);
      }}
      onPointerCancel={() => {
        press.current = null;
        onBoardHover(null);
      }}
      onPointerMove={(e) => onBoardHover(mapRef.current?.(e.clientX, e.clientY) ?? null)}
      onPointerLeave={() => onBoardHover(null)}
    />
  );
}
