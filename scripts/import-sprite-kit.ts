// B2.8d one-shot importer for the approved static v001 sprite kit. Reads the
// canonical manifest in the (read-only) asset folder, verifies every selected
// record (unique id, file present, sha256, PNG IHDR size, alpha color type),
// copies the PNGs into public/assets/chog-kit/v001 preserving the package
// layout, and writes a deterministic runtime manifest for the battle client.
//
// Scope: 28 primary battle entries + 6 effect primitives + 25 card art
// derivatives (HUD portraits) = 59 PNGs. Exact NFT portraits are never
// imported: generic templates must never be presented as NFT likenesses.
//
// Run: npx tsx scripts/import-sprite-kit.ts
// Re-runnable: overwrites the same public/ tree, fails loudly on mismatch.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const KIT_ROOT = "C:/Users/USER/Documents/ChogRoyale-Assets/gameplay-sprite-kit/v001";
const MANIFEST_PATH = join(KIT_ROOT, "manifests/phaser-assets.json");
const OUT_ROOT = join(process.cwd(), "public/assets/chog-kit/v001");

const IMPORT_CATEGORIES = new Set([
  "troop",
  "spawned_troop",
  "building",
  "commander_class_template",
  "fixed_structure",
  "spell",
  "effect_primitive",
  "card_art_derivative",
]);

interface AssetRecord {
  stableAssetId: string;
  category: string;
  path: string;
  width: number;
  height: number;
  sha256: string;
  status: string;
  [key: string]: unknown;
}

interface SourceManifest {
  kitVersion: string;
  approvalBasis: { id: string };
  assets: AssetRecord[];
  bindings: {
    entityIds: Record<string, string>;
    commanderClassIds: Record<string, string>;
    effectRequirementIds: Record<string, string[]>;
    abilityIds: Record<string, string[]>;
    [key: string]: unknown;
  };
}

const fail = (msg: string): never => {
  throw new Error(`import-sprite-kit: ${msg}`);
};

const source = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SourceManifest;
const sourceSha = createHash("sha256").update(readFileSync(MANIFEST_PATH)).digest("hex");

const selected = source.assets.filter((a) => IMPORT_CATEGORIES.has(a.category));
const seen = new Set<string>();
for (const a of selected) {
  if (seen.has(a.stableAssetId)) fail(`duplicate stableAssetId ${a.stableAssetId}`);
  seen.add(a.stableAssetId);
}
if (selected.length !== 59) fail(`expected 59 import records, found ${selected.length}`);

// Every ordinary card portrait must bind a real engine card id, and every
// commander portrait must bind a real commander class. Checked against the
// combat catalog so a stale kit fails loudly here, not in the HUD.
import { BUILDING_CARDS_V1, CARDS_V1 } from "../src/lib/combat";
import { COMMANDER_CLASSES } from "../src/lib/commanders";
const engineCardIds = new Set([...Object.keys(CARDS_V1), ...Object.keys(BUILDING_CARDS_V1)]);
const engineClasses = new Set<string>(COMMANDER_CLASSES);
for (const a of selected.filter((x) => x.category === "card_art_derivative")) {
  if (a.commanderClassId) {
    if (!engineClasses.has(String(a.commanderClassId))) fail(`portrait ${a.stableAssetId} binds unknown class ${a.commanderClassId}`);
    continue;
  }
  for (const cid of (a.cardIds as string[] | undefined) ?? []) {
    if (!engineCardIds.has(cid)) fail(`portrait ${a.stableAssetId} binds unknown card ${cid}`);
  }
}

const pngIhdr = (buf: Buffer) => {
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) fail("not a PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25); // 4 = grayscale+alpha, 6 = RGBA
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 };
};

