// Pure lookup layer over the imported v001 runtime manifest. No Phaser import:
// BattleCanvas resolves asset ids, display scales and effect primitives here.
// Unknown engine ids return null so callers fall back to placeholder drawing.

export interface SpriteRecord {
  stableAssetId: string;
  name: string;
  category: "troop" | "spawned_troop" | "building" | "commander_class_template" | "fixed_structure" | "spell" | "effect_primitive" | "card_art_derivative";
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
    /** Engine card id -> { battleAssetId, cardArtAssetId } portrait binding. */
    cardIds: Record<string, { battleAssetId: string; cardArtAssetId: string }>;
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
  // Portraits render as full-card art, never on the board, so no board mult.
  card_art_derivative: 1,
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

const KIT_BASE = "/assets/chog-kit/v001";

const portraitUrl = (r: SpriteRecord | null): string | null =>
  r && r.category === "card_art_derivative" ? `${KIT_BASE}/${r.path}` : null;

/** Card portrait URL for an ordinary engine card id, or null. Commander card
 * ids ("cmdr:<commanderId>") only resolve for free-starter ids; NFT commanders
 * must go through portraitForCommanderClass with the server-verified class so
 * a token card never renders as generic art or another NFT's likeness. */
export function portraitForCard(manifest: SpriteManifest, cardId: string): string | null {
  const binding = manifest.bindings.cardIds[cardId];
  if (!binding) return null;
  const rec = byId(manifest, binding.cardArtAssetId);
  if (!rec || !rec.stableAssetId.startsWith("card:")) return null;
  return portraitUrl(rec);
}

/** Class-template portrait for a commander, resolved by server-verified class
 * only. Never resolves an NFT token id to portrait art. */
export function portraitForCommanderClass(manifest: SpriteManifest, cls: string): string | null {
  const rec = manifest.assets.find(
    (a) => a.category === "card_art_derivative" && a.commanderClassId === cls
  );
  return portraitUrl(rec ?? null);
}
