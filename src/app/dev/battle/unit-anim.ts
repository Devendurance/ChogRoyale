// Pure presentation layer for pre-rendered unit animation sheets (Slice 3).
// No Phaser import. BattleCanvas asks this module which sheet frame to draw
// from authoritative frame data only: position deltas, HP drops, removal and
// distance to enemies. It never predicts damage, targeting or movement.

export type UnitClipName = "idle" | "move" | "attack" | "hit" | "defeat" | "deploy" | "ability";
/** Every sheet has idle, attack, hit and defeat. Troops and commanders add
 * move, buildings add a one-shot deploy, commanders add an ability cast. */
export type UnitClips = Record<"idle" | "attack" | "hit" | "defeat", UnitClip> & Partial<Record<"move" | "deploy" | "ability", UnitClip>>;
/** Sheet-pixel anchors (muzzle, weapon tip) per view, at idle frame 0 and at
 * the attack impact frame, for effects that start where the art shows them. */
export type UnitAnchors = Record<string, Partial<Record<UnitView, Partial<Record<"idle" | "attack", [number, number]>>>>>;
/** Authored view: front three-quarter (toward the camera) or rear three-quarter
 * (away from it, for units heading up the screen). Both face screen right and
 * the renderer mirrors on X for leftward motion. */
export type UnitView = "front" | "rear";

export interface UnitClip {
  /** First frame index in the sheet. */
  start: number;
  count: number;
  fps: number;
  loop: boolean;
  /** Frame (within the clip) where the blow lands. */
  impact?: number;
}

export interface UnitAnimRecord {
  /** Final assets: deployable building, commander class or spawned troop.
   * Absent on the twelve card troops. */
  kind?: "building" | "commander" | "spawned";
  entityId: string;
  sheet: string;
  sha256: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frameCount: number;
  pivot: [number, number];
  pivotNormalized: [number, number];
  /** Idle height from the ground pivot to the top of the art, sheet px. */
  visibleHeight: number;
  /** Board px per sheet px. */
  displayScale: number;
  facing: "right";
  /** Front three-quarter clips. */
  clips: UnitClips;
  /** Rear three-quarter clips with the same counts and timing as `clips`, so
   * a view change mid-clip keeps its frame index. Absent on one-view sheets. */
  rearClips?: UnitClips;
  /** attackIntervalTicks x 100 ms, from the ruleset. */
  attackPeriodMs: number;
  /** Ruleset attack range in arena units. */
  reach: number;
  /** Ruleset hitsAir: flying foes count for engagement. Absent on older sheets. */
  hitsAir?: boolean;
  /** Ruleset moveType "air" (the renderer already lifts air units). */
  air?: boolean;
  defeatMs: number;
  /** 3D card renders from Slice 3-4, kept on disk, never shown as card art. */
  portrait?: string;
  portraitSha256?: string;
  anchors?: UnitAnchors;
}

export interface UnitAnimManifest {
  schema: 1;
  version: string;
  units: Record<string, UnitAnimRecord>;
}

export const UNITS_URL = "/assets/chog-units/v001";
export const UNITS_MANIFEST_URL = `${UNITS_URL}/manifests/units.runtime.json`;

export const unitTextureKey = (entityId: string) => `unit:${entityId}`;

export const unitAnimFor = (manifest: UnitAnimManifest | null, cardId: string): UnitAnimRecord | null =>
  manifest?.units[cardId] ?? null;

export const clipDurationMs = (clip: UnitClip) => (clip.count * 1000) / clip.fps;

/** Absolute sheet frame for a clip after `elapsedMs`. Loops wrap, one-shots hold. */
export const clipFrame = (clip: UnitClip, elapsedMs: number): number => {
  const i = Math.floor((Math.max(0, elapsedMs) * clip.fps) / 1000);
  return clip.start + (clip.loop ? i % clip.count : Math.min(i, clip.count - 1));
};

export interface UnitAnimState {
  /** When the current engagement began. The swing cycle is anchored here. */
  engagedSince: number | null;
  /** Last observed authoritative HP drop. */
  hitAt: number;
  /** Removal or death time. */
  goneAt: number | null;
  /** Per-entity loop offset so a swarm never moves in lockstep. */
  offsetMs: number;
  /** Authoritative spawn seen this session (building_spawned): plays deploy. */
  deployAt: number;
  /** Authoritative fire event (siege_fired, unit_spawned for the Burrow): plays attack once. */
  firedAt: number;
  /** Authoritative active ability (ability_fired, trigger active): plays the cast. */
  castAt: number;
}

export const newUnitAnimState = (offsetMs = 0): UnitAnimState => ({
  engagedSince: null,
  hitAt: -Infinity,
  goneAt: null,
  offsetMs,
  deployAt: -Infinity,
  firedAt: -Infinity,
  castAt: -Infinity,
});

/** Tracks engagement edges. Returns a new state, never mutates. */
export const updateEngagement = (st: UnitAnimState, engaged: boolean, now: number): UnitAnimState =>
  engaged ? (st.engagedSince === null ? { ...st, engagedSince: now } : st) : st.engagedSince === null ? st : { ...st, engagedSince: null };

/** Clip table for a view. Sheets without rear clips always draw the front. */
export const clipsFor = (rec: UnitAnimRecord, view: UnitView): UnitClips =>
  view === "rear" && rec.rearClips ? rec.rearClips : rec.clips;

