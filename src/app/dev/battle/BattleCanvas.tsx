"use client";

// Phaser view/controller only. Draws the latest authoritative frame (with
// visual-only interpolation) and reports board clicks in arena coordinates.
// It never computes damage, energy, targeting or outcomes. Entities render as
// v001 kit sprites when the imported runtime manifest is available, with the
// original vector placeholders as fallback for unknown/missing assets.

import { useEffect, useRef } from "react";
import type { BattleFrame, CardInfo, FrameEvent, StartMessage } from "@/lib/battle-protocol";
import { deployZones, screenToArena, type ArenaPoint } from "@/lib/battle-input";
import {
  battleAnimationCues,
  interpolateBattlePosition,
  takeUnseenBattleAnimationCues,
  type BattleAnimationCue,
} from "./battle-animation";
import { chaosFamilyColor, combatEventKey } from "./combat-vfx";
import {
  byId,
  displayScale,
  effectForAbility,
  effectForRequirement,
  resolveCommanderAsset,
  resolveEntityAsset,
  type SpriteManifest,
  type SpriteRecord,
} from "./sprite-registry";
import {
  ARENA_URLS,
  TEAM_COLORS,
  defenderCue,
  defenderPose,
  directionalAim,
  fireFresh,
  fireKey,
  layerFlipY,
  layerVisible,
  mountRoleFor,
  mountRoleForStructure,
  mountVisualOffsetY,
  newDefenderState,
  placementFor,
  structureTeamFor,
  teamTrimHalves,
  tintsTeamTrim,
  updateDefender,
  weaponScreen,
  type ArenaManifest,
  type DefenderState,
} from "./arena-registry";
import {
  UNITS_MANIFEST_URL,
  UNITS_URL,
  anchorOffset,
  clipsFor,
  defeatAlpha,
  engagedFoe,
  newUnitAnimState,
  nextView,
  unitAnimFor,
  unitFrame,
  unitTextureKey,
  updateEngagement,
  type Foe,
  type UnitAnimManifest,
  type UnitAnimRecord,
  type UnitAnimState,
  type UnitView,
} from "./unit-anim";
import {
  TEX_RADIUS,
  VFX_COLORS,
  VFX_MANIFEST_URL,
  VFX_S,
  VFX_URL,
  abilityVfx,
  burstAt,
  commanderEntityFor,
  projectileStyleFor,
  ringAt,
  seeded,
  spellCastVfx,
  spellImpactVfx,
  statusesFromEvent,
  vfxKey,
  type ProjectileStyle,
  type StatusUnit,
  type VfxManifest,
  type VfxSprite,
  type VfxStatus,
} from "./battle-vfx";
import { VfxLayer } from "./vfx-layer";

/** Commander class sheets live in the units manifest as `commander_<class>`. */
const commanderAnimId = (cls: string) => `commander_${cls}`;

// First arena manifest that loads wins: v003 pre-rendered 2.5D art, else v002.
const loadArena = async (): Promise<{ arena: ArenaManifest; base: string } | null> => {
  for (const base of ARENA_URLS) {
    try {
      const r = await fetch(`${base}/manifests/arena.runtime.json`);
      if (r.ok) return { arena: (await r.json()) as ArenaManifest, base };
    } catch {
      // Try the next manifest.
    }
  }
  return null;
};

const S = 5; // pixels per arena unit
// Allegiance follows the v3 orientation lock: the viewer is blue, the
// opponent red, derived from owner === seat for both perspectives.
const OWN = TEAM_COLORS.friendly;
const FOE = TEAM_COLORS.opponent;
const KIT_URL = "/assets/chog-kit/v001";

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
  kind: "ring" | "flash" | "death" | "boom" | "hit" | "pulse";
  x: number;
  y: number;
  r: number;
  color: number;
  until: number;
  pulseState?: "warning" | "active" | "expired";
  /** Animated-unit hit: an open ring and sparks around the body, lifted this
   * many px off the ground point, so a tiny unit is never covered. */
  lift?: number;
}

interface Props {
  feed: React.RefObject<CanvasFeed | null>;
  mapRef: React.RefObject<BoardMapper | null>;
  onBoardTap: (at: ArenaPoint) => void;
  onBoardHover: (at: ArenaPoint | null) => void;
  seat?: 0 | 1;
  /** Optional overrides for the host div (e.g. HUD sizes by height). */
  hostStyle?: React.CSSProperties;
}

/** Authoritative motion for an animated unit: frame-to-frame position delta and the foe in reach. */
interface UnitMotion {
  moving: boolean;
  foe: Foe | null;
  dx: number;
  /** Screen-space heading for the visual view: toward the foe when engaged,
   * else the motion delta, else null to keep the last view. */
  heading: { x: number; y: number } | null;
}

const hashPhase = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 6283;
  return h / 1000;
};

