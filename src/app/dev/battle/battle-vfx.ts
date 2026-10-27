// Pure VFX planning for the battle canvas (final asset milestone). No Phaser
// import. Every cue comes from an authoritative frame event or observed state
// and mirrors the rule it presents: spell radii, buff and slow durations,
// ability targets and timings come from the event and the ruleset, never from
// a prediction. BattleCanvas turns these specs into short-lived Phaser images,
// keeps their count bounded and destroys them when their life ends.
//
// Allegiance stays player-relative (friendly blue, enemy red) only for
// allegiance cues such as deploy circles. Elemental effects keep their own
// colours on both sides.

import type { FrameEvent } from "@/lib/battle-protocol";

export const VFX_URL = "/assets/battle-vfx/v001";
export const VFX_MANIFEST_URL = `${VFX_URL}/manifests/vfx.runtime.json`;
export const vfxKey = (k: string) => `vfx:${k}`;

export interface VfxTexture {
  path: string;
  kind: "image" | "sheet";
  frameWidth?: number;
  frameHeight?: number;
  frames?: number;
  fps?: number;
  width: number;
  height: number;
  blend: "add" | "normal";
  sha256: string;
}
export interface VfxManifest {
  schema: 1;
  version: string;
  textures: Record<string, VfxTexture>;
}

/** Board pixels per arena unit (BattleCanvas S). */
export const VFX_S = 5;
/** Drawn radius, in texture px, of the circular textures (tools/vfx/build_vfx.cjs). */
export const TEX_RADIUS = { ring: 54, "snare-sigil": 116, shield: 58, summon: 70, "ground-ring": 70 } as const;

export const VFX_COLORS = {
  chaos: 0xb04dff,
  chaosCore: 0xf6dcff,
  rally: 0xffc84a,
  rallyCore: 0xfff1c2,
  comet: 0xff9a3c,
  cometCore: 0xffe2a8,
  snare: 0xc06bff,
  snareCyan: 0x5ff0ff,
  rift: 0x4fe3ff,
  mortar: 0xc06bff,
  mortarCore: 0xf2c2ff,
  spark: 0xfff4d6,
  heal: 0x7dffa8,
  frenzy: 0xff4a5a,
  shadow: 0x9d8cff,
  overwatch: 0xe066ff,
  aegis: 0xffcf4a,
  bedrock: 0xe0a948,
  warden: 0x6fb6ff,
  pathfinder: 0x5fffd0,
  spark2: 0xffd84a,
  hex: 0xc77dff,
  gale: 0xb5f27a,
} as const;

export type VfxLayer = "ground" | "top";

export interface VfxSprite {
  tex: string;
  /** Fixed sheet frame, or the first frame when `animate` is set. */
  frame?: number;
  /** Play the sheet's frames once across the sprite's life. */
  animate?: boolean;
  /** Arena units. */
  x: number;
  y: number;
  /** Travel end in arena units. */
  to?: { x: number; y: number };
  /** Screen px above the ground point, at the start and end of life. */
  lift?: number;
  lift1?: number;
  /** Extra screen px of height at mid travel (lobbed or rising). */
  arc?: number;
  /** Screen px offset applied after projection (anchors, orbit). */
  dx?: number;
  dy?: number;
  delay?: number;
  /** ms */
  life: number;
  scale: number;
  scale1?: number;
  /** Extra vertical scale factor. */
  sy?: number;
  alpha?: number;
  alpha1?: number;
  /** Fade in over this fraction of life, then hold until fadeAt, then fade. */
  fadeIn?: number;
  fadeAt?: number;
  rot?: number;
  /** Radians per second. */
  spin?: number;
  /** Rotate to the screen-space travel direction. */
  aim?: boolean;
  tint?: number;
  blend?: "add" | "normal";
  origin?: [number, number];
  layer: VfxLayer;
  ease?: "linear" | "out" | "in";
}

/** Deterministic per-event random stream, so a replayed frame looks the same. */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A boundary ring drawn at exactly `radius` arena units. */
export const ringAt = (x: number, y: number, radius: number, tint: number, life: number, extra: Partial<VfxSprite> = {}): VfxSprite => ({
  tex: "ring",
  x,
  y,
  life,
  scale: (radius * VFX_S) / TEX_RADIUS.ring,
  alpha: 0.95,
  alpha1: 0,
  tint,
  blend: "add",
  layer: "ground",
  ...extra,
});

