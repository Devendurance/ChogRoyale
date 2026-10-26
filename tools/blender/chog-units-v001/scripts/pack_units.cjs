// Packs build_units.py frames into Phaser spritesheets, downsamples the card
// portraits to the 256x256 contract and writes units.runtime.json.
//   node pack_units.cjs <masters_dir> <public_out_dir> [review_dir]
// UNITS=a,b packs a subset for review. Its manifest lists only those units, so
// point <public_out_dir> somewhere other than public/ for subset runs.
// Every frame shares one cell size and ground pivot. The packer fails if a
// frame touches its cell border, which would mean a cropped pose.
// Slice 3.1: masters render at 2x and are Lanczos-downsampled here, so the
// sheet lands near 1 sheet px per board px (the canvas backing resolution).
// Front clips come first, then the rear three-quarter clips in the same order.
// Slice 4: units marked `trim` are cropped to the union of their painted
// pixels across every frame and both views (plus a margin) before the
// downsample, so generous render cells don't cost texture memory. The shared
// pivot moves with the crop. Choglings and Boulderback stay untrimmed, so
// their Slice 3.1 sheets repack byte for byte.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require(path.join(__dirname, "../../../../node_modules/sharp"));
sharp.cache(false);

const [mastersDir, outDir, reviewDir] = process.argv.slice(2);
const CLIP_ORDER = ["idle", "move", "attack", "hit", "defeat"];
const VIEWS = ["front", "rear"];
const COLUMNS = 8;
const DOWN = 2;
// Ruleset-derived timing (TROOP_CARDS_V1, 10 ticks/s). unit-anim.test.ts
// checks these against the live ruleset so they can't silently drift.
// Board heights are +12% and +8% over Slice 3 for readability. Art only: the
// hitbox, anchor and spacing come from the ruleset and don't change.
// `hitsAir` and `air` mirror the ruleset too (presentation engagement and the
// flying lift). Slice 4 heights keep the roster's relative sizes readable.
const RULES = {
  choglings: { attackIntervalTicks: 8, range: 2, hitsAir: false, air: false, targetBoardHeight: 38 },
  boulderback: { attackIntervalTicks: 12, range: 2, hitsAir: false, air: false, targetBoardHeight: 52 },
  chaos_archer: { attackIntervalTicks: 10, range: 18, hitsAir: true, air: false, targetBoardHeight: 44, trim: true },
  frostshell: { attackIntervalTicks: 12, range: 2, hitsAir: false, air: false, targetBoardHeight: 52, trim: true },
  rift_runner: { attackIntervalTicks: 9, range: 2, hitsAir: false, air: false, targetBoardHeight: 44, trim: true },
  sparkcaster: { attackIntervalTicks: 14, range: 20, hitsAir: true, air: false, targetBoardHeight: 48, trim: true },
  chog_guardian: { attackIntervalTicks: 10, range: 2, hitsAir: false, air: false, targetBoardHeight: 50, trim: true },
  hexwing: { attackIntervalTicks: 10, range: 14, hitsAir: true, air: true, targetBoardHeight: 50, trim: true },
  rift_sprites: { attackIntervalTicks: 8, range: 2, hitsAir: false, air: true, targetBoardHeight: 34, trim: true },
  gale_netter: { attackIntervalTicks: 10, range: 16, hitsAir: true, air: false, targetBoardHeight: 46, trim: true },
  riftbreaker: { attackIntervalTicks: 11, range: 2, hitsAir: false, air: false, targetBoardHeight: 54, trim: true },
  ember_mauler: { attackIntervalTicks: 12, range: 2, hitsAir: false, air: false, targetBoardHeight: 54, trim: true },
  // Final assets. Buildings (BUILDING_CARDS_V1) swap `move` for a one-shot
  // `deploy` clip and fire on authoritative events or presentation engagement
  // (Sentry). The Totem and Burrow render one view. No card portraits: the
  // original 2D card art stays the card art. unit-anim.test.ts checks these
  // timings against the live ruleset and commander combat profile.
  rift_sentry: { kind: "building", attackIntervalTicks: 8, range: 16, hitsAir: false, air: false, targetBoardHeight: 58, trim: true, clips: ["idle", "deploy", "attack", "hit", "defeat"], portrait: false },
  decoy_totem: { kind: "building", attackIntervalTicks: 16, range: 20, hitsAir: false, air: false, targetBoardHeight: 62, trim: true, clips: ["idle", "deploy", "attack", "hit", "defeat"], views: ["front"], portrait: false },
  chog_burrow: { kind: "building", attackIntervalTicks: 50, range: 0, hitsAir: false, air: false, targetBoardHeight: 46, trim: true, clips: ["idle", "deploy", "attack", "hit", "defeat"], views: ["front"], portrait: false },
  rift_mortar: { kind: "building", attackIntervalTicks: 40, range: 50, hitsAir: false, air: false, targetBoardHeight: 56, trim: true, clips: ["idle", "deploy", "attack", "hit", "defeat"], portrait: false },
  // Commander class sheets (COMMANDER_COMBAT_PROFILE_V1), shared by every
  // commander of the class. The ability clip plays on an active ability_fired.
  commander_bulwark: { kind: "commander", attackIntervalTicks: 12, range: 2, hitsAir: false, air: false, targetBoardHeight: 54, trim: true, clips: ["idle", "move", "attack", "hit", "defeat", "ability"], portrait: false },
  commander_reaver: { kind: "commander", attackIntervalTicks: 11, range: 2, hitsAir: false, air: false, targetBoardHeight: 52, trim: true, clips: ["idle", "move", "attack", "hit", "defeat", "ability"], portrait: false },
  commander_deadeye: { kind: "commander", attackIntervalTicks: 13, range: 16, hitsAir: true, air: false, targetBoardHeight: 52, trim: true, clips: ["idle", "move", "attack", "hit", "defeat", "ability"], portrait: false },
  commander_scout: { kind: "commander", attackIntervalTicks: 7, range: 3, hitsAir: false, air: false, targetBoardHeight: 50, trim: true, clips: ["idle", "move", "attack", "hit", "defeat", "ability"], portrait: false },
  commander_warden: { kind: "commander", attackIntervalTicks: 12, range: 8, hitsAir: false, air: false, targetBoardHeight: 58, trim: true, clips: ["idle", "move", "attack", "hit", "defeat", "ability"], portrait: false },
  // Spawned by the Chog Burrow (SPAWNED_TROOPS_V1), never a card.
  burrow_scrapper: { kind: "spawned", attackIntervalTicks: 8, range: 2, hitsAir: false, air: false, targetBoardHeight: 38, trim: true, portrait: false },
};
const MARGIN = 6;
const even = (n, up) => (up ? Math.ceil(n / 2) * 2 : Math.floor(n / 2) * 2);

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const write = (file, buf) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      fs.writeFileSync(file, buf);
      return;
    } catch (e) {
      if (i > 5) throw e;
    }
  }
};

