// Pure lookup layer over the imported v001 runtime manifest. No Phaser import:
// BattleCanvas resolves asset ids, display scales and effect primitives here.
// Unknown engine ids return null so callers fall back to placeholder drawing.

export interface SpriteRecord {
  stableAssetId: string;
  name: string;
  category: "troop" | "spawned_troop" | "building" | "commander_class_template" | "fixed_structure" | "spell" | "effect_primitive";
  path: string;
  width: number;
  height: number;
  pivotNormalized: [number, number];
  groundPositionAnchor: boolean;
  proposedDisplaySize: { uniformScale: number; visibleHeight: number };
  sha256: string;
  [key: string]: unknown;
}

export interface SpriteManifest {
  kitVersion: string;
  sourceManifestSha256: string;
  approvalBasis: string;
  assets: SpriteRecord[];
  bindings: {
    entityIds: Record<string, string>;
    commanderClassIds: Record<string, string>;
    effectRequirementIds: Record<string, string[]>;
    abilityIds: Record<string, string[]>;
  };
}

/** Board pixels per manifest display pixel: regular troop (~64 px visible)
 * lands near 30 px on the 500x800 board at S = 5. */
export const BOARD_K = 0.32;

export const CATEGORY_MULT: Record<SpriteRecord["category"], number> = {
  troop: 1,
  spawned_troop: 1,
  commander_class_template: 1.1,
  building: 1,
  fixed_structure: 1.5,
  spell: 0.6,
  effect_primitive: 1,
};

export function displayScale(record: SpriteRecord): number {
  return record.proposedDisplaySize.uniformScale * BOARD_K * (CATEGORY_MULT[record.category] ?? 1);
}

export function byId(manifest: SpriteManifest, stableAssetId: string): SpriteRecord | null {
  return manifest.assets.find((a) => a.stableAssetId === stableAssetId) ?? null;
}

/** Resolves an engine entity/card id to its battle sprite record, or null. */
export function resolveEntityAsset(
  manifest: SpriteManifest,
  kind: "troop" | "building" | "structure" | "spell",
  id: string
): SpriteRecord | null {
  const assetId = manifest.bindings.entityIds[id];
  if (!assetId) return null;
  const rec = byId(manifest, assetId);
  if (!rec) return null;
  const want = { troop: ["troop", "spawned_troop"], building: ["building"], structure: ["fixed_structure"], spell: ["spell"] }[kind];
  return want.includes(rec.category) ? rec : null;
}

/** Commanders render as their server-verified class template, never token art. */
export function resolveCommanderAsset(manifest: SpriteManifest, cls: string): SpriteRecord | null {
  const assetId = manifest.bindings.commanderClassIds[cls];
  return assetId ? byId(manifest, assetId) : null;
}

/** Effect primitives for a spell/mechanic binding (e.g. "chaos_bolt_effect"). */
export function effectForRequirement(manifest: SpriteManifest, requirementId: string): SpriteRecord[] {
  return (manifest.bindings.effectRequirementIds[requirementId] ?? [])
    .map((id) => byId(manifest, id))
    .filter((r): r is SpriteRecord => r !== null);
}

/** Effect primitives for a commander ability id (e.g. "scout-shadow-step"). */
export function effectForAbility(manifest: SpriteManifest, abilityId: string): SpriteRecord[] {
  return (manifest.bindings.abilityIds[abilityId] ?? [])
    .map((id) => byId(manifest, id))
    .filter((r): r is SpriteRecord => r !== null);
}