const sparks = (rnd: () => number, x: number, y: number, n: number, spread: number, tint: number, life: number, lift = 6, size = 0.42): VfxSprite[] =>
  Array.from({ length: n }, () => {
    const a = rnd() * Math.PI * 2;
    const d = spread * (0.45 + rnd() * 0.55);
    return {
      tex: "spark",
      x,
      y,
      to: { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d },
      lift,
      lift1: lift + 6 + rnd() * 10,
      life: life * (0.7 + rnd() * 0.5),
      scale: size,
      scale1: size * 0.3,
      alpha: 1,
      alpha1: 0,
      rot: rnd() * Math.PI,
      spin: (rnd() - 0.5) * 8,
      tint,
      blend: "add",
      layer: "top",
      ease: "out",
    } satisfies VfxSprite;
  });

const debris = (rnd: () => number, x: number, y: number, n: number, spread: number, life: number): VfxSprite[] =>
  Array.from({ length: n }, () => {
    const a = rnd() * Math.PI * 2;
    const d = spread * (0.4 + rnd() * 0.6);
    return {
      tex: "debris",
      frame: Math.floor(rnd() * 4),
      x,
      y,
      to: { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d },
      lift: 4,
      lift1: 0,
      arc: 18 + rnd() * 16,
      life: life * (0.8 + rnd() * 0.4),
      scale: 0.55 + rnd() * 0.35,
      alpha: 1,
      alpha1: 0.2,
      rot: rnd() * Math.PI,
      spin: (rnd() - 0.5) * 12,
      blend: "normal",
      layer: "top",
      ease: "out",
    } satisfies VfxSprite;
  });

const smoke = (rnd: () => number, x: number, y: number, n: number, spread: number, size: number, life: number, lift = 4): VfxSprite[] =>
  Array.from({ length: n }, (_, i) => {
    const a = rnd() * Math.PI * 2;
    const d = spread * rnd();
    return {
      tex: "smoke",
      animate: true,
      x: x + Math.cos(a) * d * 0.4,
      y: y + Math.sin(a) * d * 0.4,
      to: { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d },
      lift,
      lift1: lift + 10,
      delay: i * 40,
      life,
      scale: size * (0.8 + rnd() * 0.4),
      scale1: size * 1.35,
      alpha: 0.9,
      alpha1: 0.9,
      blend: "normal",
      layer: "top",
      ease: "out",
    } satisfies VfxSprite;
  });

export const burstAt = (x: number, y: number, tint: number, size: number, life: number, lift = 0): VfxSprite => ({
  tex: "burst",
  animate: true,
  x,
  y,
  lift,
  life,
  scale: size,
  scale1: size * 1.15,
  alpha: 1,
  alpha1: 1,
  tint,
  blend: "add",
  layer: "top",
});

const glowAt = (x: number, y: number, tint: number, size: number, life: number, lift = 0, layer: VfxLayer = "top"): VfxSprite => ({
  tex: "glow",
  x,
  y,
  lift,
  life,
  scale: size,
  scale1: size * 1.3,
  alpha: 0.95,
  alpha1: 0,
  tint,
  blend: "add",
  layer,
});

export interface SpellCtx {
  /** Catalog radius for a card id (arena units). */
  radius: (cardId: string) => number | undefined;
  reduced: boolean;
}

/**
 * Cast-time effects for the four spells. Chaos Bolt is instant (radius 8),
 * Rally Horn is instant with a 12-unit radius, Rift Snare lands on the same
 * tick (radius 7). Chaos Comet's travel is drawn from its pending impact and
 * only the ground warning starts here.
 */