async function alphaInfo(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let top = h, bottom = -1, left = w, right = -1, border = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (!a) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = Math.max(border, a);
      if (a > 24) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  return { top, bottom, left, right, border };
}

const label = (text, w, h, size = 13) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="4" y="${size + 2}" font-family="Arial" font-weight="700" font-size="${size}" fill="#ffffff" stroke="#1d1424" stroke-width="3" paint-order="stroke">${text}</text></svg>`);

(async () => {
  // MERGE=1 keeps every entry already in <public_out_dir>'s manifest and only
  // replaces the units packed in this run, so approved sheets aren't repacked.
  const manifestPath = path.join(outDir, "manifests/units.runtime.json");
  const prior = process.env.MERGE && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  const manifest = { schema: 1, version: "chog-units-v001", revision: prior ? "final" : "slice4.1", source: "tools/blender/chog-units-v001", units: { ...(prior?.units ?? {}) } };
  const only = process.env.UNITS ? process.env.UNITS.split(",") : null;
  for (const unit of Object.keys(RULES)) {
    if (only && !only.includes(unit)) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(mastersDir, unit, "record.json"), "utf8"));
    const rules = RULES[unit];
    const clipOrder = rules.clips ?? CLIP_ORDER;
    const unitViews = rules.views ?? VIEWS;
    const views = {};
    const frames = [];
    for (const view of unitViews) {
      const vc = rec.views?.[view];
      if (!vc) throw new Error(`${unit}: missing ${view} view`);
      views[view] = {};
      for (const clip of clipOrder) {
        const c = vc[clip];
        if (!c) throw new Error(`${unit}: missing ${view} clip ${clip}`);
        if (view !== "front" && c.files.length !== views.front[clip].count) throw new Error(`${unit}: ${view} ${clip} frame count differs from front`);
        views[view][clip] = { start: frames.length, count: c.files.length, fps: c.fps, loop: c.loop, ...(c.impact != null ? { impact: c.impact } : {}) };
        for (const f of c.files) frames.push({ view, clip, file: path.join(mastersDir, unit, f) });
      }
    }
    const clips = views.front;
    let worstBorder = 0;
    const [rw, rh] = rec.cell;
    const box = { left: rw, top: rh, right: -1, bottom: -1 };
    for (const fr of frames) {
      fr.alpha = await alphaInfo(fr.file);
      worstBorder = Math.max(worstBorder, fr.alpha.border);
      for (const k of ["left", "top"]) box[k] = Math.min(box[k], fr.alpha[k]);
      for (const k of ["right", "bottom"]) box[k] = Math.max(box[k], fr.alpha[k]);
    }
    if (worstBorder > 0) {
      const bad = frames.filter((f) => f.alpha.border > 0).map((f) => `${f.view}/${path.basename(f.file)} [${f.alpha.left},${f.alpha.top},${f.alpha.right},${f.alpha.bottom}]`);
      throw new Error(`${unit}: frames touch their ${rw}x${rh} cell border: ${bad.join(" ")}`);
    }
    // Crop window in master px: whole cell, or the painted union plus margin,
    // snapped to even numbers so cell and pivot still halve exactly.
    const crop = rules.trim
      ? (() => {
          const left = even(Math.max(0, box.left - MARGIN), false);
          const top = even(Math.max(0, box.top - MARGIN), false);
          const right = even(Math.min(rw, box.right + 1 + MARGIN), true);
          const bottom = even(Math.min(rh, Math.max(box.bottom + 1 + MARGIN, rec.pivot[1] + 2 * MARGIN)), true);
          return { left, top, width: right - left, height: bottom - top };
        })()
      : { left: 0, top: 0, width: rw, height: rh };
    const [mw, mh] = [crop.width, crop.height];
    const mp = [rec.pivot[0] - crop.left, rec.pivot[1] - crop.top];
    if (mw % DOWN || mh % DOWN || mp[0] % DOWN || mp[1] % DOWN) throw new Error(`${unit}: cell and pivot must divide by ${DOWN}`);
    if (mp[0] <= 0 || mp[0] >= mw || mp[1] <= 0 || mp[1] >= mh) throw new Error(`${unit}: pivot falls outside the crop`);
    const [cw, ch] = [mw / DOWN, mh / DOWN];
    const pivot = [mp[0] / DOWN, mp[1] / DOWN];
    let idleTop = ch;
    for (const fr of frames) {
      fr.master = rules.trim ? await sharp(fr.file).extract(crop).png().toBuffer() : fr.file;
      fr.small = await sharp(fr.master).resize(cw, ch, { kernel: "lanczos3" }).png().toBuffer();
      if (fr.view === "front" && fr.clip === "idle") idleTop = Math.min(idleTop, (await alphaInfo(fr.small)).top);
    }
    const rows = Math.ceil(frames.length / COLUMNS);
    const sheet = await sharp({ create: { width: COLUMNS * cw, height: rows * ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(frames.map((fr, i) => ({ input: fr.small, left: (i % COLUMNS) * cw, top: Math.floor(i / COLUMNS) * ch })))
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    const sheetRel = `${unit}/sheet.png`;
    write(path.join(outDir, sheetRel), sheet);
    const portrait = rules.portrait === false ? null : await sharp(path.join(mastersDir, unit, "card-portrait@4x.png")).resize(256, 256, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
    const portraitRel = `${unit}/card-portrait.png`;
    if (portrait) write(path.join(outDir, portraitRel), portrait);
    const visibleHeight = pivot[1] - idleTop;
    const displayScale = Math.round((rules.targetBoardHeight / visibleHeight) * 1000) / 1000;
    const defeat = clips.defeat;
    // Anchors (muzzle, weapon tip) in sheet px of the packed cell.
    const anchors = rec.anchors
      ? Object.fromEntries(Object.keys(rec.anchors[unitViews[0]] ?? {}).map((nm) => [nm, Object.fromEntries(unitViews.map((view) => [view,
          Object.fromEntries(Object.entries(rec.anchors[view]?.[nm] ?? {}).map(([clip, [ax, ay]]) => [clip, [Math.round(((ax - crop.left) / DOWN) * 10) / 10, Math.round(((ay - crop.top) / DOWN) * 10) / 10]]))]))]))
      : null;
    manifest.units[unit] = {
      ...(rules.kind ? { kind: rules.kind } : {}),
      entityId: unit,
      sheet: sheetRel,
      sha256: sha(sheet),
      width: COLUMNS * cw,
      height: rows * ch,
      frameWidth: cw,
      frameHeight: ch,
      columns: COLUMNS,
      frameCount: frames.length,
      pivot,
      pivotNormalized: [pivot[0] / cw, pivot[1] / ch],
      visibleHeight,
      displayScale,
      facing: "right",
      clips,
      ...(views.rear ? { rearClips: views.rear } : {}),
      attackPeriodMs: rules.attackIntervalTicks * 100,
      reach: rules.range,
      hitsAir: rules.hitsAir,
      air: rules.air,
      defeatMs: Math.round((defeat.count / defeat.fps) * 1000),
      ...(portrait ? { portrait: portraitRel, portraitSha256: sha(portrait) } : {}),
      ...(anchors ? { anchors } : {}),
      camera: { tiltDeg: rec.tiltDeg, yawDeg: rec.yawDeg, rearYawDeg: 180 - rec.yawDeg, pxPerUnit: rec.pxPerUnit / DOWN },
    };
    console.log(unit, `${frames.length} frames`, `${COLUMNS * cw}x${rows * ch}`, `${(sheet.length / 1024).toFixed(1)} KB`, `visible ${visibleHeight}px`, `scale ${displayScale}`);

    if (reviewDir) {
      // Contact sheet: one row per view and clip on arena grass, drawn from
      // the 2x masters, with frame labels and the shared ground pivot tick.
      const k = DOWN;
      const maxCount = Math.max(...clipOrder.map((c) => clips[c].count));
      const W = 110 + maxCount * cw * k;
      const rowsList = unitViews.flatMap((view) => clipOrder.map((clip) => [view, clip]));
      const H = rowsList.length * ch * k;
      const comp = [];
      for (const [ri, [view, clip]] of rowsList.entries()) {
        const vc = views[view];
        comp.push({ input: label(`${view} ${clip}`, 110, 22, 13), left: 0, top: ri * ch * k + 8 });
        comp.push({ input: label(`${vc[clip].fps}fps`, 110, 22, 12), left: 0, top: ri * ch * k + 28 });
        for (let i = 0; i < vc[clip].count; i++) {
          const fr = frames[vc[clip].start + i];
          comp.push({ input: fr.master, left: 110 + i * cw * k, top: ri * ch * k });
          comp.push({ input: label(String(i) + (vc[clip].impact === i ? " hit" : ""), 60, 20, 12), left: 110 + i * cw * k, top: ri * ch * k });
          comp.push({ input: { create: { width: 9, height: 2, channels: 4, background: "#ff3355" } }, left: 110 + i * cw * k + mp[0] - 4, top: ri * ch * k + mp[1] });
        }
      }
      await sharp({ create: { width: W, height: H, channels: 4, background: "#6f9f55" } }).composite(comp).png().toFile(path.join(reviewDir, `${unit}-contact-sheet.png`));
    }
  }
  write(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  console.log("wrote", manifestPath);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
