// Chaos Crossing v003 gameplay export. Downsamples the Blender masters to the
// runtime contract (600x920 layers at 5 px/unit, 256x320 mount parts shown at
// 0.5 scale), validates alpha, measures bounds and writes the manifests the
// repo importer verifies. Run from the chog-royale repo root so `sharp`
// resolves: node <v003>/scripts/export_gameplay.cjs
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sharp = require(require.resolve("sharp", { paths: [process.cwd()] }));
sharp.cache(false);

const ROOT = path.resolve(__dirname, "..");
const V002 = path.resolve(ROOT, "..", "v002");
const OUT = path.join(ROOT, "gameplay");
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const LAYERS = [
  // id, zOrder, defaultVisible, state rule, space
  ["base-terrain", 10, true, "static", "camera"],
  ["river-water", 20, true, "static", "camera"],
  ["water-ripples-0", 30, true, "alternate ripple phase A", "camera"],
  ["water-ripples-1", 40, false, "alternate ripple phase B", "camera"],
  ["rift-ford-open", 50, false, "authoritative frame.riftOpen === true only", "camera"],
  ["rift-ford-closing", 60, false, "frame.riftOpen === false only; disconnected sparks never open ford", "camera"],
  ["banks-bridges", 70, true, "static", "camera"],
  ["foundations", 80, true, "static", "camera"],
  ["border-scenery", 90, true, "static", "camera"],
  ["chaos-warning", 100, false, "explicit Chaos visual state; never opens ford (v002 art reused byte-identical)", "board"],
  ["chaos-active", 110, false, "explicit Chaos visual state; never opens ford (v002 art reused byte-identical)", "board"],
  ["chaos-expiry", 120, false, "explicit Chaos visual state; never opens ford (v002 art reused byte-identical)", "board"],
  ["ambient", 130, true, "static", "camera"],
  ["team-trim", 140, true, "static; authored red top and blue bottom", "camera"],
  ["foreground", 150, true, "static", "camera"],
];

async function stats(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, n = 0, transparent = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * 4 + 3];
      if (a === 0) transparent++;
      if (a > 8) {
        n++;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  return {
    size: [info.width, info.height],
    alphaBounds: n ? [minx, miny, maxx, maxy] : null,
    coverage: +(n / (info.width * info.height)).toFixed(4),
    transparentPixels: transparent,
  };
}

async function down(src, dst, w, h) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const buf = await sharp(src).ensureAlpha().resize(w, h, { kernel: "lanczos3" }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  // Windows can briefly lock a just-read PNG; write through fs with a retry.
  for (let i = 0; ; i++) {
    try {
      fs.writeFileSync(dst, buf);
      return;
    } catch (e) {
      if (i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

(async () => {
  const assets = [];
  for (const [id, zOrder, defaultVisible, stateRule, space] of LAYERS) {
    const rel = `layers/${id}.png`;
    const dst = path.join(OUT, rel);
    let source;
    if (id.startsWith("chaos-")) {
      source = path.join(V002, "gameplay", rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(source, dst);
    } else {
      source = path.join(ROOT, "masters", rel);
      await down(source, dst, 600, 920);
    }
    const st = await stats(dst);
    if (st.size[0] !== 600 || st.size[1] !== 920) throw new Error(`${id} size ${st.size}`);
    if (id === "base-terrain" ? st.transparentPixels !== 0 : st.transparentPixels === 0) throw new Error(`${id} alpha contract failed`);
    assets.push({ kind: "layer", id, path: rel, zOrder, defaultVisible, stateRule, space, source: path.relative(ROOT, source).replace(/\\/g, "/"), sha256: sha(dst), ...st });
  }

  const records = JSON.parse(fs.readFileSync(path.join(ROOT, "masters/mounts/_mounts-record.json"), "utf8"));
  const roles = [];
  for (const r of records) {
    const parts = ["structure-base", "socket-platform", "front-rim"];
    const poses = ["idle", r.aim];
    const files = {};
    for (const p of [...parts, ...poses.map((x) => `defender-${x}`)]) {
      const rel = `mounts/${r.role}/${p}.png`;
      const dst = path.join(OUT, rel);
      await down(path.join(ROOT, "masters", rel), dst, 256, 320);
      const st = await stats(dst);
      if (st.transparentPixels === 0) throw new Error(`${rel} has no transparent pixels`);
      files[p] = rel;
      assets.push({ kind: "mount-part", id: `${r.role}:${p}`, path: rel, source: `masters/${rel}`, sha256: sha(dst), ...st });
    }
    // Health bar sits above the full assembled aim silhouette.
    const composite = await sharp(path.join(OUT, files["structure-base"]))
      .composite([files["socket-platform"], files[`defender-${r.aim}`], files["front-rim"]].map((f) => ({ input: path.join(OUT, f) })))
      .png()
      .toBuffer();
    const tmp = path.join(OUT, `_assembled-${r.role}.png`);
    fs.writeFileSync(tmp, composite);
    const st = await stats(tmp);
    fs.unlinkSync(tmp);
    const [x0, y0, x1, y1] = st.alphaBounds;
    const barW = r.kind === "core" ? 100 : 80;
    roles.push({
      role: r.role,
      kind: r.kind,
      team: r.team,
      defender: r.defender,
      aim: r.aim,
      authoredTeamColors: true,
      pivotNormalized: [0.5, 0.875],
      displayScale: 0.5,
      assembledAlphaBoundsRuntimePx: st.alphaBounds,
      artTopLocalBoardPixels: y0 - 280,
      artBottomLocalBoardPixels: y1 - 280,
      artWidthBoardPixels: (x1 - x0 + 1) / 2,
      healthBarLocalBoardRectangle: [-barW / 2, y0 - 280 - 12, barW, 5],
      renderOrder: ["structure-base", "socket-platform", "defender-pose", "front-rim"],
      parts: Object.fromEntries(parts.map((p) => [p, files[p]])),
      poses: Object.fromEntries(
        poses.map((p) => [p, { pose: p, path: files[`defender-${p}`], weaponAnchorLocalBoardPixels: r.weapon[p].weaponAnchorLocalBoardPixels, firingAllowed: p !== "idle", weaponAnchorSource: "projected 3D muzzle centre" }])
      ),
      groundAnchorCheckMasterPixels: r.groundAnchorCheck,
    });
  }
  fs.mkdirSync(path.join(ROOT, "manifests"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "manifests/display.json"), JSON.stringify({ schemaVersion: 2, arenaId: "chaos-crossing-v003", assets }, null, 1) + "\n");
  fs.writeFileSync(path.join(ROOT, "manifests/mounts.json"), JSON.stringify({ schemaVersion: 2, roles }, null, 1) + "\n");
  console.log(`exported ${assets.length} gameplay files, ${roles.length} roles`);
  for (const r of roles) console.log(r.role, "top", r.artTopLocalBoardPixels, "bottom", r.artBottomLocalBoardPixels, "width", r.artWidthBoardPixels, JSON.stringify(Object.fromEntries(Object.entries(r.poses).map(([k, v]) => [k, v.weaponAnchorLocalBoardPixels]))));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
