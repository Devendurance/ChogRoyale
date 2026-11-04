// The one list of what a battle loads. Phaser's preload and the lobby prewarm
// read the same plan, so warming the HTTP cache before a match covers exactly
// what the scene requests. No Phaser import: this runs before Phaser exists.

import { ARENA_URLS, type ArenaManifest } from "./arena-registry";
import { VFX_MANIFEST_URL, VFX_URL, vfxKey, type VfxManifest } from "./battle-vfx";
import type { SpriteManifest } from "./sprite-registry";
import { UNITS_MANIFEST_URL, UNITS_URL, unitTextureKey, type UnitAnimManifest } from "./unit-anim";

export const KIT_URL = "/assets/chog-kit/v001";
/** Viewports that load the depth-of-field world variant. */
export const WORLD_SOFT_QUERY = "(min-width: 1200px) and (orientation: landscape)";

export interface BattleManifests {
  kit: SpriteManifest | null;
  arena: { arena: ArenaManifest; base: string } | null;
  units: UnitAnimManifest | null;
  vfx: VfxManifest | null;
}

export type BattleAsset =
  | { kind: "image"; key: string; url: string }
  | { kind: "sheet"; key: string; url: string; frameWidth: number; frameHeight: number };

const readJson = async <T,>(url: string): Promise<T | null> => {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

// First arena manifest that loads wins: v003 pre-rendered 2.5D art, else v002.
const loadArena = async (): Promise<BattleManifests["arena"]> => {
  for (const base of ARENA_URLS) {
    const arena = await readJson<ArenaManifest>(`${base}/manifests/arena.runtime.json`);
    if (arena) return { arena, base };
  }
  return null;
};

let manifests: Promise<BattleManifests> | null = null;

/** Consecutive matches reuse one read. A partial failure is retried next time. */
export function loadBattleManifests(): Promise<BattleManifests> {
  const pending = (manifests ??= Promise.all([
    readJson<SpriteManifest>(`${KIT_URL}/manifests/phaser-assets.runtime.json`),
    loadArena(),
    readJson<UnitAnimManifest>(UNITS_MANIFEST_URL),
    readJson<VfxManifest>(VFX_MANIFEST_URL),
  ]).then(([kit, arena, units, vfx]) => {
    const value = { kit, arena, units, vfx };
    if (!kit || !arena || !units || !vfx) manifests = null;
    return value;
  }));
  return pending;
}

/** Texture keys and URLs in Phaser load order. `soft` picks the world variant.
 * `cardArt` can be left to the DOM: card portraits are never drawn on the
 * canvas, so the renderer skips their GPU uploads while prewarm still fetches
 * them for the HUD. */
export function battleAssetPlan(
  { kit, arena, units, vfx }: BattleManifests,
  soft: boolean,
  { cardArt = true }: { cardArt?: boolean } = {},
): BattleAsset[] {
  const plan: BattleAsset[] = [];
  for (const a of kit?.assets ?? []) {
    if (!cardArt && a.category === "card_art_derivative") continue;
    plan.push({ kind: "image", key: a.stableAssetId, url: `${KIT_URL}/${a.path}` });
  }
  for (const u of Object.values(units?.units ?? {})) {
    plan.push({ kind: "sheet", key: unitTextureKey(u.entityId), url: `${UNITS_URL}/${u.sheet}`, frameWidth: u.frameWidth, frameHeight: u.frameHeight });
  }
  for (const [key, t] of Object.entries(vfx?.textures ?? {})) {
    if (t.kind === "sheet") plan.push({ kind: "sheet", key: vfxKey(key), url: `${VFX_URL}/${t.path}`, frameWidth: t.frameWidth!, frameHeight: t.frameHeight! });
    else plan.push({ kind: "image", key: vfxKey(key), url: `${VFX_URL}/${t.path}` });
  }
  if (arena) {
    const { arena: a, base } = arena;
    // Desktop landscape shows far more surround, so it gets the variant whose
    // scenery softens with distance from the arena (static depth of field,
    // no runtime blur). The board region is identical.
    if (a.world) plan.push({ kind: "image", key: "arena:world", url: `${base}/${soft && a.world.softPath ? a.world.softPath : a.world.path}` });
    for (const l of a.layers) plan.push({ kind: "image", key: `arena:layer:${l.id}`, url: `${base}/${l.path}` });
    for (const [role, r] of Object.entries(a.mounts)) {
      for (const p of Object.values(r.parts)) if (p) plan.push({ kind: "image", key: `${role}:${p.split("/").pop()!.replace(".png", "")}`, url: `${base}/${p}` });
      for (const [pose, p] of Object.entries(r.poses)) plan.push({ kind: "image", key: `${role}:defender-${pose}`, url: `${base}/${p.path}` });
    }
  }
  return plan;
}

export const usesSoftWorld = () => typeof matchMedia === "function" && matchMedia(WORLD_SOFT_QUERY).matches;

let prewarm: Promise<void> | null = null;

/**
 * Pull the renderer chunks and every battle asset into the browser cache while
 * the player is still choosing a deck. Purely an optimisation: a failure is
 * forgotten and the scene loads for itself behind the arming screen.
 */
export function prewarmBattle(): Promise<void> {
  prewarm ??= (async () => {
    await Promise.all([import("./BattleCanvas"), import("phaser"), loadBattleManifests()]);
    const queue = battleAssetPlan(await loadBattleManifests(), usesSoftWorld());
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await fetch(next.url).then((r) => r.blob());
    }));
  })().catch(() => {
    prewarm = null;
  });
  return prewarm;
}