export function spellCastVfx(e: FrameEvent, ctx: SpellCtx): VfxSprite[] {
  const id = String(e.cardId);
  const x = Number(e.x);
  const y = Number(e.y);
  const r = ctx.radius(id) ?? 6;
  const rnd = seeded(`${e.tick}:${id}:${x}:${y}`);
  const k = ctx.reduced ? 0.5 : 1;
  if (id === "chaos_bolt") {
    const v = Math.floor(rnd() * 3);
    return [
      { tex: "bolt", frame: v, x, y, life: 300 * k, scale: 0.56, alpha: 1, alpha1: 0, fadeAt: 0.45, origin: [0.5, 0.94], blend: "add", layer: "top" },
      { tex: "bolt", frame: (v + 1) % 3, x: x + 0.6, y, delay: 70, life: 200 * k, scale: 0.48, alpha: 0.85, alpha1: 0, origin: [0.5, 0.94], blend: "add", layer: "top" },
      glowAt(x, y, VFX_COLORS.chaosCore, 1.1, 260 * k, 2, "ground"),
      ringAt(x, y, r, VFX_COLORS.chaos, 420 * k),
      ringAt(x, y, r, VFX_COLORS.chaosCore, 260 * k, { scale: (r * VFX_S * 0.3) / TEX_RADIUS.ring, scale1: (r * VFX_S) / TEX_RADIUS.ring, alpha: 0.8 }),
      burstAt(x, y, VFX_COLORS.chaos, 0.7, 260 * k, 4),
      ...(ctx.reduced ? [] : sparks(rnd, x, y, 7, r * 0.8, VFX_COLORS.chaosCore, 380)),
    ];
  }
  if (id === "rally_horn") {
    const rings = [0, 200, 400].map((delay) =>
      ringAt(x, y, r, VFX_COLORS.rally, 720 * k, { delay: ctx.reduced ? 0 : delay, scale: (r * VFX_S * 0.12) / TEX_RADIUS.ring, scale1: (r * VFX_S) / TEX_RADIUS.ring, alpha: 0.95, alpha1: 0, ease: "out" })
    );
    return [
      { tex: "horn", x, y, lift: 30, lift1: 46, life: 1000 * k, scale: 0.36, scale1: 0.42, alpha: 1, alpha1: 0, fadeIn: 0.12, fadeAt: 0.7, rot: -0.15, blend: "normal", layer: "top", ease: "out" },
      glowAt(x, y, VFX_COLORS.rally, 1.0, 600 * k, 38),
      ...(ctx.reduced ? rings.slice(0, 1) : rings),
      ringAt(x, y, r, VFX_COLORS.rallyCore, 900 * k, { alpha: 0.55, alpha1: 0, fadeAt: 0.4 }),
      ...(ctx.reduced ? [] : sparks(rnd, x, y, 6, r * 0.7, VFX_COLORS.rally, 700, 10).map((s) => ({ ...s, tex: "star", scale: 0.38, scale1: 0.2 }))),
    ];
  }
  if (id === "rift_snare") {
    const s = (r * VFX_S) / TEX_RADIUS["snare-sigil"];
    return [
      { tex: "snare-sigil", x, y, life: 1200 * k, scale: s * 0.9, scale1: s, alpha: 1, alpha1: 0, fadeIn: 0.08, fadeAt: 0.62, rot: 0, spin: 0.3, blend: "normal", layer: "ground", ease: "out" },
      ringAt(x, y, r, VFX_COLORS.snareCyan, 500 * k, { alpha: 1, alpha1: 0 }),
      glowAt(x, y, VFX_COLORS.snare, 1.4, 320 * k, 0, "ground"),
      ...(ctx.reduced ? [] : sparks(rnd, x, y, 8, r, VFX_COLORS.snareCyan, 420, 3)),
    ];
  }
  if (id === "chaos_comet") {
    return [ringAt(x, y, r, VFX_COLORS.comet, 240 * k, { alpha: 0.7, alpha1: 0 })];
  }
  return [];
}

