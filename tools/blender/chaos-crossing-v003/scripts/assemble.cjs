// node assemble.cjs <mountsDir> <out.png> role[:pose] ...  Assembles base, socket, pose and rim on a dark card.
const path = require("path");
const sharp = require(path.join("C:/Users/USER/Documents/ideas/chog-royale/node_modules/sharp"));
const [dir, out, ...roles] = process.argv.slice(2);
(async () => {
  const tiles = [];
  for (const spec of roles) {
    const [role, poseArg] = spec.split(":");
    const pose = poseArg || (role.endsWith("red") ? "aim-south" : "aim-north");
    const f = (p) => path.join(dir, role, p + ".png");
    const buf = await sharp(f("structure-base"))
      .composite([f("socket-platform"), f(`defender-${pose}`), f("front-rim")].map((input) => ({ input })))
      .png()
      .toBuffer();
    tiles.push(buf);
  }
  const m = await sharp(tiles[0]).metadata();
  await sharp({ create: { width: m.width * tiles.length, height: m.height, channels: 4, background: "#1e2a38" } })
    .composite(tiles.map((input, i) => ({ input, left: i * m.width, top: 0 })))
    .png()
    .toFile(out);
  console.log("wrote", out);
})();
