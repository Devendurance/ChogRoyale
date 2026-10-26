// Composite master layers for review. Run from the chog-royale repo root so
// `sharp` resolves: node <this> <layersDir> <out.png> [scale] [crop l,t,w,h] [layer ...]
const sharp = require(require.resolve("sharp", { paths: [process.cwd()] }));
const path = require("path");
const fs = require("fs");

const [dir, out, scaleArg = "0.5", cropArg = "-", ...only] = process.argv.slice(2);
const ORDER = [
  "base-terrain", "river-water", "water-ripples-0", "rift-ford-open", "banks-bridges",
  "foundations", "border-scenery", "ambient", "team-trim", "foreground",
];
(async () => {
  const ids = (only.length ? only : ORDER).filter((id) => fs.existsSync(path.join(dir, id + ".png")));
  const first = await sharp(path.join(dir, ids[0] + ".png")).metadata();
  let img = sharp({ create: { width: first.width, height: first.height, channels: 4, background: "#203040" } })
    .composite(ids.map((id) => ({ input: path.join(dir, id + ".png") })));
  let buf = await img.png().toBuffer();
  if (cropArg !== "-") {
    const [left, top, width, height] = cropArg.split(",").map(Number);
    buf = await sharp(buf).extract({ left, top, width, height }).png().toBuffer();
  }
  const meta = await sharp(buf).metadata();
  const s = Number(scaleArg);
  await sharp(buf).resize(Math.round(meta.width * s), Math.round(meta.height * s), { kernel: "lanczos3" }).png().toFile(out);
  console.log("wrote", out, ids.join(","));
})();