/** Landing effects for Chaos Comet (radius 6) and Rift Mortar shells (radius 4). */
export function spellImpactVfx(e: FrameEvent, ctx: SpellCtx): VfxSprite[] {
  const id = String(e.cardId);
  const x = Number(e.x);
  const y = Number(e.y);
  const rnd = seeded(`${e.tick}:${id}:${String(e.impactId)}`);
  const k = ctx.reduced ? 0.5 : 1;
  if (id === "chaos_comet") {
    const r = ctx.radius(id) ?? 6;
    return [
      glowAt(x, y, VFX_COLORS.cometCore, 1.8, 300 * k, 2, "ground"),
      burstAt(x, y, VFX_COLORS.comet, 1.0, 320 * k, 6),
      burstAt(x, y, VFX_COLORS.chaos, 0.75, 260 * k, 4),
      ringAt(x, y, r, VFX_COLORS.comet, 480 * k, { scale: (r * VFX_S * 0.35) / TEX_RADIUS.ring, scale1: (r * VFX_S * 1.05) / TEX_RADIUS.ring, ease: "out" }),
      ...(ctx.reduced ? [] : [...smoke(rnd, x, y, 3, r * 0.6, 0.85, 620), ...debris(rnd, x, y, 6, r * 0.9, 520), ...sparks(rnd, x, y, 6, r, VFX_COLORS.comet, 420)]),
    ];
  }
  if (id === "rift_mortar") {
    const r = 4;
    return [
      glowAt(x, y, VFX_COLORS.mortarCore, 1.3, 260 * k, 2, "ground"),
      burstAt(x, y, VFX_COLORS.mortar, 0.8, 300 * k, 5),
      ringAt(x, y, r, VFX_COLORS.mortar, 420 * k, { scale: (r * VFX_S * 0.3) / TEX_RADIUS.ring, scale1: (r * VFX_S) / TEX_RADIUS.ring, ease: "out" }),
      ...(ctx.reduced ? [] : [...smoke(rnd, x, y, 2, r * 0.6, 0.7, 560), ...debris(rnd, x, y, 4, r, 480)]),
    ];
  }
  return [];
}

// ---------------------------------------------------------------- statuses

export type StatusKind =
  | "rally"
  | "snare"
  | "aegis"
  | "bedrock"
  | "frenzy"
  | "overwatch"
  | "shadow"
  | "pathfinder"
  | "null-slow"
  | "null-shield";

export interface VfxStatus {
  key: string;
  entityId: string;
  kind: StatusKind;
  /** Last tick the effect is active (exclusive end, like the engine's `until`). */
  until: number;
}

export interface StatusUnit {
  id: string;
  owner: number;
  x: number;
  y: number;
  kind: "troop" | "commander";
  cardId: string;
}

const within = (u: StatusUnit, x: number, y: number, r: number) => (u.x - x) ** 2 + (u.y - y) ** 2 <= r * r;

/** Rally Horn buff (+40% for 120 ticks) and Rift Snare slow (40% for 50 ticks), from SPELL_CARDS_V1. */
export const SPELL_STATUS = { rally_horn: { radius: 12, ticks: 120 }, rift_snare: { radius: 7, ticks: 50 } } as const;
/** Runtime ability radii and durations, mirroring ABILITY_RUNTIME_V1 and CLASS_ROSTER. */
export const ABILITY_STATUS = { pathfinderRadius: 10, pathfinderTicks: 50, nullFieldRadius: 8, nullFieldTicks: 40 } as const;

/** The commander entity that fired an ability: one commander per seat, matched by card id. */
export const commanderEntityFor = (e: FrameEvent, units: StatusUnit[]): StatusUnit | null =>
  units.find((u) => u.kind === "commander" && u.owner === Number(e.player) && u.cardId === `cmdr:${String(e.commanderId)}`) ??
  units.find((u) => u.kind === "commander" && u.owner === Number(e.player)) ??
  null;

/**
 * Persistent status markers that mirror the rule each event applied: Rally
 * Horn buffs friendly troops in its radius, Rift Snare slows enemy troops and
 * commanders (ground and air) in its radius, and commander abilities mark
 * their own targets for their authored duration. Positions are this frame's
 * authoritative positions. Markers are presentation only.
 */
