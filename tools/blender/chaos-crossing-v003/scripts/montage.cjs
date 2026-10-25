// node montage.cjs out.png height bg img1 img2 ...  (bg like "#1e2233" or "none")
const path = require("path");
const sharp = require(path.join("C:/Users/USER/Documents/ideas/chog-royale/node_modules/sharp"));
const [out, hStr, bg, ...files] = process.argv.slice(2);
const H = Number(hStr);
(async () => {
  const tiles = [];
  for (const f of files) {
    const buf = await sharp(f).resize({ height: H, fit: "inside", kernel: "lanczos3" }).png().toBuffer();
    const m = await sharp(buf).metadata();
    tiles.push({ buf, w: m.width });
  }
  const pad = 8;
  const W = tiles.reduce((s, t) => s + t.w + pad, pad);
  const background = bg === "none" ? { r: 0, g: 0, b: 0, alpha: 0 } : bg;
  let x = pad;
  const comp = tiles.map((t) => {
    const c = { input: t.buf, left: x, top: pad };
    x += t.w + pad;
    return c;
  });
  await sharp({ create: { width: W, height: H + pad * 2, channels: 4, background } }).composite(comp).png().toFile(out);
  console.log("wrote", out, W, H + pad * 2);
})();
