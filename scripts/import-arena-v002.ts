// B2.8f one-shot importer for the Chaos Crossing v002 arena world. Reads the
// canonical layer/mount/display-proposal manifests in the (read-only) asset
// folder, verifies every half-size gameplay export (file present, sha256,
// PNG IHDR size, RGBA color type), copies the 34 PNGs into
// public/assets/arena/chaos-crossing/v002 preserving the package layout, and
// writes a deterministic runtime manifest for the battle client.
//
// Scope: 16 arena layers + 18 mount part/pose images = 34 half-size exports.
// Masters, previews, sources and reused/ assets are never imported.
//
// Run: npx tsx scripts/import-arena-v002.ts
// Re-runnable: overwrites the same public/ tree, fails loudly on mismatch.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ARENA_ROOT = "C:/Users/USER/Documents/ChogRoyale-Assets/arena-worlds/chaos-crossing/v002";
const OUT_ROOT = join(process.cwd(), "public/assets/arena/chaos-crossing/v002");

const fail = (msg: string): never => {
  throw new Error(`import-arena-v002: ${msg}`);
};

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

// Minimal PNG checks: signature, IHDR width/height, RGBA color type 6.
const pngInfo = (buf: Buffer, rel: string): [number, number] => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 26 || !buf.subarray(0, 8).equals(sig)) fail(`${rel} is not a PNG`);
  if (buf.toString("ascii", 12, 16) !== "IHDR") fail(`${rel} missing IHDR`);
  if (buf[25] !== 6) fail(`${rel} is color type ${buf[25]}, expected RGBA (6)`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

interface DisplayAsset {
  stableAssetId: string;
  kind: string;
  sourcePath: string;
  gameplayPath: string;
  sha256: string;
  exportDimensions: [number, number];
  [key: string]: unknown;
}

const layersManifest = JSON.parse(readFileSync(join(ARENA_ROOT, "manifests/layers.json"), "utf8"));
const mountsManifest = JSON.parse(readFileSync(join(ARENA_ROOT, "manifests/mounts.json"), "utf8"));
const displayProposal = JSON.parse(readFileSync(join(ARENA_ROOT, "manifests/display-proposal.json"), "utf8")) as {
  assets: DisplayAsset[];
};

// Hash-verify and copy every declared gameplay export.
const seen = new Set<string>();
let copied = 0;
for (const a of displayProposal.assets) {
  if (seen.has(a.gameplayPath)) fail(`duplicate gameplayPath ${a.gameplayPath}`);
  seen.add(a.gameplayPath);
  if (!a.gameplayPath.startsWith("gameplay/")) fail(`unexpected path ${a.gameplayPath}`);
  const rel = a.gameplayPath.slice("gameplay/".length);
  if (rel.includes("..") || rel.startsWith("/")) fail(`unsafe path ${rel}`);
  const src = join(ARENA_ROOT, a.gameplayPath);
  if (!existsSync(src)) fail(`missing export ${a.gameplayPath}`);
  const buf = readFileSync(src);
  const sha = sha256(buf);
  if (sha !== a.sha256) fail(`sha256 mismatch ${a.gameplayPath}: ${sha} != ${a.sha256}`);
  const [w, h] = pngInfo(buf, a.gameplayPath);
  if (w !== a.exportDimensions[0] || h !== a.exportDimensions[1]) {
    fail(`IHDR mismatch ${a.gameplayPath}: ${w}x${h} != ${a.exportDimensions}`);
  }
  const dst = join(OUT_ROOT, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
}
if (copied !== 34) fail(`expected 34 gameplay exports, processed ${copied}`);

// Cross-check that every declared layer and mount file exists in the exports.
const exported = new Set(displayProposal.assets.map((a) => a.gameplayPath));
for (const l of layersManifest.layers) {
  if (!exported.has(`gameplay/${l.path}`)) fail(`layer ${l.id} has no gameplay export`);
}
for (const role of mountsManifest.roles) {
  for (const p of [...role.layers, ...role.poses, ...(role.directionalPoses ?? [])]) {
    if (!exported.has(`gameplay/${p.path}`)) fail(`mount file ${p.path} has no gameplay export`);
  }
}

// Classify a layer's visual state rule by id; the importer keeps the manifest
// text verbatim for provenance and adds a machine-usable `state` field.
const layerState = (id: string): string => {
  if (id === "water-ripples-0") return "ripple-a";
  if (id === "water-ripples-1") return "ripple-b";
  if (id === "rift-ford-open") return "rift-open";
  if (id === "rift-ford-closing") return "rift-closed";
  if (id.startsWith("chaos-")) return id;
  return "static";
};

const runtime = {
  arenaId: "chaos-crossing-v002",
  schemaVersion: 1,
  // Half-size exports: the 600x920 art hosts the 500x800 board at offset
  // (50,60), one art pixel per board pixel (5 px per arena unit).
  board: {
    artCanvas: [600, 920] as const,
    boardOffset: [50, 60] as const,
    boardSize: [500, 800] as const,
    pxPerUnit: 5,
    // Master-board pixels (10 px/unit) for anchors below; halve to board px.
    masterOrigin: [100, 120] as const,
    masterPxPerUnit: 10,
  },
  layers: (layersManifest.layers as { id: string; path: string; zOrder: number; defaultVisible: boolean; stateRule: string }[]).map((l) => ({
    id: l.id,
    path: l.path,
    zOrder: l.zOrder,
    defaultVisible: l.defaultVisible,
    state: layerState(l.id),
    stateRule: l.stateRule,
  })),
  mounts: Object.fromEntries(
    (mountsManifest.roles as {
      role: string;
      seatLocalBoardPixels: [number, number];
      healthBarLocalBoardRectangle: [number, number, number, number];
      renderOrder: string[];
      layers: { path: string }[];
      poses: { path: string; weaponAnchorLocalBoardPixels: [number, number]; firingAllowed: boolean }[];
      directionalPoses?: { path: string; pose: string; weaponAnchorLocalBoardPixels: [number, number]; firingAllowed: boolean }[];
    }[]).map((r) => [
      r.role,
      {
        pivotNormalized: [0.5, 0.875],
        displayScale: 0.5,
        seatLocalBoardPixels: r.seatLocalBoardPixels,
        healthBarLocalBoardRectangle: r.healthBarLocalBoardRectangle,
        renderOrder: r.renderOrder,
        parts: {
          "structure-base": r.layers.find((p) => p.path.endsWith("structure-base.png"))?.path,
          "socket-platform": r.layers.find((p) => p.path.endsWith("socket-platform.png"))?.path,
          "front-rim": r.layers.find((p) => p.path.endsWith("front-rim.png"))?.path,
        },
        poses: Object.fromEntries(
          [
            ...r.poses.map((p) => ({
              pose: p.path.match(/defender-([a-z-]+)\.png$/)?.[1] ?? p.path,
              path: p.path,
              weaponAnchorLocalBoardPixels: p.weaponAnchorLocalBoardPixels,
              firingAllowed: p.firingAllowed,
            })),
            ...(r.directionalPoses ?? []).map((p) => ({
              pose: p.pose,
              path: p.path,
              weaponAnchorLocalBoardPixels: p.weaponAnchorLocalBoardPixels,
              firingAllowed: p.firingAllowed,
            })),
          ].map((p) => [p.pose, p])
        ),
      },
    ])
  ),
  placements: (layersManifest.structurePlacements as {
    id: string;
    mountRole: string;
    groundAnchorPixels: [number, number];
    directionRequested: string;
  }[]).map((p) => ({
    id: p.id,
    mountRole: p.mountRole,
    groundAnchorPixels: p.groundAnchorPixels,
    directionRequested: p.directionRequested,
  })),
};

mkdirSync(join(OUT_ROOT, "manifests"), { recursive: true });
writeFileSync(join(OUT_ROOT, "manifests/arena.runtime.json"), JSON.stringify(runtime, null, 2) + "\n");
console.log(`imported ${copied} arena files -> ${OUT_ROOT}`);
console.log(`layers: ${runtime.layers.length}, roles: ${Object.keys(runtime.mounts).join(", ")}, placements: ${runtime.placements.length}`);