export default function BattleCanvas({ feed, mapRef, onBoardTap, onBoardHover, hostStyle, seat = 0 }: Props) {
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
    void Promise.all([
      import("phaser"),
      fetch(`${KIT_URL}/manifests/phaser-assets.runtime.json`)
        .then((r) => (r.ok ? (r.json() as Promise<SpriteManifest>) : null))
        .catch(() => null),
      loadArena(),
      fetch(UNITS_MANIFEST_URL)
        .then((r) => (r.ok ? (r.json() as Promise<UnitAnimManifest>) : null))
        .catch(() => null),
      fetch(VFX_MANIFEST_URL)
        .then((r) => (r.ok ? (r.json() as Promise<VfxManifest>) : null))
        .catch(() => null),
    ]).then(([Phaser, manifest, arenaLoad, unitManifest, vfxManifest]) => {
      if (cancelled || !host.current) return;
      const arena = arenaLoad?.arena ?? null;
      const arenaBase = arenaLoad?.base ?? "";
      if (!manifest) console.warn("battle sprites: kit manifest unavailable; vector placeholders only");
      const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const W = 100 * S;
      const H = 160 * S;
      const fx: Fx[] = [];
      const seenEventKeys = new Set<string>();
      const labels = new Map<string, import("phaser").GameObjects.Text>();
      const missing = new Set<string>();
      const rec = (id: string): SpriteRecord | null => (manifest && !missing.has(id) ? byId(manifest, id) : null);

      interface PoolEnt {
        root: import("phaser").GameObjects.Container;
        img: import("phaser").GameObjects.Image;
        rec: SpriteRecord;
        air: boolean;
        born: number;
        lastX: number;
        lastY: number;
        lastHp: number;
        flashUntil: number;
        lunge: { dx: number; dy: number; start: number } | null;
        attack: { dx: number; dy: number; start: number } | null;
        facingX: number;
        gone: number | null;
        rubble: boolean;
        baseScale: number;
        phase: number;
        /** Pre-rendered animation sheet, or null for the static v001 sprite. */
        anim: UnitAnimRecord | null;
        animSt: UnitAnimState;
        view: UnitView;
        /** Last attack cycle whose impact frame spawned its effect. */
        lastImpact: string | null;
      }
      interface FxImg {
        img: import("phaser").GameObjects.Image;
        born: number;
        dur: number;
        s0: number;
        s1: number;
      }
      const pool = new Map<string, PoolEnt>();
      const projPool = new Map<string, import("phaser").GameObjects.Image>();
      const impactPool = new Map<string, import("phaser").GameObjects.Image[]>();
      const zonePool = new Map<string, import("phaser").GameObjects.Image>();
      const fxImgs: FxImg[] = [];

      // Chaos Crossing v002 mounted-structure assemblies. One container per
      // structure: base, socket, defender pose, front rim, all sharing the
      // authored root pivot. Defender state is driven by authoritative data.
      interface MountEnt {
        root: import("phaser").GameObjects.Container;
        shadow: import("phaser").GameObjects.Ellipse;
        teamAccent: import("phaser").GameObjects.Graphics;
        base: import("phaser").GameObjects.Image;
        socket: import("phaser").GameObjects.Image;
        defender: import("phaser").GameObjects.Image;
        rim: import("phaser").GameObjects.Image;
        rubble: boolean;
      }
      const envLayers = new Map<string, import("phaser").GameObjects.Image[]>();
      const mountPool = new Map<string, MountEnt>();
      const defenderStates = new Map<string, DefenderState>();
      let eventStart: StartMessage | null = null;
      // Instant tower-fire feedback: muzzle flash at the measured weapon
      // anchor plus a tracer to the authoritative target point, ~120 ms.
      interface TowerFx {
        /** Flash origin in screen px (weapon anchor of the drawn pose). */
        fx: number;
        fy: number;
        /** Authoritative target point, arena coords (drawn via sx/sy). */
        tx: number;
        ty: number;
        born: number;
        dur: number;
      }
      const towerFx: TowerFx[] = [];
      let lastActiveAt = -1;
      const animationSeenKeys = new Set<string>();
      let animationTick = -1;
      let animationPriming = false;
      // Final-asset VFX: one-shot sprites, status markers that mirror the
      // rule an event applied, first-seen ticks for pending comets, inferred
      // projectile styles and each building's authoritative activation tick.
      let vfx: VfxLayer | null = null;
      const statuses = new Map<string, VfxStatus>();
      const impactFirstTick = new Map<string, number>();
      const projStyles = new Map<string, ProjectileStyle>();
      const buildingActiveAt = new Map<string, number>();

      const clearPresentationPools = () => {
        vfx?.clear();
        statuses.clear();
        impactFirstTick.clear();
        projStyles.clear();
        buildingActiveAt.clear();
        for (const e of pool.values()) e.root.destroy(true);
        pool.clear();
        for (const img of projPool.values()) img.destroy();
        projPool.clear();
        for (const imgs of impactPool.values()) for (const img of imgs) img.destroy();
        impactPool.clear();
        for (const img of zonePool.values()) img.destroy();
        zonePool.clear();
        for (const fxImg of fxImgs) fxImg.img.destroy();
        fxImgs.length = 0;
        for (const mount of mountPool.values()) mount.root.destroy(true);
        mountPool.clear();
        for (const label of labels.values()) label.destroy();
        labels.clear();
        fx.length = 0;
        towerFx.length = 0;
        defenderStates.clear();
        animationSeenKeys.clear();
        animationTick = -1;
      };

      class Arena extends Phaser.Scene {
        g!: import("phaser").GameObjects.Graphics;
        og!: import("phaser").GameObjects.Graphics;
        preload() {
          this.load.on("loaderror", (file: { key: string }) => missing.add(file.key));
          if (manifest) for (const a of manifest.assets) this.load.image(a.stableAssetId, `${KIT_URL}/${a.path}`);
          for (const u of Object.values(unitManifest?.units ?? {})) {
            this.load.spritesheet(unitTextureKey(u.entityId), `${UNITS_URL}/${u.sheet}`, { frameWidth: u.frameWidth, frameHeight: u.frameHeight });
          }
          for (const [key, t] of Object.entries(vfxManifest?.textures ?? {})) {
            if (t.kind === "sheet") this.load.spritesheet(vfxKey(key), `${VFX_URL}/${t.path}`, { frameWidth: t.frameWidth!, frameHeight: t.frameHeight! });
            else this.load.image(vfxKey(key), `${VFX_URL}/${t.path}`);
          }
          if (arena) {
            for (const l of arena.layers) this.load.image(`arena:layer:${l.id}`, `${arenaBase}/${l.path}`);
            for (const [role, r] of Object.entries(arena.mounts)) {
              for (const p of Object.values(r.parts)) if (p) this.load.image(`${role}:${p.split("/").pop()!.replace(".png", "")}`, `${arenaBase}/${p}`);
              for (const [pose, p] of Object.entries(r.poses)) this.load.image(`${role}:defender-${pose}`, `${arenaBase}/${p.path}`);
            }
          }
        }
        create() {
          // Two Graphics layers: board art under everything, HUD overlays
          // (bars, telegraphs, ghost) above every sprite and effect image.
          // v002 arena art sits below both as a textured underlay.
          for (const l of arena?.layers ?? []) {
            const mk = () => this.add.image(-50, -60, `arena:layer:${l.id}`).setOrigin(0, 0).setDepth(-500 + l.zOrder);
            const img = mk();
            if (!tintsTeamTrim(l)) {
              envLayers.set(l.id, [img]);
              continue;
            }
            // Player-relative team trim: the same texture cropped into an
            // opponent (top) half and a friendly (bottom) half, each tinted.
            const halves = teamTrimHalves(img.width, img.height);
            envLayers.set(
              l.id,
              halves.map((h, i) => (i === 0 ? img : mk()).setCrop(...h.crop).setTint(TEAM_COLORS[h.team]))
            );
          }
          this.g = this.add.graphics().setDepth(-100);
          this.og = this.add.graphics().setDepth(3000);
          vfx = new VfxLayer(this, Phaser, vfxManifest, missing, reduced);
        }
        update() {
          const f = feed.current;
          const g = this.g;
          const og = this.og;
          g.clear();
          og.clear();
          const now = performance.now();
          if (!f || !f.frame) return;
          const { start, frame, prev } = f;
          if (eventStart !== start) {
            clearPresentationPools();
            eventStart = start;
            seenEventKeys.clear();
            defenderStates.clear();
            animationPriming = start.resumed;
          }
          const seat = start.seat;
          const sx = (x: number) => x * S;
          const sy = (y: number) => (seat === 0 ? 160 - y : y) * S;
          const col = (owner: number) => (owner === seat ? OWN : FOE);
          const structureCol = (owner: number) => TEAM_COLORS[structureTeamFor(owner, seat)];
          // Board px -> arena units for this seat (effects anchored to drawn art).
          const toArena = (px: number, py: number) => ({ x: px / S, y: seat === 0 ? 160 - py / S : py / S });
          const project = (x: number, y: number): [number, number] => [sx(x), sy(y)];
          // Buildings first placed in this frame (not a resumed history) play
          // their deploy clip from their first drawn frame.
          const freshSpawns = new Set<string>();
          if (!animationPriming) {
            for (const ev of frame.events as FrameEvent[]) {
              if (ev.type === "building_spawned" && !seenEventKeys.has(combatEventKey(ev))) freshSpawns.add(String(ev.buildingId));
            }
          }
          const t = Math.min(1, (now - f.receivedAt) / 100);
          const prevPos = new Map<string, { x: number; y: number }>();
          for (const u of [...(prev?.troops ?? []), ...(prev?.commanders ?? [])]) prevPos.set(u.id, u);
          const lerp = (id: string, x: number, y: number) => {
            const p = prevPos.get(id);
            return interpolateBattlePosition(p ?? null, { x, y }, t);
          };
          const geo = start.geometry;
          const bandY = (minY: number, maxY: number) => {
            const a = sy(minY);
            const b = sy(maxY + 1);
            return { y: Math.min(a, b), h: Math.abs(a - b) };
          };
          // v002 environment underlay. Every layer image shares the entity
          // transform: placed at (-50,-60) half-size into the board. For
          // seat 1 board-coupled layers flip vertically (the entity transform
          // mirrors y) while camera-space layers stay upright (layerFlipY).
          const arenaOk =
            !!arena &&
            arena.layers.every((l) => !missing.has(`arena:layer:${l.id}`)) &&
            arena.layers.every((l) => envLayers.has(l.id));
          if (arenaOk && arena) {
            const anyWarning = frame.chaos.some((c) => c.state === "warning");
            const anyActive = frame.chaos.some((c) => c.state === "active");
            if (anyActive) lastActiveAt = now;
            const boardWide = (st: string) => frame.chaos.some((c) => c.state === st && c.zones.length === 0);
            const rippleAlt = !reduced && Math.floor(now / 700) % 2 === 1;
            for (const l of arena.layers) {
              const imgs = envLayers.get(l.id);
              if (!imgs) continue;
              const vis = layerVisible(l, {
                riftOpen: frame.riftOpen,
                anyWarning,
                anyActive,
                expiryUntil: lastActiveAt + 1000,
                now,
                rippleAlt,
              });
              // The authored chaos overlays are board-centred illustrations.
              // Zone-specific chaos keeps them at low alpha so they never
              // contradict the authoritative per-zone bands drawn below.
              const alpha =
                l.state === "chaos-warning"
                  ? boardWide("warning") ? 1 : 0.35
                  : l.state === "chaos-active"
                    ? boardWide("active") ? 1 : 0.35
                    : l.state === "chaos-expiry"
                      ? 0.6
                      : 1;
              for (const img of imgs) img.setFlipY(layerFlipY(l, seat)).setVisible(vis).setAlpha(alpha);
            }
          }
          // Ground, own territory, river, bridges, ford. When the v002
          // underlay is live the art carries these; the rects are fallback.
          if (!arenaOk) g.fillStyle(0x1f3b2a, 1).fillRect(0, 0, W, H);
          const placing = f.ghost ? start.catalog[f.ghost.cardId] : f.selected;
          if (placing && placing.kind !== "spell") {
            for (const z of deployZones(start, frame)) {
              const b = bandY(z.minY, z.maxY);
              g.fillStyle(0x22c55e, 0.12).fillRect(sx(z.minX), b.y, (z.maxX - z.minX + 1) * S, b.h);
              g.lineStyle(1, 0x22c55e, 0.5).strokeRect(sx(z.minX), b.y, (z.maxX - z.minX + 1) * S, b.h);
            }
          }
          const river = bandY(geo.river.minY, geo.river.maxY);
          if (!arenaOk) {
            g.fillStyle(0x1e40af, 1).fillRect(0, river.y, W, river.h);
            g.fillStyle(0x8b5a2b, 1);
            for (const br of geo.bridges) g.fillRect(sx(br.minX), river.y, (br.maxX - br.minX + 1) * S, river.h);
            if (frame.riftOpen) g.fillStyle(0xa855f7, 0.75).fillRect(sx(geo.ford.minX), river.y, (geo.ford.maxX - geo.ford.minX + 1) * S, river.h);
            g.lineStyle(1, 0xffffff, 0.15).lineBetween(W / 2, 0, W / 2, H);
          }
          // Chaos regions: warning outlined, active filled. Board-wide pulses tint the border.
          const activeZones = new Set<string>();
          for (const c of frame.chaos) {
            const color = chaosFamilyColor(c.family);
            if (c.zones.length === 0) {
              g.lineStyle(c.state === "active" ? 8 : 3, color, c.state === "active" ? 0.8 : 0.5).strokeRect(2, 2, W - 4, H - 4);
            }
            for (const z of c.zones) {
              const zr = geo.zones[z];
              if (!zr) continue;
              const b = bandY(zr.minY, zr.maxY);
              if (c.state === "active") {
                g.fillStyle(color, 0.22).fillRect(0, b.y, W, b.h);
                activeZones.add(`${c.id}:${z}`);
                // One low-alpha family primitive centered on each active zone.
                if (manifest && !zonePool.has(`${c.id}:${z}`)) {
                  const prim = effectForRequirement(manifest, c.family)[0];
                  if (prim && rec(prim.stableAssetId)) {
                    const img = this.add.image(W / 2, b.y + b.h / 2, prim.stableAssetId);
                    img.setScale(displayScale(prim) * 2.2).setAlpha(0.3).setDepth(0.5);
                    zonePool.set(`${c.id}:${z}`, img);
                  }
                }
              }
              g.lineStyle(2, color, c.state === "active" ? 0.9 : 0.6).strokeRect(1, b.y + 1, W - 2, b.h - 2);
            }
          }
          for (const [key, img] of zonePool) {
            if (!activeZones.has(key)) {
              img.destroy();
              zonePool.delete(key);
            }
          }
          const hpBar = (x: number, y: number, w: number, hp: number, max: number, shield = 0) => {
            og.fillStyle(0x000000, 0.6).fillRect(x - w / 2, y, w, 4);
            og.fillStyle(hp / max > 0.5 ? 0x22c55e : hp / max > 0.25 ? 0xeab308 : 0xef4444, 1).fillRect(x - w / 2, y, (w * Math.max(0, hp)) / max, 4);
            if (shield > 0) og.fillStyle(0xe5e7eb, 1).fillRect(x - w / 2, y - 3, Math.min(w, (w * shield) / max), 2);
          };
          const seen = new Set<string>();
          const label = (id: string, text: string, x: number, y: number) => {
            seen.add(id);
            let l = labels.get(id);
            if (!l) {
              l = this.add.text(0, 0, text, { fontSize: "11px", color: "#ffffff", fontFamily: "monospace" }).setOrigin(0.5).setDepth(2000);
              labels.set(id, l);
            }
            l.setText(text).setPosition(x, y);
          };
          const all = new Map<string, { x: number; y: number }>();
          for (const u of [...frame.troops, ...frame.commanders, ...frame.buildings, ...frame.structures]) all.set(u.id, u);
          const ent = (kind: "troop" | "building" | "structure" | "spell", id: string): SpriteRecord | null => {
            if (!manifest) return null;
            const r = resolveEntityAsset(manifest, kind, id);
            return r && !missing.has(r.stableAssetId) ? r : null;
          };

          // Pooled sprite entities. The container root sits at the interpolated
          // ground point; shadow + owner ring hug the ground while the sprite
          // image hangs from its authored pivot. Motion offsets only move the
          // image, so hp bars and rings stay put.
          const ensure = (id: string, r: SpriteRecord, air: boolean, owner: number, anim: UnitAnimRecord | null = null): PoolEnt => {
            let e = pool.get(id);
            if (!e) {
              const root = this.add.container(0, 0);
              // Team marker: filled ellipse at the ground point in the owner's
              // color with a brighter outline, sized to the sprite's visible
              // footprint so structures read larger. The art itself is never
              // tinted; the dark contact shadow sits on top of the marker.
              // Animated sheets size it from half their drawn height, the same
              // proportion the v001 records produce.
              const scale = anim ? anim.displayScale : displayScale(r);
              const vis = anim ? anim.visibleHeight * scale * 0.5 : r.proposedDisplaySize.visibleHeight * scale;
              const ew = Math.max(16, vis * 0.85);
              const marker = this.add.ellipse(0, 0, ew, ew * 0.45, col(owner), 0.35);
              marker.setStrokeStyle(2, owner === seat ? 0x93c5fd : 0xfca5a5, 0.95);
              const shadow = this.add.ellipse(0, 0, ew * 0.8, ew * 0.35, 0x000000, anim ? 0.34 : 0.28);
              const img = anim
                ? this.add.image(0, air ? -10 : 0, unitTextureKey(anim.entityId), anim.clips.idle.start)
                : this.add.image(0, air ? -10 : 0, r.stableAssetId);
              const pivot = anim ? anim.pivotNormalized : r.pivotNormalized;
              img.setOrigin(pivot[0], pivot[1]).setScale(scale);
              root.add([marker, shadow, img]);
              e = {
                root,
                img,
                rec: r,
                air,
                born: now,
                lastX: 0,
                lastY: 0,
                lastHp: -1,
                flashUntil: 0,
                lunge: null,
                attack: null,
                facingX: 1,
                gone: null,
                rubble: false,
                baseScale: scale,
                phase: hashPhase(id),
                anim,
                animSt: newUnitAnimState(hashPhase(id) * 1000),
                // Until it first moves, a unit faces the far side: the viewer's
                // troops show their backs, the opponent's their faces.
                view: owner === seat ? "rear" : "front",
                lastImpact: null,
              };
              // A building placed this session rises through its deploy clip.
              if (anim && freshSpawns.has(id)) e.animSt = { ...e.animSt, deployAt: now };
              pool.set(id, e);
            }
            return e;
          };
          // Effect at the frame where an animated attack lands: the Sentry's
          // muzzle flash and crystal tracer, an arrow for instant ranged
          // shooters (Chaos Archer, Deadeye), a star bolt for the Warden, a
          // lure pulse for the Totem, a contact spark for melee. Units whose
          // shots are real frame projectiles draw those instead.
          const onAttackImpact = (e: PoolEnt, px: number, py: number, foe: Foe | null) => {
            const a = e.anim;
            if (!a || !vfx) return;
            const c = clipsFor(a, e.view);
            const idx = Number(e.img.frame.name) - c.attack.start;
            if (idx !== (c.attack.impact ?? 0)) return;
            const st = e.animSt;
            const key = now - st.firedAt < 2000 ? `f${st.firedAt}` : st.engagedSince !== null ? `e${st.engagedSince}:${Math.floor((now - st.engagedSince) / a.attackPeriodMs)}` : null;
            if (!key || key === e.lastImpact) return;
            e.lastImpact = key;
            const drawn = a.visibleHeight * a.displayScale;
            const flip = e.facingX < 0;
            const tip = anchorOffset(a, "muzzle", e.view, "attack", flip) ?? anchorOffset(a, "tip", e.view, "attack", flip);
            const from = tip ? { dx: tip.x, dy: tip.y } : { dx: 0, dy: -drawn * 0.55 };
            const fx0 = toArena(sx(px) + from.dx, sy(py) + from.dy);
            if (a.entityId === "decoy_totem") {
              vfx.spawn([ringAt(px, py, 3, VFX_COLORS.hex, 700, { scale: 0.08, alpha: 0.85, alpha1: 0, ease: "out" })], now);
              return;
            }
            if (a.entityId === "chog_burrow" || a.entityId === "rift_mortar") return;
            if (!foe) return;
            const lift = foe.air ? 18 : 8;
            if (a.entityId === "rift_sentry") {
              vfx.spawn([
                { tex: "muzzle", x: fx0.x, y: fx0.y, life: 140, scale: 0.42, scale1: 0.6, alpha: 1, alpha1: 0, rot: Math.random() * 3, tint: VFX_COLORS.rift, blend: "add", layer: "top" },
                { tex: "streak", x: fx0.x, y: fx0.y, to: { x: foe.x, y: foe.y }, lift: 0, lift1: lift, life: 110, scale: 0.7, alpha: 1, alpha1: 0.6, aim: true, tint: VFX_COLORS.rift, blend: "add", layer: "top" },
                burstAt(foe.x, foe.y, VFX_COLORS.rift, 0.32, 200, lift),
              ], now);
            } else if (a.entityId === "chaos_archer" || a.entityId === commanderAnimId("deadeye")) {
              vfx.spawn([{ tex: "arrow", x: fx0.x, y: fx0.y, to: { x: foe.x, y: foe.y }, lift: 0, lift1: lift, arc: 6, life: 150, scale: 0.55, alpha: 1, alpha1: 1, aim: true, blend: "normal", layer: "top" }], now);
            } else if (a.entityId === commanderAnimId("warden")) {
              vfx.spawn([
                { tex: "glow", x: fx0.x, y: fx0.y, to: { x: foe.x, y: foe.y }, lift: 0, lift1: lift, life: 180, scale: 0.42, alpha: 1, alpha1: 0.7, tint: VFX_COLORS.warden, blend: "add", layer: "top" },
                { tex: "star", x: fx0.x, y: fx0.y, to: { x: foe.x, y: foe.y }, lift: 0, lift1: lift, life: 180, scale: 0.4, alpha: 1, alpha1: 0.8, spin: 9, tint: VFX_COLORS.aegis, blend: "add", layer: "top" },
              ], now);
            } else if (a.reach <= 3) {
              const cx = px + (foe.x - px) * 0.6;
              const cy = py + (foe.y - py) * 0.6;
              vfx.spawn([{ tex: "spark", x: cx, y: cy, lift: drawn * 0.32, life: 150, scale: 0.42, scale1: 0.62, alpha: 1, alpha1: 0, rot: Math.random() * 3, tint: VFX_COLORS.spark, blend: "add", layer: "top" }], now);
            }
          };
          const updateEnt = (
            e: PoolEnt,
            id: string,
            px: number,
            py: number,
            hp: number,
            moving: boolean,
            owner: number,
            motion?: UnitMotion
          ) => {
            const X = sx(px);
            const Y = sy(py);
            e.root.setPosition(X, Y);
            e.root.setDepth(Y + (e.air ? 500 : 0));
            const firstSample = e.lastHp < 0;
            if (e.lastHp >= 0 && hp < e.lastHp) {
              e.flashUntil = now + 140;
              e.animSt.hitAt = now;
              const drawn = e.anim ? e.anim.visibleHeight * e.anim.displayScale : 0;
              fx.push({
                kind: "hit",
                x: px,
                y: py,
                r: e.anim ? (drawn * 0.42) / S : Math.max(1.5, e.rec.proposedDisplaySize.visibleHeight * displayScale(e.rec) * 0.14),
                color: owner === seat ? 0x9be7ff : 0xffa29a,
                until: frame.tick + (reduced ? 2 : 4),
                ...(e.anim ? { lift: drawn * 0.48 + (e.air ? 10 : 0) } : {}),
              });
            }
            e.lastHp = hp;
            // Deploy pop: 0.88 -> 1.04 -> 1 with an alpha ramp, 180 ms.
            const dp = reduced ? 1 : Math.min(1, (now - e.born) / 180);
            const pop = dp < 0.7 ? 0.88 + (dp / 0.7) * 0.16 : 1.04 - ((dp - 0.7) / 0.3) * 0.04;
            let scaleX = e.baseScale * pop;
            let scaleY = e.baseScale * pop;
            e.img.setAlpha(e.gone === null ? 0.55 + 0.45 * dp : e.img.alpha);
            if (e.anim) {
              // Pre-rendered sheet: the frames carry bob, stride, swing, hit
              // and defeat, so the procedural offsets below are skipped.
              const m = motion ?? { moving, foe: null, dx: px - e.lastX, heading: null };
              e.animSt = updateEngagement(e.animSt, !m.moving && m.foe !== null, now);
              if (m.foe && Math.abs(m.foe.x - px) > 0.01) e.facingX = m.foe.x < px ? -1 : 1;
              else if (m.moving && Math.abs(m.dx) > 1e-3) e.facingX = m.dx < 0 ? -1 : 1;
              if (m.heading) e.view = nextView(e.view, m.heading.x, m.heading.y);
              const fr = unitFrame(e.anim, { ...e.animSt, goneAt: e.gone }, { now, moving: m.moving, view: e.view });
              e.img.setFrame(fr.frame);
              if (fr.clip === "attack") onAttackImpact(e, px, py, m.foe);
              e.img.setPosition(0, e.air ? -10 : 0).setScale(scaleX, scaleY).setFlipX(e.facingX < 0).setRotation(0);
              // A light warm flash: the sheet's own hit clip carries the reaction.
              if (e.flashUntil > now) e.img.setTint(0xffc2b8);
              else e.img.clearTint();
              e.lastX = px;
              e.lastY = py;
              return;
            }
            // Idle bob and move bounce/tilt, all timestamp-driven.
            let ox = 0;
            let oy = 0;
            let rot = 0;
            if (!reduced) {
              oy -= Math.max(0, Math.sin((now / 1600) * Math.PI * 2 + e.phase)) * 1.5;
              if (moving) {
                const dx = px - e.lastX;
                const dy = py - e.lastY;
                const len = Math.hypot(dx, dy);
                oy -= Math.abs(Math.sin((now / 360) * Math.PI * 2)) * 3;
                if (!firstSample && len > 1e-6) {
                  e.facingX = dx < 0 ? -1 : 1;
                  rot = Math.max(-3, Math.min(3, ((dx / len) * 3) * (seat === 0 ? 1 : -1)));
                }
              }
            }
            if (e.attack && !reduced) {
              const ap = (now - e.attack.start) / 180;
              if (ap >= 1) e.attack = null;
              else {
                const windup = ap < 0.32 ? -(ap / 0.32) : ap < 0.52 ? 1 - (ap - 0.32) / 0.2 : 0;
                const release = ap >= 0.32 && ap < 0.68 ? Math.sin(((ap - 0.32) / 0.36) * Math.PI) : 0;
                const push = windup * 1.5 + release * 3;
                ox += e.attack.dx * push;
                oy += e.attack.dy * push;
                scaleX *= 1 + release * 0.08;
                scaleY *= 1 - release * 0.05;
                rot += e.attack.dx * release * 0.012;
              }
            } else if (reduced) e.attack = null;
            // Lunge: 5 px toward the recorded target, out and back in ~160 ms.
            if (e.lunge && !reduced) {
              const lp = (now - e.lunge.start) / 160;
              if (lp >= 1) e.lunge = null;
              else {
                const k = Math.sin(lp * Math.PI) * 5;
                ox += e.lunge.dx * k;
                oy += e.lunge.dy * k;
              }
            } else e.lunge = null;
            // Death fade, 220 ms then destroy.
            if (e.gone !== null) {
              const gp = Math.min(1, (now - e.gone) / (reduced ? 110 : 220));
              e.img.setAlpha(1 - gp);
              if (!reduced) {
                scaleX *= 1 - 0.16 * gp;
                scaleY *= 1 + 0.08 * gp;
                rot += 0.08 * gp;
              }
              e.root.setAlpha(1 - gp * 0.6);
            }
            e.img.setPosition(ox, oy + (e.air ? -10 : 0));
            e.img.setScale(scaleX, scaleY).setFlipX(e.facingX < 0);
            e.img.setRotation((rot * Math.PI) / 180);
            if (e.flashUntil > now) e.img.setTint(0xff6666);
            else if (!e.rubble) e.img.clearTint();
            e.lastX = px;
            e.lastY = py;
          };
          const spriteOrFallback = (
            id: string,
            r: SpriteRecord | null,
            x: number,
            y: number,
            hp: number,
            maxHp: number,
            shield: number,
            air: boolean,
            owner: number,
            drawPh: () => void,
            name: string,
            anim: UnitAnimRecord | null = null,
            motion?: UnitMotion
          ) => {
            if (r) {
              const e = ensure(id, r, air, owner, anim);
              const moving = Math.hypot(x - e.lastX, y - e.lastY) > 0.05;
              updateEnt(e, id, x, y, hp, moving, owner, motion);
              const hpx = sx(x);
              if (e.anim) {
                // Animated sheets carry their measured idle height: the bar sits just above the head.
                const drawn = e.anim.visibleHeight * e.anim.displayScale;
                hpBar(hpx, sy(y) - drawn - (air ? 14 : 3), Math.max(16, drawn * 0.6), hp, maxHp, shield);
                return;
              }
              const hpy = sy(y) - r.proposedDisplaySize.visibleHeight * displayScale(r) - (air ? 14 : 4);
              hpBar(hpx, hpy, Math.max(16, r.proposedDisplaySize.visibleHeight * displayScale(r) * 0.6), hp, maxHp, shield);
            } else {
              drawPh();
              label(id, name, sx(x), sy(y));
            }
          };

          // Authoritative tower fire signals for this frame. tower_fired
          // events are the source of truth for the defender fire pose and
          // the flash/tracer (first event per structure wins within a frame).
          const towerFires = new Map<string, { tick: number; x: number; y: number }>();
          for (const e of frame.events as FrameEvent[]) {
            if (e.type !== "tower_fired") continue;
            const sid = String(e.structureId);
            if (!towerFires.has(sid)) towerFires.set(sid, { tick: Number(e.tick), x: Number(e.x), y: Number(e.y) });
          }

          for (const s of frame.structures) {
            const x = sx(s.x);
            const y = sy(s.y);
            const r0 = (s.kind === "core" ? 4 : 3) * S + S / 2;
            const r = ent("structure", s.kind);
            // Schema 2 manifests pick the mount from the viewer's relation to the
            // owner (red Bulwark for the opponent, blue Chog Guardian for the
            // viewer); v002 shares one role per structure kind.
            const role = arena ? mountRoleForStructure(arena, s.kind, s.owner, seat) : mountRoleFor(s.kind);
            const mrole = arenaOk && arena ? arena.mounts[role] : undefined;
            const core = s.kind === "core";
            const aimPose = directionalAim(y);
            const mounted =
              !!mrole &&
              !missing.has(`${role}:structure-base`) &&
              !missing.has(`${role}:defender-idle`) &&
              (!mrole.poses[aimPose] || !missing.has(`${role}:defender-${aimPose}`));
            if (mounted && mrole) {
              // v002 mounted assembly replaces the v001 structure sprite.
              const authoredTeam = !!mrole.authoredTeamColors;
              let me = mountPool.get(s.id);
              if (!me) {
                const mk = (key: string) => this.add.image(0, 0, key).setOrigin(0.5, 0.875).setScale(0.5);
                // A low contact shadow anchors each authored mount to the
                // terrain without changing the authoritative ground point.
                // The subtle green edge keeps the V002 base readable over the
                // textured banks while the dark centre supplies depth. The v003
                // towers sit centred on the anchor, so their shadow is tighter.
                const shadow = authoredTeam
                  ? this.add.ellipse(0, core ? 9 : 7, core ? 62 : 50, core ? 22 : 18, 0x0b2a14, 0.3)
                  : this.add.ellipse(0, core ? 5 : 3, core ? 116 : 94, core ? 24 : 19, 0x07111a, 0.38);
                if (!authoredTeam) shadow.setStrokeStyle(1, core ? 0xf5c96b : 0x9fe3bf, 0.18);
                shadow.setDepth(-1);
                const teamAccent = this.add.graphics();
                const base = mk(`${role}:structure-base`);
                const socket = mk(`${role}:socket-platform`);
                const defender = mk(`${role}:defender-idle`);
                const rim = mk(`${role}:front-rim`);
                const root = this.add.container(x, y, [shadow, base, socket, defender, rim, teamAccent]);
                me = { root, shadow, teamAccent, base, socket, defender, rim, rubble: false };
                mountPool.set(s.id, me);
              }
              me.root.setPosition(x, y).setDepth(y);
              const artOffsetY = mountVisualOffsetY(s.kind, y, mrole.artTopLocalBoardPixels);
              const partY = (part: import("phaser").GameObjects.Image) => part.setY(artOffsetY);
              partY(me.base);
              partY(me.socket);
              partY(me.defender);
              partY(me.rim);
              me.shadow.setPosition(0, artOffsetY + (authoredTeam ? (core ? 9 : 7) : core ? 5 : 3)).setAlpha(s.alive ? (authoredTeam ? 0.3 : 0.38) : 0.22);
              me.teamAccent.clear();
              if (!authoredTeam) {
                const accent = structureCol(s.owner);
                const flagTop = core ? -47 : -40;
                const flagHeight = core ? 23 : 19;
                const flagWidth = core ? 10 : 8;
                // Small pennants and a halo make the seat colour legible without
                // tinting the authored stone and Chog art as one flat sprite.
                // v003 art paints its own red/blue banners and gems instead.
                me.teamAccent.fillStyle(accent, 0.96);
                me.teamAccent.fillRect(-20, flagTop, flagWidth, flagHeight);
                me.teamAccent.fillTriangle(-20, flagTop + flagHeight, -20 + flagWidth, flagTop + flagHeight, -20 + flagWidth / 2, flagTop + flagHeight + 6);
                me.teamAccent.fillRect(12, flagTop, flagWidth, flagHeight);
                me.teamAccent.fillTriangle(12, flagTop + flagHeight, 12 + flagWidth, flagTop + flagHeight, 12 + flagWidth / 2, flagTop + flagHeight + 6);
                me.teamAccent.lineStyle(1, 0xfff7d6, 0.72);
                me.teamAccent.strokeRect(-20, flagTop, flagWidth, flagHeight);
                me.teamAccent.strokeRect(12, flagTop, flagWidth, flagHeight);
                me.teamAccent.lineStyle(2, accent, 0.88).strokeCircle(0, core ? -26 : -23, core ? 16 : 13);
              }
              me.teamAccent.setPosition(0, artOffsetY).setAlpha(s.alive ? 1 : 0.18);
              const fire = towerFires.get(s.id) ?? null;
              const prevDef = defenderStates.get(s.id) ?? newDefenderState();
              if (s.alive && prevDef.lastHp >= 0 && s.hp < prevDef.lastHp) {
                fx.push({
                  kind: "hit",
                  x: s.x,
                  y: s.y,
                  r: core ? 4.5 : 3.5,
                  color: s.owner === seat ? 0x9be7ff : 0xffa29a,
                  until: frame.tick + (reduced ? 2 : 4),
                });
              }
              const accepted = s.alive && fire !== null && fireFresh({ structureId: s.id, tick: fire.tick }, frame.tick) && !prevDef.firedKeys.includes(fireKey({ structureId: s.id, tick: fire.tick }));
              const st = updateDefender(
                prevDef,
                { hp: s.hp, fire: accepted && fire ? { structureId: s.id, tick: fire.tick } : null },
                now
              );
              defenderStates.set(s.id, st);
              if (s.alive) {
                if (me.rubble) {
                  me.rubble = false;
                  me.base.clearTint().setAlpha(1);
                  me.socket.setVisible(true);
                  me.defender.setVisible(true);
                  me.rim.setVisible(true);
                  me.teamAccent.setVisible(true);
                }
                const placement = arena ? placementFor(arena, s.kind, s.x, s.y) : null;
                // Defender art stays upright, so the directional stance is
                // chosen by screen hemisphere, not the authored placement
                // direction (which is fixed per P0/P1 side). The top half
                // always aims down and the bottom half always aims up, even
                // while firing or hit.
                let pose = defenderPose(st, true, y, now, s.alive);
                if (missing.has(`${role}:defender-${pose}`) || !mrole.poses[pose]) pose = "idle";
                me.defender.setTexture(`${role}:defender-${pose}`);
                // Fire and hit read as overlay cues on the directional pose: a
                // short recoil away from the aim direction and a warm flash.
                const cue = defenderCue(st, now);
                const recoil = cue === "fire" && !reduced ? (pose === "aim-north" ? 1.5 : -1.5) : 0;
                me.defender.setY(artOffsetY + recoil);
                if (cue === "hit") me.defender.setTint(0xff8a8a);
                else me.defender.clearTint();
                // Muzzle flash + instant tracer from the measured weapon
                // anchor of the firing pose to the authoritative target.
                if (accepted && fire && placement) {
                  const poseDef = mrole.poses[pose];
                  if (poseDef && poseDef.firingAllowed) {
                    const [wx, wy] = weaponScreen(placement.groundAnchorPixels, poseDef.weaponAnchorLocalBoardPixels, seat);
                    towerFx.push({ fx: wx, fy: wy + artOffsetY, tx: fire.x, ty: fire.y, born: now, dur: 120 });
                    if (vfx?.has("muzzle")) {
                      // Same anchor, target and ~120 ms window as the Graphics cue.
                      const m0 = toArena(wx, Math.max(7, wy + artOffsetY));
                      vfx.spawn([
                        { tex: "muzzle", x: m0.x, y: m0.y, life: 130, scale: 0.5, scale1: 0.7, alpha: 1, alpha1: 0, rot: (fire.tick % 7) * 0.4, tint: 0xffe27a, blend: "add", layer: "top" },
                        { tex: "glow", x: m0.x, y: m0.y, life: 160, scale: 0.8, scale1: 1.1, alpha: 0.8, alpha1: 0, tint: 0xffd36a, blend: "add", layer: "top" },
                        { tex: "streak", x: m0.x, y: m0.y, to: { x: fire.x, y: fire.y }, life: 110, scale: 0.85, alpha: 1, alpha1: 0.5, aim: true, tint: 0xfff1b0, blend: "add", layer: "top" },
                        burstAt(fire.x, fire.y, 0xffe9a8, 0.36, 200, 6),
                      ], now);
                    }
                  }
                }
                // HP bar from the authored mount rectangle (master px -> board px).
                const hb = mrole.healthBarLocalBoardRectangle;
                const visualY = y + artOffsetY;
                // Presentation clamp: the far Core's bar and number would sit
                // above the canvas edge. Keep them readable inside it.
                const barY = Math.max(16, visualY + hb[1] / 2);
                hpBar(x + (hb[0] + hb[2] / 2) / 2, barY, hb[2] / 2, s.hp, s.maxHp);
                label(`hp:${s.id}`, `${s.hp}`, x, barY - 9);
              } else if (!me.rubble) {
                // Destroyed: only the dimmed base remains, like rubble.
                me.rubble = true;
                me.socket.setVisible(false);
                me.defender.setVisible(false);
                me.rim.setVisible(false);
                me.teamAccent.setVisible(false);
                me.base.setTint(0x4b5563).setAlpha(0.45);
              }
            } else if (s.alive) {
              if (r) {
                const e = ensure(s.id, r, false, s.owner);
                updateEnt(e, s.id, s.x, s.y, s.hp, false, s.owner);
                const top = y - r.proposedDisplaySize.visibleHeight * displayScale(r);
                hpBar(x, top - 4, 36, s.hp, s.maxHp);
                label(`hp:${s.id}`, `${s.hp}`, x, top - 14);
              } else {
                og.fillStyle(col(s.owner), 0.9).fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
                og.lineStyle(2, 0x111827, 1).strokeRect(x - r0, y - r0, r0 * 2, r0 * 2);
                hpBar(x, y - r0 - 7, r0 * 2, s.hp, s.maxHp);
                label(s.id, `${s.kind === "core" ? "CORE" : "T"} ${s.hp}`, x, y);
              }
            } else if (r) {
              // Dead structures stay as dimmed rubble sprites.
              const e = ensure(s.id, r, false, s.owner);
              if (!e.rubble) {
                e.rubble = true;
                e.gone = null;
                e.img.setScale(e.baseScale).setPosition(0, 0).setRotation(0).setAlpha(0.45);
                e.img.setTint(0x4b5563);
                e.root.setAlpha(1);
                e.flashUntil = 0;
              }
              e.root.setPosition(x, y);
              e.root.setDepth(y);
            } else {
              og.fillStyle(0x4b5563, 0.5).fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
              og.lineStyle(2, 0x111827, 1).strokeRect(x - r0, y - r0, r0 * 2, r0 * 2);
              label(s.id, "rubble", x, y);
            }
          }
          // Presentation-only engagement for buildings. The Rift Sentry has no
          // public fire event, so it swings like a troop: active (past its
          // authoritative activeAt), with an enemy ground unit inside its
          // centre-distance range. The Totem's lure plays while an enemy unit
          // is near. Mortar and Burrow fire on their authoritative events.
          const unitFoes = (owner: number): Foe[] => [
            ...frame.troops.filter((t) => t.owner !== owner).map((t) => ({ x: t.x, y: t.y, r: 0, air: t.air })),
            ...frame.commanders.filter((c) => c.owner !== owner).map((c) => ({ x: c.x, y: c.y, r: 0 })),
          ];
          for (const b of frame.buildings) {
            const x = sx(b.x);
            const y = sy(b.y);
            const r = ent("building", b.cardId);
            const banim0 = unitAnimFor(unitManifest, b.cardId);
            const banim = banim0 && banim0.kind === "building" && !missing.has(unitTextureKey(banim0.entityId)) && this.textures.exists(unitTextureKey(banim0.entityId)) ? banim0 : null;
            let bmotion: UnitMotion | undefined;
            if (banim) {
              const active = frame.tick >= (buildingActiveAt.get(b.id) ?? -1);
              const foe = active && (b.cardId === "rift_sentry" || b.cardId === "decoy_totem") ? engagedFoe(b, banim.reach, unitFoes(b.owner), 0.5, banim.hitsAir) : null;
              const up = seat === 0 ? -1 : 1;
              bmotion = { moving: false, dx: 0, foe, heading: foe && b.cardId === "rift_sentry" ? { x: foe.x - b.x, y: up * (foe.y - b.y) } : null };
            }
            spriteOrFallback(
              b.id,
              r,
              b.x,
              b.y,
              b.hp,
              b.maxHp,
              0,
              false,
              b.owner,
              () => {
                const pr = (b.footprint + 0.5) * S;
                og.fillStyle(col(b.owner), 0.6).fillRect(x - pr, y - pr, pr * 2, pr * 2);
                og.lineStyle(2, b.cardId === "rift_sentry" ? 0xfbbf24 : b.cardId === "chog_burrow" ? 0xa78bfa : b.cardId === "rift_mortar" ? 0xf97316 : 0xd1d5db, 1).strokeRect(x - pr, y - pr, pr * 2, pr * 2);
                hpBar(x, y - pr - 6, pr * 2, b.hp, b.maxHp);
              },
              b.cardId === "rift_sentry" ? "SEN" : b.cardId === "chog_burrow" ? "BUR" : b.cardId === "rift_mortar" ? "MOR" : "TOT",
              banim,
              bmotion
            );
            if (b.nextSpawnAt !== undefined && b.spawnsLeft && b.spawnsLeft > 0) {
              const frac = 1 - Math.max(0, Math.min(1, (b.nextSpawnAt - frame.tick) / 50));
              const rr = ent("building", b.cardId);
              const top = banim
                ? y - banim.visibleHeight * banim.displayScale - 12
                : rr ? y - rr.proposedDisplaySize.visibleHeight * displayScale(rr) - 10 : y - (b.footprint + 0.5) * S - 10;
              og.lineStyle(2, banim ? 0x5ff0ff : 0xa78bfa, 0.9).beginPath().arc(x, top, 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2).strokePath();
            }
          }
          // Foes per owner for presentation-only engagement (air flagged, so
          // ground-only hitters skip it). Radii follow combat reach2: units by
          // center distance, footprints by ring.
          const foesOf = (owner: number): Foe[] => [
            ...frame.troops.filter((t) => t.owner !== owner).map((t) => ({ x: t.x, y: t.y, r: 0, air: t.air })),
            ...frame.commanders.filter((c) => c.owner !== owner).map((c) => ({ x: c.x, y: c.y, r: 0 })),
            ...frame.buildings.filter((b) => b.owner !== owner).map((b) => ({ x: b.x, y: b.y, r: b.footprint })),
            ...frame.structures.filter((s) => s.alive && s.owner !== owner).map((s) => ({ x: s.x, y: s.y, r: s.kind === "core" ? 4 : 3 })),
          ];
          const foeCache = new Map<number, Foe[]>();
          for (const u of frame.troops) {
            const p = lerp(u.id, u.x, u.y);
            const r = ent("troop", u.cardId);
            const anim0 = unitAnimFor(unitManifest, u.cardId);
            const anim = anim0 && !missing.has(unitTextureKey(anim0.entityId)) && this.textures.exists(unitTextureKey(anim0.entityId)) ? anim0 : null;
            let motion: UnitMotion | undefined;
            if (anim) {
              const before = prevPos.get(u.id);
              const dx = before ? u.x - before.x : 0;
              const dy = before ? u.y - before.y : 0;
              const moving = !!before && Math.hypot(dx, dy) > 0.01;
              if (!foeCache.has(u.owner)) foeCache.set(u.owner, foesOf(u.owner));
              const foe = moving ? null : engagedFoe(u, anim.reach, foeCache.get(u.owner)!, undefined, anim.hitsAir);
              // Screen y grows downward and seat 0 sees arena y flipped.
              const up = seat === 0 ? -1 : 1;
              const heading = foe ? { x: foe.x - u.x, y: up * (foe.y - u.y) } : moving ? { x: dx, y: up * dy } : null;
              motion = { moving, dx, foe, heading };
            }
            spriteOrFallback(
              u.id,
              r,
              p.x,
              p.y,
              u.hp,
              u.maxHp,
              u.shield,
              u.air,
              u.owner,
              () => {
                const x = sx(p.x);
                const y = sy(p.y);
                if (u.air) {
                  og.fillStyle(0x000000, 0.3).fillCircle(x, y + 6, 4);
                  og.fillStyle(col(u.owner), 1).fillTriangle(x, y - 9, x - 7, y + 3, x + 7, y + 3);
                } else og.fillStyle(col(u.owner), 1).fillCircle(x, y, 6);
                hpBar(x, y - 14, 14, u.hp, u.maxHp, u.shield);
              },
              (start.catalog[u.cardId]?.name ?? u.cardId).slice(0, 2),
              anim,
              motion
            );
          }
          for (const c of frame.commanders) {
            const p = lerp(c.id, c.x, c.y);
            const r = manifest ? resolveCommanderAsset(manifest, c.cls) : null;
            // Class sheet (shared by every commander of the class, never a
            // specific NFT's likeness), with the static class art as fallback.
            const canim0 = unitAnimFor(unitManifest, commanderAnimId(c.cls));
            const canim = canim0 && !missing.has(unitTextureKey(canim0.entityId)) && this.textures.exists(unitTextureKey(canim0.entityId)) ? canim0 : null;
            let cmotion: UnitMotion | undefined;
            if (canim) {
              const before = prevPos.get(c.id);
              const dx = before ? c.x - before.x : 0;
              const dy = before ? c.y - before.y : 0;
              const moving = !!before && Math.hypot(dx, dy) > 0.01;
              if (!foeCache.has(c.owner)) foeCache.set(c.owner, foesOf(c.owner));
              const foe = moving ? null : engagedFoe(c, canim.reach, foeCache.get(c.owner)!, undefined, canim.hitsAir);
              const up = seat === 0 ? -1 : 1;
              const heading = foe ? { x: foe.x - c.x, y: up * (foe.y - c.y) } : moving ? { x: dx, y: up * dy } : null;
              cmotion = { moving, dx, foe, heading };
            }
            spriteOrFallback(
              c.id,
              r && !missing.has(r.stableAssetId!) ? r : null,
              p.x,
              p.y,
              c.hp,
              c.maxHp,
              c.shield,
              false,
              c.owner,
              () => {
                const x = sx(p.x);
                const y = sy(p.y);
                og.fillStyle(col(c.owner), 1).fillCircle(x, y, 10);
                og.lineStyle(3, 0xfbbf24, 1).strokeCircle(x, y, 11);
                hpBar(x, y - 19, 24, c.hp, c.maxHp, c.shield);
              },
              c.cls.slice(0, 2).toUpperCase(),
              canim,
              cmotion
            );
          }
          // Impact telegraphs and in-flight shells.
          const seenImpacts = new Set<string>();
          const vfxI = vfx && vfx.has("ring") && vfx.has("comet") ? vfx : null;
          for (const i of frame.impacts) {
            if (!vfxI) break;
            // Final-asset flight: progress runs from the first frame the
            // pending impact appeared to its authoritative impactTick.
            if (!impactFirstTick.has(i.id)) impactFirstTick.set(i.id, frame.tick);
            const total = Math.max(1, i.impactTick - impactFirstTick.get(i.id)!);
            const p = Math.max(0, Math.min(1, 1 - (i.impactTick - frame.tick - t) / total));
            const radius = i.radius ?? start.catalog[i.cardId]?.radius ?? 6;
            const mortar = i.cardId === "rift_mortar";
            const color = mortar ? VFX_COLORS.mortar : VFX_COLORS.comet;
            const tx = sx(i.x);
            const ty = sy(i.y);
            const tele = vfxI.keyedImage(`tele:${i.id}`, "ring", "ground", "add", color);
            tele?.setPosition(tx, ty).setScale((radius * S) / TEX_RADIUS.ring).setAlpha(0.45 + 0.35 * Math.abs(Math.sin(now / 140)));
            const shade = vfxI.keyedImage(`shade:${i.id}`, "glow", "ground", "normal", 0x1a0d26);
            shade?.setPosition(tx, ty).setScale(0.5 + p * 1.2).setAlpha(0.15 + 0.3 * p);
            let hx: number;
            let hy: number;
            let ang: number;
            if (mortar) {
              const src = frame.buildings
                .filter((b) => b.cardId === "rift_mortar" && b.owner === i.owner)
                .sort((a, b) => (a.x - i.x) ** 2 + (a.y - i.y) ** 2 - ((b.x - i.x) ** 2 + (b.y - i.y) ** 2))[0];
              const be = src ? pool.get(src.id) : undefined;
              const tip = be?.anim ? anchorOffset(be.anim, "muzzle", be.view, "attack", be.facingX < 0) : null;
              const ox = src ? sx(src.x) + (tip?.x ?? 0) : tx;
              const oy = src ? sy(src.y) + (tip?.y ?? -20) : ty - 60;
              const arc = 46;
              const at2 = (q: number) => [ox + (tx - ox) * q, oy + (ty - oy) * q - Math.sin(q * Math.PI) * arc] as const;
              [hx, hy] = at2(p);
              const [nx, ny] = at2(Math.min(1, p + 0.04));
              ang = Math.atan2(ny - hy, nx - hx);
              vfxI.keyedImage(`shell:${i.id}`, "glow", "top", "add", VFX_COLORS.mortar)?.setPosition(hx, hy).setScale(0.62).setAlpha(1);
              vfxI.keyedImage(`shellcore:${i.id}`, "spark", "top", "add", VFX_COLORS.mortarCore)?.setPosition(hx, hy).setScale(0.36).setRotation(now / 90).setAlpha(1);
              vfxI.keyedImage(`trail:${i.id}`, "streak", "top", "add", VFX_COLORS.mortar)?.setOrigin(0.95, 0.5).setPosition(hx, hy).setRotation(ang).setScale(0.75, 0.9).setAlpha(0.85);
            } else {
              // Comet: falls from the upper left on an accelerating line.
              const e2 = p * p;
              const ox = tx - 80;
              const oy = ty - 190;
              hx = ox + (tx - ox) * e2;
              hy = oy + (ty - oy) * e2;
              ang = Math.atan2(ty - oy, tx - ox);
              vfxI.keyedImage(`trail:${i.id}`, "comet-trail", "top", "add")?.setOrigin(0.92, 0.5).setPosition(hx, hy).setRotation(ang).setScale(0.55 + 0.25 * p, 0.62).setAlpha(Math.min(1, p * 4));
              vfxI.keyedImage(`cglow:${i.id}`, "glow", "top", "add", VFX_COLORS.comet)?.setPosition(hx, hy).setScale(1.1).setAlpha(Math.min(1, p * 4) * 0.9);
              vfxI.keyedImage(`rock:${i.id}`, "comet", "top", "normal")?.setPosition(hx, hy).setScale(0.42).setFrame(Math.floor(now / 60) % 6).setAlpha(Math.min(1, p * 5));
            }
            seenImpacts.add(i.id);
          }
          for (const i of vfxI ? [] : frame.impacts) {
            const r = (i.radius ?? start.catalog[i.cardId]?.radius ?? 6) * S;
            og.lineStyle(2, i.cardId === "rift_mortar" ? 0xf97316 : 0xfde047, 0.9).strokeCircle(sx(i.x), sy(i.y), r);
            seenImpacts.add(i.id);
            let imgs = impactPool.get(i.id);
            if (!imgs) {
              imgs = [];
              impactPool.set(i.id, imgs);
            }
            if (i.cardId === "rift_mortar") {
              const src = frame.buildings
                .filter((b) => b.cardId === "rift_mortar" && b.owner === i.owner)
                .sort((a, b) => (a.x - i.x) ** 2 + (a.y - i.y) ** 2 - ((b.x - i.x) ** 2 + (b.y - i.y) ** 2))[0];
              if (src) {
                og.lineStyle(1, 0xf97316, 0.5).moveTo(sx(src.x), sy(src.y)).lineTo(sx(i.x), sy(i.y)).strokePath();
                const shell = manifest && rec("effect:projectile");
                if (shell) {
                  let img = imgs.find((im) => im.name === "shell");
                  if (!img) {
                    img = this.add.image(0, 0, "effect:projectile").setName("shell").setDepth(1500);
                    imgs.push(img);
                  }
                  const pr = Math.max(0, Math.min(1, 1 - (i.impactTick - frame.tick) / 15));
                  const px = sx(src.x + (i.x - src.x) * pr);
                  const py = sy(src.y) + (sy(i.y) - sy(src.y)) * pr - Math.sin(pr * Math.PI) * 22;
                  img.setPosition(px, py).setScale(displayScale(shell) * 0.7);
                  img.setRotation(Math.atan2(sy(i.y) - sy(src.y), sx(i.x) - sx(src.x)) + Math.PI / 2);
                }
              }
            } else if (manifest) {
              // Spell pending impact: the spell's own art pulses at the point.
              const spellRec = ent("spell", i.cardId);
              if (spellRec) {
                let img = imgs.find((im) => im.name === "spell");
                if (!img) {
                  img = this.add.image(0, 0, spellRec.stableAssetId).setName("spell").setDepth(1500);
                  imgs.push(img);
                }
                const pulse = 0.65 + 0.35 * Math.sin(now / 120);
                img.setPosition(sx(i.x), sy(i.y) - 8).setScale(displayScale(spellRec) * pulse).setAlpha(0.85);
              }
            }
          }
          for (const [id, imgs] of impactPool) {
            if (seenImpacts.has(id)) continue;
            for (const im of imgs) im.destroy();
            impactPool.delete(id);
          }
          // Structure no-go margins while placing a ground card.
          if (placing && placing.kind !== "spell") {
            for (const s of [...frame.structures.filter((s) => s.alive).map((s) => ({ x: s.x, y: s.y, r: s.kind === "core" ? 4 : 3 })), ...frame.buildings.map((b) => ({ x: b.x, y: b.y, r: b.footprint }))]) {
              const r = (s.r + 2.5) * S;
              og.lineStyle(1, 0xef4444, 0.6).strokeRect(sx(s.x) - r, sy(s.y) - r, r * 2, r * 2);
            }
          }
          // Projectiles: primitive image rotated toward target when available.
          const seenProj = new Set<string>();
          const projRec = manifest ? rec("effect:projectile") : null;
          const vfxProj = !!vfx && vfx.has("glow") && vfx.has("streak");
          for (const pr of frame.projectiles) {
            const tgt = all.get(pr.targetId);
            seenProj.add(pr.id);
            if (vfxProj && vfx) {
              // Element-coloured bolt with a short trail, styled by its shooter.
              let style = projStyles.get(pr.id);
              if (!style) {
                style = projectileStyleFor(pr, frame.troops);
                projStyles.set(pr.id, style);
              }
              const X = sx(pr.x);
              const Y = sy(pr.y) - 10;
              const ang = tgt ? Math.atan2(sy(tgt.y) - 10 - Y, sx(tgt.x) - X) : 0;
              const color = style === "spark" ? VFX_COLORS.spark2 : style === "hex" ? VFX_COLORS.hex : style === "net" ? VFX_COLORS.gale : 0xfff4d6;
              vfx.keyedImage(`ptrail:${pr.id}`, "streak", "top", "add", color)?.setOrigin(0.92, 0.5).setPosition(X, Y).setRotation(ang).setScale(0.6, 0.8).setAlpha(0.8);
              if (style === "net") vfx.keyedImage(`pnet:${pr.id}`, "net", "top", "normal")?.setPosition(X, Y).setScale(0.42).setRotation(now / 120);
              else {
                vfx.keyedImage(`pglow:${pr.id}`, "glow", "top", "add", color)?.setPosition(X, Y).setScale(style === "plain" ? 0.32 : 0.46);
                vfx.keyedImage(`pcore:${pr.id}`, "spark", "top", "add", style === "spark" ? 0xffffff : color)?.setPosition(X, Y).setScale(0.3).setRotation(now / 70);
              }
              continue;
            }
            if (projRec) {
              let img = projPool.get(pr.id);
              if (!img) {
                img = this.add.image(0, 0, "effect:projectile").setDepth(1500);
                projPool.set(pr.id, img);
              }
              img.setPosition(sx(pr.x), sy(pr.y)).setScale(displayScale(projRec) * 0.45);
              if (tgt) img.setRotation(Math.atan2(sy(tgt.y) - sy(pr.y), sx(tgt.x) - sx(pr.x)));
            } else {
              og.fillStyle(0xfef08a, 1).fillCircle(sx(pr.x), sy(pr.y), 3);
              if (tgt) og.lineStyle(1, 0xfef08a, 0.4).lineBetween(sx(pr.x), sy(pr.y), sx(tgt.x), sy(tgt.y));
            }
          }
          for (const [id, img] of projPool) {
            if (!seenProj.has(id)) {
              img.destroy();
              projPool.delete(id);
            }
          }
          for (const id of projStyles.keys()) if (!seenProj.has(id)) projStyles.delete(id);
          for (const id of impactFirstTick.keys()) if (!seenImpacts.has(id)) impactFirstTick.delete(id);
          // Transient event effects, collected once per authoritative event.
          const spawnFx = (prim: SpriteRecord | undefined, ax: number, ay: number, size: number, dur: number) => {
            if (!prim || missing.has(prim.stableAssetId)) return;
            const img = this.add.image(sx(ax), sy(ay), prim.stableAssetId).setDepth(1600);
            const s = displayScale(prim) * size;
            img.setScale(s * 0.75).setAlpha(0.9);
            fxImgs.push({ img, born: now, dur: reduced ? Math.min(110, dur) : dur, s0: s * 0.75, s1: reduced ? s * 0.75 : s * 1.1 });
          };
          const nonProjectile = (reqId: string): SpriteRecord[] => {
            if (!manifest) return [];
            return (manifest.bindings.effectRequirementIds[reqId] ?? [])
              .filter((id) => id !== "effect:projectile")
              .map((id) => byId(manifest, id))
              .filter((r0): r0 is SpriteRecord => r0 !== null);
          };
          const prevAll = new Map<string, { x: number; y: number }>();
          for (const u of [...(prev?.troops ?? []), ...(prev?.commanders ?? []), ...(prev?.buildings ?? []), ...(prev?.structures ?? [])]) prevAll.set(u.id, u);
          const lungeTo = (entId: unknown, tx: number, ty: number) => {
            const e = pool.get(String(entId));
            const at = all.get(String(entId));
            if (!e || !at) return;
            const dx = tx - at.x;
            const dy = ty - at.y;
            const len = Math.hypot(dx, dy) || 1;
            e.lunge = { dx: dx / len, dy: dy / len, start: now };
          };
          const beginAttack = (cue: BattleAnimationCue) => {
            const e = pool.get(cue.entityId);
            if (!e) return;
            const at = all.get(cue.entityId) ?? prevAll.get(cue.entityId);
            const target = cue.targetId ? all.get(cue.targetId) ?? prevAll.get(cue.targetId) : null;
            let dx = 0;
            let dy = 0;
            if (at && target) {
              dx = sx(target.x) - sx(at.x);
              dy = sy(target.y) - sy(at.y);
              const length = Math.hypot(dx, dy) || 1;
              dx /= length;
              dy /= length;
              if (Math.abs(dx) > 0.01) e.facingX = dx < 0 ? -1 : 1;
            }
            e.attack = { dx, dy, start: now };
          };
          const applyAnimationCue = (cue: BattleAnimationCue) => {
            const e = pool.get(cue.entityId);
            if (!e) return;
            if (cue.kind === "spawn") {
              e.born = now;
              e.gone = null;
              e.rubble = false;
              e.root.setAlpha(1);
            } else if (cue.kind === "attack") {
              beginAttack(cue);
            } else if (cue.kind === "hit") {
              e.flashUntil = Math.max(e.flashUntil, now + 140);
            } else if (cue.kind === "death") {
              e.gone ??= now;
            }
          };
          const vfxOn = !!vfx && vfx.has("burst");
          const statusUnits: StatusUnit[] = [
            ...frame.troops.map((t) => ({ id: t.id, owner: t.owner, x: t.x, y: t.y, kind: "troop" as const, cardId: t.cardId })),
            ...frame.commanders.map((c) => ({ id: c.id, owner: c.owner, x: c.x, y: c.y, kind: "commander" as const, cardId: c.cardId })),
          ];
          const spellCtx = { radius: (id: string) => start.catalog[id]?.radius, reduced };
          for (const e of frame.events as FrameEvent[]) {
            const key = combatEventKey(e);
            if (seenEventKeys.has(key)) continue;
            seenEventKeys.add(key);
            if (seenEventKeys.size > 512) {
              const oldest = seenEventKeys.values().next().value;
              if (oldest) seenEventKeys.delete(oldest);
            }
            const at = (id: unknown) => all.get(String(id)) ?? prevAll.get(String(id));
            const until = frame.tick + (reduced ? 3 : 6);
            // Animation-sheet triggers, independent of the VFX pack.
            if (e.type === "building_spawned") buildingActiveAt.set(String(e.buildingId), Number(e.activeAt));
            else if (e.type === "unit_spawned") {
              const be = pool.get(String(e.buildingId));
              if (be?.anim) be.animSt = { ...be.animSt, firedAt: now };
            } else if (e.type === "siege_fired") {
              const be = pool.get(String(e.buildingId));
              const bp = at(e.buildingId);
              if (be?.anim && bp) {
                const up = seat === 0 ? -1 : 1;
                be.view = nextView(be.view, Number(e.x) - bp.x, up * (Number(e.y) - bp.y));
                if (Math.abs(Number(e.x) - bp.x) > 0.01) be.facingX = Number(e.x) < bp.x ? -1 : 1;
                be.animSt = { ...be.animSt, firedAt: now };
              }
            } else if (e.type === "ability_fired" && e.trigger === "active") {
              const self = commanderEntityFor(e, statusUnits);
              const ce = self ? pool.get(self.id) : undefined;
              if (ce?.anim?.clips.ability) ce.animSt = { ...ce.animSt, castAt: now };
            }
            if (vfxOn && vfx) {
              // Final-asset effects. Each branch mirrors the event it presents.
              for (const s of statusesFromEvent(e, statusUnits)) statuses.set(s.key, s);
              const team = Number(e.player) === seat ? OWN : FOE;
              if (e.type === "deploy") {
                // Allegiance summon circle under every deployed entity.
                const ids = ((e.entityIds as unknown[] | undefined) ?? []).map(String);
                const sp: VfxSprite[] = [];
                for (const id of ids.slice(0, 4)) {
                  const p = at(id);
                  if (!p) continue;
                  const big = String(e.cardId).startsWith("cmdr:") || start.catalog[String(e.cardId)]?.kind === "building";
                  sp.push(
                    { tex: "summon", x: p.x, y: p.y, life: reduced ? 220 : 520, scale: big ? 0.36 : 0.24, scale1: big ? 0.46 : 0.32, alpha: 0.95, alpha1: 0, rot: 0, spin: 1.2, tint: team, blend: "add", layer: "ground", ease: "out" },
                    { tex: "glow", x: p.x, y: p.y, life: reduced ? 160 : 300, scale: big ? 1.2 : 0.8, scale1: big ? 1.5 : 1, alpha: 0.6, alpha1: 0, tint: team, blend: "add", layer: "ground" }
                  );
                }
                vfx.spawn(sp, now);
              } else if (e.type === "spell_cast") {
                vfx.spawn(spellCastVfx(e, spellCtx), now);
              } else if (e.type === "spell_impact") {
                vfx.spawn(spellImpactVfx(e, spellCtx), now);
              } else if (e.type === "ability_fired") {
                vfx.spawn(abilityVfx(e, statusUnits, reduced), now);
                const self = commanderEntityFor(e, statusUnits);
                if (self && !pool.get(self.id)?.anim) lungeTo(self.id, Number(e.x), Number(e.y));
              } else if (e.type === "shockwave") {
                const p = at(e.entityId);
                if (p) {
                  vfx.spawn([
                    ringAt(p.x, p.y, 4, VFX_COLORS.comet, reduced ? 160 : 320, { scale: 0.1, scale1: (4 * VFX_S) / TEX_RADIUS.ring, ease: "out" }),
                    burstAt(p.x, p.y, VFX_COLORS.comet, 0.5, 220, 4),
                  ], now);
                  const tgt = at(e.primaryId);
                  if (tgt) lungeTo(e.entityId, tgt.x, tgt.y);
                }
              } else if (e.type === "siege_fired") {
                // Mortar: recoil clip, muzzle flash and smoke at the barrel,
                // the barrel view turned toward the authoritative target.
                const be = pool.get(String(e.buildingId));
                const bp = at(e.buildingId);
                if (be?.anim && bp) {
                  const tip = anchorOffset(be.anim, "muzzle", be.view, "attack", be.facingX < 0);
                  const m0 = tip ? toArena(sx(bp.x) + tip.x, sy(bp.y) + tip.y) : bp;
                  const rnd = seeded(String(e.impactId));
                  vfx.spawn([
                    { tex: "muzzle", x: m0.x, y: m0.y, delay: 50, life: 180, scale: 0.6, scale1: 0.85, alpha: 1, alpha1: 0, rot: rnd() * 3, tint: VFX_COLORS.mortar, blend: "add", layer: "top" },
                    { tex: "glow", x: m0.x, y: m0.y, delay: 50, life: 260, scale: 1.0, scale1: 1.4, alpha: 0.9, alpha1: 0, tint: VFX_COLORS.mortarCore, blend: "add", layer: "top" },
                    { tex: "smoke", animate: true, x: m0.x, y: m0.y, delay: 60, life: 520, lift: 0, lift1: 14, scale: 0.5, scale1: 0.8, alpha: 0.85, blend: "normal", layer: "top" },
                  ], now);
                } else lungeTo(e.buildingId, Number(e.x), Number(e.y));
              } else if (e.type === "building_spawned") {
                const rnd = seeded(String(e.buildingId));
                vfx.spawn([
                  ...Array.from({ length: reduced ? 0 : 3 }, (_, i) => ({ tex: "smoke", animate: true, x: Number(e.x) + (rnd() - 0.5) * 4, y: Number(e.y) + (rnd() - 0.5) * 3, delay: i * 60, life: 560, lift: 0, lift1: 10, scale: 0.55, scale1: 0.8, alpha: 0.8, blend: "normal" as const, layer: "top" as const })),
                ], now);
              } else if (e.type === "unit_spawned") {
                // Burrow spawn: dirt and a small summon circle at the scrapper.
                const bp = at(e.buildingId);
                const owner = bp ? frame.buildings.find((b) => b.id === String(e.buildingId))?.owner : undefined;
                vfx.spawn([
                  { tex: "summon", x: Number(e.x), y: Number(e.y), life: reduced ? 200 : 420, scale: 0.18, scale1: 0.26, alpha: 0.9, alpha1: 0, spin: 1.5, tint: owner === undefined ? VFX_COLORS.rift : owner === seat ? OWN : FOE, blend: "add", layer: "ground", ease: "out" },
                  { tex: "smoke", animate: true, x: Number(e.x), y: Number(e.y), life: 460, lift: 0, lift1: 8, scale: 0.42, scale1: 0.62, alpha: 0.8, blend: "normal", layer: "top" },
                ], now);
              } else if (e.type === "building_removed") {
                const p = at(e.buildingId);
                if (p) {
                  const rnd = seeded(`${String(e.buildingId)}:gone`);
                  const destroyed = e.reason === "destroyed";
                  vfx.spawn([
                    ...Array.from({ length: reduced ? 1 : destroyed ? 4 : 2 }, (_, i) => ({ tex: "smoke", animate: true, x: p.x + (rnd() - 0.5) * 4, y: p.y + (rnd() - 0.5) * 3, delay: i * 50, life: 640, lift: 2, lift1: 14, scale: destroyed ? 0.75 : 0.55, scale1: destroyed ? 1.05 : 0.8, alpha: 0.85, blend: "normal" as const, layer: "top" as const })),
                    ...(destroyed && !reduced ? Array.from({ length: 6 }, () => { const a = rnd() * Math.PI * 2; return { tex: "debris", frame: Math.floor(rnd() * 4), x: p.x, y: p.y, to: { x: p.x + Math.cos(a) * 5, y: p.y + Math.sin(a) * 4 }, lift: 8, lift1: 0, arc: 20, life: 520, scale: 0.7, alpha: 1, alpha1: 0.3, spin: (rnd() - 0.5) * 10, blend: "normal" as const, layer: "top" as const }; }) : []),
                  ], now);
                }
              } else if (e.type === "pulse_warning" || e.type === "pulse_active" || e.type === "pulse_expired") {
                const pulseState = e.type === "pulse_warning" ? "warning" : e.type === "pulse_active" ? "active" : "expired";
                fx.push({ kind: "pulse", x: 0, y: 0, r: 0, color: chaosFamilyColor(String(e.family)), until: frame.tick + (reduced ? 2 : pulseState === "active" ? 8 : 5), pulseState });
              } else if (e.type === "death") {
                // Defeat poof: a soft dust puff and a few sparkles, so small
                // units vanish cleanly without an opaque flash.
                const p = at(e.entityId);
                if (p) {
                  const rnd = seeded(String(e.entityId));
                  const air = frame.troops.find((t) => t.id === String(e.entityId))?.air ?? prev?.troops.find((t) => t.id === String(e.entityId))?.air ?? false;
                  vfx.spawn([
                    { tex: "smoke", animate: true, x: p.x, y: p.y, delay: 120, life: reduced ? 220 : 520, lift: air ? 18 : 4, lift1: air ? 22 : 14, scale: 0.5, scale1: 0.75, alpha: 0.85, blend: "normal", layer: "top" },
                    ...Array.from({ length: reduced ? 0 : 4 }, () => { const a = rnd() * Math.PI * 2; return { tex: "spark", x: p.x, y: p.y, to: { x: p.x + Math.cos(a) * 2.4, y: p.y + Math.sin(a) * 2 }, delay: 120, lift: 12, lift1: 22, life: 420, scale: 0.32, scale1: 0.1, alpha: 1, alpha1: 0, spin: 6, tint: VFX_COLORS.spark, blend: "add" as const, layer: "top" as const, ease: "out" as const }; }),
                  ], now);
                }
              } else if (e.type === "structure_destroyed") {
                const p = at(e.entityId);
                if (p) {
                  const rnd = seeded(String(e.entityId));
                  vfx.spawn([
                    burstAt(p.x, p.y, VFX_COLORS.comet, 1.3, reduced ? 200 : 420, 18),
                    ...Array.from({ length: reduced ? 1 : 6 }, (_, i) => ({ tex: "smoke", animate: true, x: p.x + (rnd() - 0.5) * 7, y: p.y + (rnd() - 0.5) * 5, delay: i * 70, life: 820, lift: 6, lift1: 26, scale: 0.95, scale1: 1.35, alpha: 0.9, blend: "normal" as const, layer: "top" as const })),
                    ...(reduced ? [] : Array.from({ length: 10 }, () => { const a = rnd() * Math.PI * 2; return { tex: "debris", frame: Math.floor(rnd() * 4), x: p.x, y: p.y, to: { x: p.x + Math.cos(a) * 8, y: p.y + Math.sin(a) * 6 }, lift: 20, lift1: 0, arc: 30, life: 700, scale: 0.9, alpha: 1, alpha1: 0.3, spin: (rnd() - 0.5) * 10, blend: "normal" as const, layer: "top" as const }; })),
                  ], now);
                }
              }
              continue;
            }
            if (e.type === "deploy") {
              const p = at((e.entityIds as unknown[] | undefined)?.[0]);
              if (p) fx.push({ kind: "ring", x: p.x, y: p.y, r: 5, color: Number(e.player) === seat ? 0x22c55e : 0xf87171, until: frame.tick + (reduced ? 3 : 6) });
            } else if (e.type === "spell_cast" || e.type === "spell_impact") {
              const x = Number(e.x);
              const y = Number(e.y);
              const radius = start.catalog[String(e.cardId)]?.radius ?? 6;
              fx.push({ kind: "flash", x, y, r: radius, color: 0xfde047, until });
              if (e.type === "spell_impact") {
                const req = String(e.cardId) === "rift_mortar" ? "rift_mortar_shell" : `${e.cardId}_effect`;
                for (const prim of nonProjectile(req)) spawnFx(prim, x, y, 1.4, 260);
                const affected = Number(e.units ?? 0) + Number(e.buildings ?? 0) + Number(e.structures ?? 0);
                if (affected > 0) fx.push({ kind: "hit", x, y, r: Math.max(2, radius * 0.55), color: 0xfff1c1, until: frame.tick + (reduced ? 2 : 4) });
              }
            } else if (e.type === "ability_fired") {
              const x = Number(e.x);
              const y = Number(e.y);
              fx.push({ kind: "ring", x, y, r: Number(e.radius ?? 4), color: 0xfbbf24, until: frame.tick + (reduced ? 4 : 8) });
              fx.push({ kind: "flash", x, y, r: Math.max(3, Number(e.radius ?? 4) * 0.55), color: 0xffe7a1, until });
              if (manifest) for (const prim of effectForAbility(manifest, String(e.abilityId))) spawnFx(prim, x, y, 1.2, 260);
              lungeTo(e.commanderId, x, y);
            } else if (e.type === "shockwave") {
              const p = at(e.entityId);
              if (p) {
                fx.push({ kind: "ring", x: p.x, y: p.y, r: 4, color: 0xf97316, until: frame.tick + (reduced ? 2 : 3) });
                for (const prim of nonProjectile("ember_mauler_shockwave")) spawnFx(prim, p.x, p.y, 1.2, 220);
                const tgt = at(e.primaryId);
                if (tgt) lungeTo(e.entityId, tgt.x, tgt.y);
              }
            } else if (e.type === "siege_fired") {
              lungeTo(e.buildingId, Number(e.x), Number(e.y));
            } else if (e.type === "building_spawned") {
              fx.push({ kind: "ring", x: Number(e.x), y: Number(e.y), r: 4, color: Number(e.player) === seat ? OWN : FOE, until: frame.tick + (reduced ? 3 : 5) });
              const prim = manifest ? byId(manifest, "effect:aura") : null;
              if (prim) spawnFx(prim, Number(e.x), Number(e.y), 0.9, 220);
            } else if (e.type === "unit_spawned") {
              const prim = manifest ? byId(manifest, "effect:aura") : null;
              if (prim) spawnFx(prim, Number(e.x), Number(e.y), 0.8, 200);
            } else if (e.type === "pulse_warning" || e.type === "pulse_active" || e.type === "pulse_expired") {
              const pulseState = e.type === "pulse_warning" ? "warning" : e.type === "pulse_active" ? "active" : "expired";
              fx.push({ kind: "pulse", x: 0, y: 0, r: 0, color: chaosFamilyColor(String(e.family)), until: frame.tick + (reduced ? 2 : pulseState === "active" ? 8 : 5), pulseState });
            } else if (e.type === "death") {
              const p = at(e.entityId);
              if (p) {
                fx.push({ kind: "death", x: p.x, y: p.y, r: 2, color: 0xffffff, until: frame.tick + (reduced ? 3 : 5) });
                const prim = manifest ? byId(manifest, "effect:impact") : null;
                if (prim) spawnFx(prim, p.x, p.y, 1.35, 180);
              }
            } else if (e.type === "structure_destroyed") {
              const p = at(e.entityId);
              if (p) {
                fx.push({ kind: "boom", x: p.x, y: p.y, r: 8, color: 0xf97316, until: frame.tick + (reduced ? 4 : 12) });
                const prim = manifest ? byId(manifest, "effect:impact") : null;
                if (prim) spawnFx(prim, p.x, p.y, 2.6, 300);
              }
            }
          }
          // Apply presentation cues once per authoritative tick. A resumed
          // seat primes these keys so historical events never replay after a
          // reconnect. The cue source is event/HP state only, never a client
          // prediction.
          if (frame.tick !== animationTick) {
            const cues = battleAnimationCues(frame, prev);
            const unseen = animationPriming
              ? (cues.forEach((cue) => animationSeenKeys.add(cue.key)), [])
              : takeUnseenBattleAnimationCues(cues, animationSeenKeys);
            animationPriming = false;
            animationTick = frame.tick;
            for (const cue of unseen) applyAnimationCue(cue);
          }
          for (let i = fx.length - 1; i >= 0; i--) {
            const e = fx[i]!;
            if (e.until < frame.tick) {
              fx.splice(i, 1);
              continue;
            }
            const x = sx(e.x);
            const y = sy(e.y);
            if (e.kind === "flash") og.fillStyle(e.color, 0.3).fillCircle(x, y, e.r * S);
            else if (e.kind === "ring") og.lineStyle(3, e.color, 0.9).strokeCircle(x, y, e.r * S);
            else if (e.kind === "boom") {
              og.fillStyle(e.color, 0.5).fillCircle(x, y, e.r * S);
              og.lineStyle(3, 0xffe4a8, 0.9).strokeCircle(x, y, e.r * S * 1.25);
            } else if (e.kind === "hit" && e.lift !== undefined) {
              // Animated unit: open ring around the body plus four short
              // sparks outside it. No fill, so the face and hit pose stay visible.
              const cy = y - e.lift;
              const rr = e.r * S;
              og.lineStyle(1.5, e.color, 0.9).strokeCircle(x, cy, rr);
              og.lineStyle(2, 0xfff8df, 0.95);
              for (const [ux, uy] of [[0.7, -0.7], [-0.7, -0.7], [0.95, 0.3], [-0.95, 0.3]] as const) {
                og.lineBetween(x + ux * (rr + 1), cy + uy * (rr + 1), x + ux * (rr + 5), cy + uy * (rr + 5));
              }
            } else if (e.kind === "hit") {
              og.fillStyle(0xfff8df, 0.45).fillCircle(x, y, Math.max(4, e.r * S * 0.7));
              og.lineStyle(2, e.color, 0.95).strokeCircle(x, y, e.r * S);
              og.lineStyle(2, 0xfff8df, 0.9).lineBetween(x - 5, y, x + 5, y).lineBetween(x, y - 5, x, y + 5);
            } else if (e.kind === "pulse") {
              const width = e.pulseState === "active" ? 7 : e.pulseState === "warning" ? 3 : 2;
              const alpha = e.pulseState === "active" ? 0.7 : e.pulseState === "warning" ? 0.55 : 0.35;
              og.lineStyle(width, e.color, alpha).strokeRect(4, 4, W - 8, H - 8);
            } else og.lineStyle(2, e.color, 0.9).lineBetween(x - 5, y - 5, x + 5, y + 5).lineBetween(x - 5, y + 5, x + 5, y - 5);
          }
          // Status markers, drawn only while the rule they mirror is active
          // and the unit is alive. Shields also need the authoritative shield.
          if (vfx) {
            const shieldOf = new Map(frame.commanders.map((c) => [c.id, c.shield]));
            for (const [key, s] of statuses) {
              const e = pool.get(s.entityId);
              if (frame.tick >= s.until || !e || e.gone !== null || !all.has(s.entityId)) {
                statuses.delete(key);
                continue;
              }
              const X = e.root.x;
              const Y = e.root.y + (e.air ? -10 : 0);
              const drawn = e.anim ? e.anim.visibleHeight * e.anim.displayScale : e.rec.proposedDisplaySize.visibleHeight * displayScale(e.rec);
              const pulse = 0.5 + 0.5 * Math.sin(now / 180 + e.phase);
              const feet = (tex: string, tint: number, scale: number, alpha: number) =>
                vfx!.keyedImage(`${key}:feet`, tex, "ground", tex === "snare-bind" ? "normal" : "add", tint)?.setPosition(X, Y).setScale(scale).setAlpha(alpha);
              const orbit = (tint: number, tex = "star") => {
                for (let k = 0; k < 2; k++) {
                  const ang = now / 420 + k * Math.PI + e.phase;
                  vfx!.keyedImage(`${key}:orb${k}`, tex, "top", "add", tint)?.setPosition(X + Math.cos(ang) * drawn * 0.32, Y - drawn - 4 + Math.sin(ang) * 3).setScale(0.26).setAlpha(0.9);
                }
              };
              const dome = (tint: number) => {
                if ((shieldOf.get(s.entityId) ?? 0) <= 0) return;
                vfx!.keyedImage(`${key}:dome`, "shield", "top", "add", tint)?.setPosition(X, Y - drawn * 0.5).setScale((drawn * 1.3) / (TEX_RADIUS.shield * 2)).setAlpha(0.45 + 0.2 * pulse);
              };
              const w = Math.max(18, drawn * 0.9);
              switch (s.kind) {
                case "rally":
                  feet("glow", VFX_COLORS.rally, w / 40, 0.35 + 0.2 * pulse);
                  orbit(VFX_COLORS.rally);
                  break;
                case "snare":
                  feet("snare-bind", 0xffffff, (w * 1.15) / 72, 0.75 + 0.25 * pulse);
                  break;
                case "aegis":
                  dome(VFX_COLORS.aegis);
                  break;
                case "null-shield":
                  dome(VFX_COLORS.warden);
                  break;
                case "bedrock":
                  feet("ground-ring", VFX_COLORS.bedrock, w / 120, 0.5 + 0.3 * pulse);
                  break;
                case "frenzy":
                  feet("ground-ring", VFX_COLORS.frenzy, w / 110, 0.6 + 0.3 * pulse);
                  vfx.keyedImage(`${key}:aura`, "glow", "top", "add", VFX_COLORS.frenzy)?.setPosition(X, Y - drawn * 0.45).setScale(drawn / 44).setAlpha(0.25 + 0.2 * pulse);
                  break;
                case "overwatch":
                  feet("ground-ring", VFX_COLORS.overwatch, w / 120, 0.45 + 0.25 * pulse);
                  vfx.keyedImage(`${key}:glint`, "spark", "top", "add", VFX_COLORS.overwatch)?.setPosition(X + drawn * 0.08, Y - drawn * 0.72).setScale(0.22 + 0.12 * pulse).setRotation(now / 300).setAlpha(0.9);
                  break;
                case "shadow":
                  feet("glow", VFX_COLORS.shadow, w / 36, 0.35 + 0.25 * pulse);
                  break;
                case "pathfinder":
                  feet("ground-ring", VFX_COLORS.pathfinder, w / 130, 0.45 + 0.25 * pulse);
                  break;
                case "null-slow":
                  feet("ground-ring", VFX_COLORS.warden, w / 120, 0.45 + 0.25 * pulse);
                  orbit(VFX_COLORS.warden);
                  break;
              }
            }
            vfx.update(now, project);
            vfx.sweep();
          }
          // Tower fire feedback: flash at the weapon anchor plus an instant
          // tracer to the authoritative target. Fades over ~120 ms; under
          // reduced motion both hold at constant alpha (no fade animation).
          for (let i = towerFx.length - 1; i >= 0; i--) {
            const e = towerFx[i]!;
            const p = (now - e.born) / e.dur;
            if (p >= 1) {
              towerFx.splice(i, 1);
              continue;
            }
            const a = reduced ? 0.9 : 0.9 * (1 - p);
            // Sprite version drawn at fire time (see the tower loop).
            if (vfx?.has("muzzle")) continue;
            // The far Core's weapon anchor can sit at the canvas edge. Keep
            // the whole flash on the board without moving the tracer target.
            const flashY = Math.max(7, e.fy);
            og.fillStyle(0xfde047, a).fillCircle(e.fx, flashY, 7);
            og.lineStyle(2, 0xfef08a, a).lineBetween(e.fx, flashY, sx(e.tx), sy(e.ty));
            og.fillStyle(0xffffff, a).fillCircle(sx(e.tx), sy(e.ty), 3);
          }
          for (let i = fxImgs.length - 1; i >= 0; i--) {
            const e = fxImgs[i]!;
            const p = (now - e.born) / e.dur;
            if (p >= 1) {
              e.img.destroy();
              fxImgs.splice(i, 1);
              continue;
            }
            e.img.setScale(e.s0 + (e.s1 - e.s0) * p).setAlpha(reduced ? 0.78 : 0.9 * (1 - p));
          }
          // Entities absent from the frame begin their death fade.
          for (const [id, e] of pool) {
            if (all.has(id) || e.gone !== null || e.rubble) continue;
            e.gone = now;
          }
          for (const [id, e] of pool) {
            if (e.gone === null) continue;
            if (e.anim) {
              // Animated units play their defeat clip in place, then fade.
              const el = now - e.gone;
              e.img.setFrame(unitFrame(e.anim, { ...e.animSt, goneAt: e.gone }, { now, moving: false, view: e.view }).frame).clearTint().setAlpha(1);
              e.root.setAlpha(defeatAlpha(e.anim, el));
              if (el < e.anim.defeatMs) continue;
            } else {
              // Static fallback sprites: updateEnt only runs for entities still
              // in the frame, so the death fade is applied here.
              const gp = Math.min(1, (now - e.gone) / (reduced ? 110 : 220));
              e.img.setAlpha(1 - gp);
              e.root.setAlpha(1 - gp * 0.6);
              if (now - e.gone < 220) continue;
            }
            e.root.destroy(true);
            pool.delete(id);
          }
          // Placement ghost: green when the advisory check passes, red otherwise.
          if (f.ghost) {
            const card = start.catalog[f.ghost.cardId];
            const r = Math.max(card?.radius ?? 0, card?.kind === "building" ? 3 : 2) * S;
            const color = f.ghost.ok ? 0x22c55e : 0xef4444;
            const x = sx(f.ghost.x);
            const y = sy(f.ghost.y);
            og.fillStyle(color, 0.3).fillCircle(x, y, r);
            og.lineStyle(2, color, 1).strokeCircle(x, y, r).lineBetween(x - 6, y, x + 6, y).lineBetween(x, y - 6, x, y + 6);
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
      // Dev-surface debug handle: lets the temporary harness assert that the
      // mounted structure art lands on the authoritative board points.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __battleGame?: import("phaser").Game }).__battleGame = game;
        (window as unknown as { __towerFx?: unknown[] }).__towerFx = towerFx;
      }
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [feed, seat]);

  // A press that starts and ends on the board without travelling is a tap.
  return (
    <div
      ref={host}
      data-testid="battle-board"
      data-seat={seat}
      style={{ width: "100%", maxWidth: 500, aspectRatio: "100 / 160", touchAction: "none", ...hostStyle }}
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