export function statusesFromEvent(e: FrameEvent, units: StatusUnit[]): VfxStatus[] {
  const tick = Number(e.tick);
  const out: VfxStatus[] = [];
  const add = (u: StatusUnit, kind: StatusKind, until: number) => out.push({ key: `${kind}:${u.id}`, entityId: u.id, kind, until });
  if (e.type === "spell_cast" && e.cardId === "rally_horn") {
    for (const u of units) if (u.kind === "troop" && u.owner === Number(e.player) && within(u, Number(e.x), Number(e.y), SPELL_STATUS.rally_horn.radius)) add(u, "rally", tick + SPELL_STATUS.rally_horn.ticks);
  } else if (e.type === "spell_impact" && e.cardId === "rift_snare") {
    for (const u of units) if (u.owner !== Number(e.player) && within(u, Number(e.x), Number(e.y), SPELL_STATUS.rift_snare.radius)) add(u, "snare", tick + SPELL_STATUS.rift_snare.ticks);
  } else if (e.type === "ability_fired") {
    const self = commanderEntityFor(e, units);
    const until = e.activeUntil === null || e.activeUntil === undefined ? tick : Number(e.activeUntil);
    const id = String(e.abilityId);
    if (!self) return out;
    if (id === "bulwark-aegis-wall") add(self, "aegis", until);
    else if (id === "bulwark-bedrock") add(self, "bedrock", until);
    else if (id === "reaver-frenzy-rush") add(self, "frenzy", until);
    else if (id === "deadeye-overwatch") add(self, "overwatch", until);
    else if (id === "scout-shadow-step") add(self, "shadow", until);
    else if (id === "scout-pathfinder") {
      for (const u of units) if (u.owner === self.owner && within(u, self.x, self.y, ABILITY_STATUS.pathfinderRadius)) add(u, "pathfinder", tick + ABILITY_STATUS.pathfinderTicks);
    } else if (id === "warden-null-field") {
      add(self, "null-shield", until);
      for (const u of units) if (u.owner !== self.owner && within(u, self.x, self.y, ABILITY_STATUS.nullFieldRadius)) add(u, "null-slow", tick + ABILITY_STATUS.nullFieldTicks);
    }
  }
  return out;
}

/**
 * One-shot effects for a commander ability at its authoritative position and
 * radius. Piercing Volley fires a violet arrow at every enemy inside its
 * 14-unit radius, Bloodlust bursts at the death point, Mend sparkles green.
 */
export function abilityVfx(e: FrameEvent, units: StatusUnit[], reduced: boolean): VfxSprite[] {
  const id = String(e.abilityId);
  const x = Number(e.x);
  const y = Number(e.y);
  const radius = e.radius === null || e.radius === undefined ? null : Number(e.radius);
  const rnd = seeded(`${e.tick}:${id}:${String(e.commanderId)}`);
  const k = reduced ? 0.5 : 1;
  const owner = Number(e.player);
  switch (id) {
    case "bulwark-aegis-wall":
      return [burstAt(x, y, VFX_COLORS.aegis, 0.7, 260 * k, 22), glowAt(x, y, VFX_COLORS.aegis, 1.1, 320 * k, 20)];
    case "bulwark-bedrock":
      return [ringAt(x, y, 3, VFX_COLORS.bedrock, 520 * k, { scale: 0.05, ease: "out" }), ...(reduced ? [] : debris(rnd, x, y, 5, 3, 420))];
    case "reaver-frenzy-rush":
      return [burstAt(x, y, VFX_COLORS.frenzy, 0.75, 280 * k, 20), glowAt(x, y, VFX_COLORS.frenzy, 1.2, 360 * k, 16), ...(reduced ? [] : sparks(rnd, x, y, 6, 3, VFX_COLORS.frenzy, 380, 18))];
    case "reaver-bloodlust":
      return [
        burstAt(x, y, VFX_COLORS.frenzy, 1.0, 320 * k, 6),
        ringAt(x, y, radius ?? 6, VFX_COLORS.frenzy, 480 * k, { scale: 0.1, scale1: ((radius ?? 6) * VFX_S) / TEX_RADIUS.ring, ease: "out" }),
        ...(reduced ? [] : smoke(rnd, x, y, 2, 2, 0.7, 520)),
      ];
    case "deadeye-piercing-volley": {
      const r = radius ?? 14;
      const targets = units.filter((u) => u.owner !== owner && within(u, x, y, r));
      return [
        ringAt(x, y, r, VFX_COLORS.overwatch, 420 * k, { alpha: 0.6 }),
        ...targets.slice(0, 12).flatMap((t, i) => [
          { tex: "arrow", x, y, to: { x: t.x, y: t.y }, lift: 22, lift1: 12, arc: 10, delay: reduced ? 0 : i * 25, life: 220, scale: 0.6, alpha: 1, alpha1: 1, aim: true, blend: "normal", layer: "top" } satisfies VfxSprite,
          burstAt(t.x, t.y, VFX_COLORS.overwatch, 0.4, 200, 12),
        ]),
      ];
    }
    case "deadeye-overwatch":
      return [glowAt(x, y, VFX_COLORS.overwatch, 1.0, 380 * k, 24), ringAt(x, y, 2.5, VFX_COLORS.overwatch, 420 * k, { scale: 0.05, ease: "out" })];
    case "scout-shadow-step":
      return [...smoke(rnd, x, y, reduced ? 1 : 3, 1.5, 0.6, 420).map((s) => ({ ...s, tint: VFX_COLORS.shadow })), burstAt(x, y, VFX_COLORS.shadow, 0.6, 240 * k, 14)];
    case "scout-pathfinder":
      return [ringAt(x, y, radius ?? 10, VFX_COLORS.pathfinder, 520 * k, { scale: 0.1, scale1: ((radius ?? 10) * VFX_S) / TEX_RADIUS.ring, ease: "out" })];
    case "warden-null-field": {
      const r = radius ?? 8;
      return [
        ringAt(x, y, r, VFX_COLORS.warden, 700 * k, { scale: 0.1, scale1: (r * VFX_S) / TEX_RADIUS.ring, ease: "out" }),
        ringAt(x, y, r, VFX_COLORS.warden, 1000 * k, { alpha: 0.45, alpha1: 0, fadeAt: 0.5 }),
        ...(reduced ? [] : sparks(rnd, x, y, 8, r, VFX_COLORS.warden, 600, 6).map((s) => ({ ...s, tex: "star", scale: 0.34, scale1: 0.15 }))),
      ];
    }
    case "warden-mend":
      return [glowAt(x, y, VFX_COLORS.heal, 1.0, 420 * k, 16), ...(reduced ? [] : sparks(rnd, x, y, 6, 1.5, VFX_COLORS.heal, 600, 8).map((s) => ({ ...s, lift1: (s.lift1 ?? 0) + 18 })))];
    default:
      return [];
  }
}