const importedIds = new Set(selected.map((a) => a.stableAssetId));
for (const a of selected) {
  const abs = join(KIT_ROOT, a.path);
  if (!existsSync(abs)) fail(`missing file ${abs} (${a.stableAssetId})`);
  const buf = readFileSync(abs);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== a.sha256) fail(`sha256 mismatch ${a.stableAssetId}: file ${sha} != record ${a.sha256}`);
  const ihdr = pngIhdr(buf);
  if (ihdr.width !== a.width || ihdr.height !== a.height) {
    fail(`IHDR mismatch ${a.stableAssetId}: ${ihdr.width}x${ihdr.height} != ${a.width}x${a.height}`);
  }
  if (!ihdr.hasAlpha) fail(`no alpha channel ${a.stableAssetId}`);
  const dest = join(OUT_ROOT, a.path);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
}

const filterMap = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => importedIds.has(v)));
const filterListMap = (m: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, v.filter((id) => importedIds.has(id))] as const).filter(([, v]) => v.length > 0)
  );

const runtime = {
  kitVersion: source.kitVersion,
  sourceManifestSha256: sourceSha,
  approvalBasis: source.approvalBasis.id,
  assets: selected,
  bindings: {
    entityIds: filterMap(source.bindings.entityIds),
    commanderClassIds: filterMap(source.bindings.commanderClassIds),
    effectRequirementIds: filterListMap(source.bindings.effectRequirementIds),
    abilityIds: filterListMap(source.bindings.abilityIds),
    cardIds: Object.fromEntries(
      Object.entries(source.bindings.cardIds ?? {}).filter(([, v]) => importedIds.has((v as { cardArtAssetId: string }).cardArtAssetId))
    ),
  },
};
const outManifest = join(OUT_ROOT, "manifests/phaser-assets.runtime.json");
mkdirSync(dirname(outManifest), { recursive: true });
writeFileSync(outManifest, JSON.stringify(runtime, null, 2) + "\n");

// Coverage report: engine ids with no asset, imported assets with no engine id.
const bound = new Set(Object.keys(source.bindings.entityIds));
const assetBound = new Set(
  selected.flatMap((a) => (a.entityIds as string[] | undefined) ?? []).concat(
    selected.map((a) => (a.commanderClassId as string | null) ?? "").filter(Boolean)
  )
);
const unboundEngineIds = [...bound].filter((id) => !importedIds.has(source.bindings.entityIds[id]!));
const unboundAssets = selected.filter(
  (a) =>
    ((a.entityIds as string[] | undefined) ?? []).length === 0 &&
    !a.commanderClassId &&
    !a.stableAssetId.startsWith("effect:")
);
console.log(`imported ${selected.length} assets -> ${OUT_ROOT}`);
console.log(`runtime manifest: ${outManifest}`);
console.log(`engine ids without asset: ${JSON.stringify(unboundEngineIds)}`);
console.log(`asset ids without engine binding: ${JSON.stringify(unboundAssets.map((a) => a.stableAssetId))}`);
console.log(`entity bindings imported: ${Object.keys(runtime.bindings.entityIds).length}/${bound.size}`);
console.log(`commander class bindings: ${Object.keys(runtime.bindings.commanderClassIds).length}`);
console.log(`effect requirement bindings kept: ${Object.keys(runtime.bindings.effectRequirementIds).length}/${Object.keys(source.bindings.effectRequirementIds).length}`);
console.log(`ability bindings kept: ${Object.keys(runtime.bindings.abilityIds).length}/${Object.keys(source.bindings.abilityIds).length}`);
console.log(`asset-bound engine ids (sanity): ${assetBound.size}`);
// Portrait coverage both directions: engine cards/classes with no portrait
// (spawned units and NFT-token commander cards are expected here), and
// imported portrait assets bound to nothing the engine knows.
const portraits = selected.filter((a) => a.category === "card_art_derivative");
const coveredCards = new Set(portraits.flatMap((a) => (a.cardIds as string[] | undefined) ?? []));
const coveredClasses = new Set(portraits.map((a) => String(a.commanderClassId ?? "")).filter(Boolean));
console.log(`engine cards without portrait: ${JSON.stringify([...engineCardIds].filter((id) => !coveredCards.has(id)))}`);
console.log(`engine classes without portrait: ${JSON.stringify([...engineClasses].filter((c) => !coveredClasses.has(c)))}`);
console.log(`portraits imported: ${portraits.length}`);