/**
 * Visual facing from a screen-space direction (x right, y down), for the
 * unit's own motion or toward the foe it's engaging. Mostly-up reads as the
 * rear view, mostly-down as the front. Near-horizontal or zero directions
 * keep the previous view so a unit doesn't flicker while strafing or idle.
 * Presentation only: it never feeds movement, targeting or position.
 */
export function nextView(prev: UnitView, screenDx: number, screenDy: number, bias = 0.3): UnitView {
  const len = Math.hypot(screenDx, screenDy);
  if (len < 1e-6) return prev;
  if (screenDy < -bias * len) return "rear";
  if (screenDy > bias * len) return "front";
  return prev;
}

/**
 * Picks the clip and sheet frame. Priority: defeat, a building's deploy, a
 * commander's ability cast, an event-fired attack, a swing in progress, a hit
 * reaction, movement, then idle. Between swings an engaged unit idles so the
 * next blow reads as a fresh windup. The view only swaps the clip table, so
 * timing and frame index stay continuous across a turn. Every timestamp comes
 * from authoritative events or observed state, never a prediction.
 */
export function unitFrame(
  rec: UnitAnimRecord,
  st: UnitAnimState,
  input: { now: number; moving: boolean; view?: UnitView }
): { clip: UnitClipName; frame: number } {
  const { now, moving } = input;
  const c = clipsFor(rec, input.view ?? "front");
  if (st.goneAt !== null) return { clip: "defeat", frame: clipFrame(c.defeat, now - st.goneAt) };
  if (c.deploy && now - st.deployAt < clipDurationMs(c.deploy)) return { clip: "deploy", frame: clipFrame(c.deploy, now - st.deployAt) };
  if (c.ability && now - st.castAt < clipDurationMs(c.ability)) return { clip: "ability", frame: clipFrame(c.ability, now - st.castAt) };
  if (now - st.firedAt < clipDurationMs(c.attack)) return { clip: "attack", frame: clipFrame(c.attack, now - st.firedAt) };
  if (st.engagedSince !== null) {
    const phase = (now - st.engagedSince) % rec.attackPeriodMs;
    if (phase < clipDurationMs(c.attack)) return { clip: "attack", frame: clipFrame(c.attack, phase) };
  }
  if (now - st.hitAt < clipDurationMs(c.hit)) return { clip: "hit", frame: clipFrame(c.hit, now - st.hitAt) };
  if (moving && st.engagedSince === null && c.move) return { clip: "move", frame: clipFrame(c.move, now + st.offsetMs) };
  return { clip: "idle", frame: clipFrame(c.idle, now + st.offsetMs) };
}

/**
 * Sheet anchor for an effect (muzzle flash, weapon tip) as a board-pixel
 * offset from the unit's ground point, honouring the drawn scale and mirror.
 * Falls back to the idle anchor, then null when the sheet has none.
 */
export function anchorOffset(
  rec: UnitAnimRecord,
  name: string,
  view: UnitView,
  clip: "idle" | "attack",
  flipX: boolean
): { x: number; y: number } | null {
  const a = rec.anchors?.[name];
  const byView = a?.[view] ?? a?.front;
  const p = byView?.[clip] ?? byView?.idle;
  if (!p) return null;
  const dx = (p[0] - rec.pivot[0]) * rec.displayScale;
  return { x: flipX ? -dx : dx, y: (p[1] - rec.pivot[1]) * rec.displayScale };
}

/** Defeat fade: opaque for most of the clip, then out over the last 35%. */
export const defeatAlpha = (rec: UnitAnimRecord, elapsedMs: number): number => {
  const p = elapsedMs / rec.defeatMs;
  return p <= 0.65 ? 1 : Math.max(0, 1 - (p - 0.65) / 0.35);
};

export interface Foe {
  x: number;
  y: number;
  /** Footprint half-size; 0 for units (center distance), like combat reach2. */
  r: number;
  air?: boolean;
}

/** Same metric as combat `reach2`: center distance for units, gap to the
 * footprint ring (r + 1) for structures and buildings. */
export const reachSq = (ux: number, uy: number, t: Foe): number => {
  if (t.r <= 0) return (ux - t.x) ** 2 + (uy - t.y) ** 2;
  const dx = Math.max(0, Math.abs(ux - t.x) - (t.r + 1));
  const dy = Math.max(0, Math.abs(uy - t.y) - (t.r + 1));
  return dx * dx + dy * dy;
};

/**
 * Presentation-only engagement: a stationary unit with a foe in reach (plus a
 * little slack for tick quantisation). The public frame has no melee or shot
 * event for every troop, so this mirrors the ruleset's own range test. Air
 * foes count only for units whose ruleset `hitsAir` is true.
 * Returns the nearest foe in reach, or null.
 */
export function engagedFoe(u: { x: number; y: number }, reach: number, foes: Foe[], slack = 0.75, hitsAir = false): Foe | null {
  const lim = (reach + slack) ** 2;
  let best: Foe | null = null;
  let bestD = Infinity;
  for (const f of foes) {
    if (f.air && !hitsAir) continue;
    const d = reachSq(u.x, u.y, f);
    if (d <= lim && d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}
