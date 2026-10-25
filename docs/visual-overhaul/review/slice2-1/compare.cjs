// Labelled review sheets for slice 2.1. Run: node compare.cjs
const path = require("path");
const sharp = require(path.join("C:/Users/USER/Documents/ideas/chog-royale/node_modules/sharp"));

const HERE = __dirname;
const V = "C:/Users/USER/Documents/ChogRoyale-Assets/arena-worlds/chaos-crossing/v003";
const PREV = path.join(HERE, "prev-slice2");
const REPO = "C:/Users/USER/Documents/ideas/chog-royale";
const PACK = path.join(REPO, "Chog_Royale_Devin_Asset_Reference_Pack_v1/02_CARDS/01_CANONICAL_ORIGINAL_IDENTITY");

const H = 440;
const LABEL = 44;

async function tile(file, label, { trim = true, bg = "#26304a" } = {}) {
  let img = sharp(file).ensureAlpha();
  if (trim) img = sharp(await img.trim({ threshold: 1 }).png().toBuffer());
  const buf = await img.resize({ width: 340, height: H - 20, fit: "inside", kernel: "lanczos3" }).png().toBuffer();
  const m = await sharp(buf).metadata();
  const W = 360;
  const svg = Buffer.from(
    `<svg width="${W}" height="${LABEL}"><text x="${W / 2}" y="28" font-family="Segoe UI, Arial" font-size="19" fill="#f4f1e8" text-anchor="middle">${label}</text></svg>`
  );
  return sharp({ create: { width: W, height: H + LABEL, channels: 4, background: bg } })
    .composite([
      { input: buf, left: Math.round((W - m.width) / 2), top: Math.round((H - m.height) / 2) },
      { input: svg, left: 0, top: H },
    ])
    .png()
    .toBuffer();
}

async function sheet(out, tiles) {
  const bufs = await Promise.all(tiles.map(([f, l, o]) => tile(f, l, o)));
  const W = 360 * bufs.length + 8 * (bufs.length + 1);
  await sharp({ create: { width: W, height: H + LABEL + 16, channels: 4, background: "#141a28" } })
    .composite(bufs.map((input, i) => ({ input, left: 8 + i * 368, top: 8 })))
    .png()
    .toFile(path.join(HERE, out));
  console.log("wrote", out);
}

(async () => {
  await sheet("bulwark-comparison.png", [
    [path.join(PACK, "21_bulwark.png"), "Original card 21 (canonical)", { trim: false }],
    [path.join(REPO, "public/assets/site/commanders/bulwark.png"), "Original art, large", {}],
    [path.join(PREV, "mounts/lane-red/identity-bulwark.png"), "Slice 2 model"],
    [path.join(V, "masters/mounts/lane-red/identity-bulwark.png"), "Slice 2.1 refined"],
    [path.join(PREV, "mounts/lane-red/defender-aim-south.png"), "Slice 2 on tower (aim down)"],
    [path.join(V, "masters/mounts/lane-red/defender-aim-south.png"), "2.1 on tower (aim down)"],
  ]);
  await sheet("guardian-comparison.png", [
    [path.join(PACK, "07_chog_guardian.png"), "Original card 07 (canonical)", { trim: false }],
    [path.join(REPO, "public/assets/chog-kit/v001/troops/chog_guardian/sprite.png"), "Original art, kit sprite", {}],
    [path.join(PREV, "mounts/lane-blue/identity-guardian.png"), "Slice 2 model"],
    [path.join(V, "masters/mounts/lane-blue/identity-guardian.png"), "2.1 refined, front identity"],
    [path.join(PREV, "mounts/lane-blue/defender-aim-north.png"), "Slice 2 on tower (back)"],
    [path.join(V, "masters/mounts/lane-blue/defender-aim-north.png"), "2.1 on tower (back, aim up)"],
  ]);
})();
