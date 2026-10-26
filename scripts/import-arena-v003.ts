// Visual overhaul v3 slice 2 importer for the Chaos Crossing v003 arena.
// Reads the asset-side display and mount manifests (written by the Blender
// pipeline's export_gameplay.cjs), verifies every gameplay export (present,
// sha256, PNG IHDR size, RGBA color type), copies them into
// public/assets/arena/chaos-crossing/v003 and writes the runtime manifest.
//
// v003 differs from v002 in three presentation-only ways:
// - every pre-rendered layer is camera-space (`space: "camera"`), so both
//   seats see the same upright 2.5D art; only the reused v002 Chaos overlays
//   keep the board-space mirror,
// - the team trim is authored red (top) and blue (bottom), so the renderer
//   skips the v002 crop-and-tint,
// - mounts are team-keyed (`structureMounts`): the opponent's structures use
//   red Bulwark mounts aiming south and the viewer's use blue Chog Guardian
//   mounts aiming north. Placements carry `kind` so they resolve for both.
//
// Run: npx tsx scripts/import-arena-v003.ts
// Re-runnable: overwrites the same public/ tree, fails loudly on mismatch.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ARENA_ROOT = "C:/Users/USER/Documents/ChogRoyale-Assets/arena-worlds/chaos-crossing/v003";
const OUT_ROOT = join(process.cwd(), "public/assets/arena/chaos-crossing/v003");

