// Card readability check: renders the v001 portrait, an optional previous
// revision and the current portrait the way the battle hand draws them (3:4
// card, square portrait with object-fit: cover) at 72x96 and 46x61, plus the
// loadout's square object-fit: contain tile. Native-size cards sit on the top
// row of each block, 3x nearest-neighbour enlargements below them.
//   node card_check.cjs <repo_public_dir> <out_png> [prev_dir] [prev_label]
// prev_dir holds <unit>/card-portrait.png from an earlier revision.
// UNITS=a,b limits the check to some units (default: all twelve troops).
const path = require("path");
const sharp = require(path.join(__dirname, "../../../../node_modules/sharp"));
sharp.cache(false);

const [pub, out, prevDir, prevLabel = "previous"] = process.argv.slice(2);
const UNITS = process.env.UNITS
  ? process.env.UNITS.split(",")
  : ["choglings", "boulderback", "chaos_archer", "frostshell", "rift_runner", "sparkcaster", "chog_guardian", "hexwing", "rift_sprites", "gale_netter", "riftbreaker", "ember_mauler"];
const COLS = [
  ["v001", (u) => path.join(pub, "assets/chog-kit/v001/cards/derivatives", u, "portrait.png")],
  ...(prevDir ? [[prevLabel, (u) => path.join(prevDir, u, "card-portrait.png")]] : []),
  ["current", (u) => path.join(pub, "assets/chog-units/v001", u, "card-portrait.png")],
];

const cardBg = (w, h) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c63ff"/><stop offset="1" stop-color="#4a23b8"/></linearGradient></defs><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${Math.round(w / 8)}" fill="url(#g)" stroke="#ac8ce4" stroke-width="2"/></svg>`);
const text = (t, w, size = 14) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 8}"><text x="2" y="${size + 2}" font-family="Arial" font-weight="700" font-size="${size}" fill="#fff2d8">${t}</text></svg>`);

async function card(file, w, h) {
  const side = Math.max(w, h);
  const art = await sharp(file).resize(side, side, { kernel: "lanczos3" }).extract({ left: Math.floor((side - w) / 2), top: Math.floor((side - h) / 2), width: w, height: h }).toBuffer();
  return sharp(cardBg(w, h)).composite([{ input: art }]).png().toBuffer();
}
async function tile(file, s) {
  const art = await sharp(file).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" }).toBuffer();
  return sharp(cardBg(s, s)).composite([{ input: art }]).png().toBuffer();
}
const up = (buf, k) => sharp(buf).metadata().then((m) => sharp(buf).resize(m.width * k, m.height * k, { kernel: "nearest" }).toBuffer());

(async () => {
  const comp = [];
  const colW = 400;
  let y = 10;
  for (const unit of UNITS) {
    comp.push({ input: text(unit, 300, 16), left: 10, top: y });
    y += 26;
    let x = 10;
    for (const [name, src] of COLS) {
      const f = src(unit);
      const c72 = await card(f, 72, 96);
      const c46 = await card(f, 46, 61);
      const t = await tile(f, 64);
      comp.push({ input: text(name, 160, 12), left: x, top: y });
      const row = y + 18;
      comp.push({ input: c72, left: x, top: row }, { input: c46, left: x + 80, top: row }, { input: t, left: x + 134, top: row });
      comp.push({ input: await up(c72, 3), left: x, top: row + 104 }, { input: await up(c46, 3), left: x + 224, top: row + 104 });
      x += colW;
    }
    y += 18 + 104 + 300;
  }
  await sharp({ create: { width: 20 + COLS.length * colW, height: y, channels: 4, background: "#1e1533" } }).composite(comp).png().toFile(out);
  console.log("wrote", out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