/** Visual style for a projectile, inferred from the nearest same-owner ranged
 * shooter when the projectile first appears. The frame carries no source id. */
export type ProjectileStyle = "spark" | "hex" | "net" | "plain";
export const PROJECTILE_STYLE: Record<string, ProjectileStyle> = { sparkcaster: "spark", hexwing: "hex", gale_netter: "net" };

export function projectileStyleFor(p: { owner: number; x: number; y: number }, shooters: Array<{ owner: number; x: number; y: number; cardId: string }>): ProjectileStyle {
  let best: { d: number; style: ProjectileStyle } | null = null;
  for (const s of shooters) {
    const style = PROJECTILE_STYLE[s.cardId];
    if (!style || s.owner !== p.owner) continue;
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
    if (d <= 9 && (!best || d < best.d)) best = { d, style };
  }
  return best?.style ?? "plain";
}

export interface VfxPoolLimits {
  /** Hard cap on live one-shot sprites; new spawns are dropped beyond it. */
  maxSprites: number;
}
export const VFX_LIMITS: VfxPoolLimits = { maxSprites: 180 };

/** Accepts as many specs as fit under the cap, never evicting live ones. */
export const admitSprites = (live: number, specs: VfxSprite[], limits = VFX_LIMITS): VfxSprite[] => specs.slice(0, Math.max(0, limits.maxSprites - live));

/** Eased 0..1 progress for a sprite at `t` (0..1). */
export const easeFor = (ease: VfxSprite["ease"], t: number) => (ease === "out" ? 1 - (1 - t) ** 2 : ease === "in" ? t * t : t);

/** Alpha at progress t honouring fadeIn and fadeAt. */
export function spriteAlpha(s: VfxSprite, t: number): number {
  const a0 = s.alpha ?? 1;
  const a1 = s.alpha1 ?? a0;
  if (s.fadeIn && t < s.fadeIn) return a0 * (t / s.fadeIn);
  if (s.fadeAt !== undefined) return t < s.fadeAt ? a0 : a0 + (a1 - a0) * ((t - s.fadeAt) / Math.max(1e-6, 1 - s.fadeAt));
  return a0 + (a1 - a0) * t;
}