const fail = (msg: string): never => {
  throw new Error(`import-arena-v003: ${msg}`);
};

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const pngInfo = (buf: Buffer, rel: string): [number, number] => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 26 || !buf.subarray(0, 8).equals(sig)) fail(`${rel} is not a PNG`);
  if (buf.toString("ascii", 12, 16) !== "IHDR") fail(`${rel} missing IHDR`);
  if (buf[25] !== 6) fail(`${rel} is color type ${buf[25]}, expected RGBA (6)`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

interface DisplayAsset {
  kind: "layer" | "mount-part";
  id: string;
  path: string;
  sha256: string;
  size: [number, number];
  zOrder?: number;
  defaultVisible?: boolean;
  stateRule?: string;
  space?: "camera" | "board";
}

interface MountRecord {
  role: string;
  kind: "tower" | "core";
  team: "red" | "blue";
  aim: string;
  authoredTeamColors: boolean;
  pivotNormalized: [number, number];
  displayScale: number;
  healthBarLocalBoardRectangle: [number, number, number, number];
  artTopLocalBoardPixels: number;
  renderOrder: string[];
  parts: Record<string, string>;
  poses: Record<string, { pose: string; path: string; weaponAnchorLocalBoardPixels: [number, number]; firingAllowed: boolean }>;
}

const display = JSON.parse(readFileSync(join(ARENA_ROOT, "manifests/display.json"), "utf8")) as { assets: DisplayAsset[] };
const mounts = JSON.parse(readFileSync(join(ARENA_ROOT, "manifests/mounts.json"), "utf8")) as { roles: MountRecord[] };

const seen = new Set<string>();
for (const a of display.assets) {
  if (seen.has(a.path)) fail(`duplicate path ${a.path}`);
  seen.add(a.path);
  if (a.path.includes("..") || a.path.startsWith("/")) fail(`unsafe path ${a.path}`);
  const src = join(ARENA_ROOT, "gameplay", a.path);
  if (!existsSync(src)) fail(`missing export ${a.path}`);
  const buf = readFileSync(src);
  if (sha256(buf) !== a.sha256) fail(`sha256 mismatch ${a.path}`);
  const [w, h] = pngInfo(buf, a.path);
  const expected = a.kind === "layer" ? [600, 920] : [256, 320];
  if (w !== expected[0] || h !== expected[1] || w !== a.size[0] || h !== a.size[1]) fail(`IHDR mismatch ${a.path}: ${w}x${h}`);
  const dst = join(OUT_ROOT, a.path);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

const layers = display.assets.filter((a) => a.kind === "layer");
if (layers.length !== 15) fail(`expected 15 layers, got ${layers.length}`);
for (const r of mounts.roles) {
  for (const p of [...Object.values(r.parts), ...Object.values(r.poses).map((x) => x.path)]) {
    if (!seen.has(p)) fail(`mount file ${p} has no gameplay export`);
  }
}

const layerState = (id: string): string => {
  if (id === "water-ripples-0") return "ripple-a";
  if (id === "water-ripples-1") return "ripple-b";
  if (id === "rift-ford-open") return "rift-open";
  if (id === "rift-ford-closing") return "rift-closed";
  if (id.startsWith("chaos-")) return id;
  return "static";
};

const roleFor = (kind: "tower" | "core", team: "red" | "blue") =>
  mounts.roles.find((r) => r.kind === kind && r.team === team)?.role ?? fail(`no ${team} ${kind} role`);

const runtime = {
  arenaId: "chaos-crossing-v003",
  schemaVersion: 2,
  board: {
    artCanvas: [600, 920] as const,
    boardOffset: [50, 60] as const,
    boardSize: [500, 800] as const,
    pxPerUnit: 5,
    masterOrigin: [100, 120] as const,
    masterPxPerUnit: 10,
  },
  layers: [...layers]
    .sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0))
    .map((l) => ({
      id: l.id,
      path: l.path,
      zOrder: l.zOrder,
      defaultVisible: l.defaultVisible,
      state: layerState(l.id),
      stateRule: l.stateRule,
      space: l.space,
      ...(l.id === "team-trim" ? { authoredTeamColors: true } : {}),
    })),
  // Player-relative: the viewer's own structures are always the friendly
  // (blue, bottom) role and the opponent's the red top role.
  structureMounts: {
    tower: { friendly: roleFor("tower", "blue"), opponent: roleFor("tower", "red") },
    core: { friendly: roleFor("core", "blue"), opponent: roleFor("core", "red") },
  },
  mounts: Object.fromEntries(
    mounts.roles.map((r) => [
      r.role,
      {
        kind: r.kind,
        team: r.team,
        authoredTeamColors: r.authoredTeamColors,
        pivotNormalized: r.pivotNormalized,
        displayScale: r.displayScale,
        seatLocalBoardPixels: [0, 0],
        healthBarLocalBoardRectangle: r.healthBarLocalBoardRectangle,
        artTopLocalBoardPixels: r.artTopLocalBoardPixels,
        renderOrder: r.renderOrder,
        parts: r.parts,
        poses: Object.fromEntries(
          Object.entries(r.poses).map(([k, p]) => [
            k,
            { pose: p.pose, path: p.path, weaponAnchorLocalBoardPixels: p.weaponAnchorLocalBoardPixels, firingAllowed: p.firingAllowed },
          ])
        ),
      },
    ])
  ),
  placements: [
    { id: "p1-core", kind: "core", groundAnchorPixels: [600, 200] },
    { id: "p1-west", kind: "tower", groundAnchorPixels: [400, 520] },
    { id: "p1-east", kind: "tower", groundAnchorPixels: [800, 520] },
    { id: "p0-west", kind: "tower", groundAnchorPixels: [400, 1320] },
    { id: "p0-east", kind: "tower", groundAnchorPixels: [800, 1320] },
    { id: "p0-core", kind: "core", groundAnchorPixels: [600, 1640] },
  ],
};

mkdirSync(join(OUT_ROOT, "manifests"), { recursive: true });
writeFileSync(join(OUT_ROOT, "manifests/arena.runtime.json"), JSON.stringify(runtime, null, 2) + "\n");
console.log(`imported ${display.assets.length} arena files -> ${OUT_ROOT}`);
console.log(`layers: ${runtime.layers.length}, roles: ${Object.keys(runtime.mounts).join(", ")}, placements: ${runtime.placements.length}`);
