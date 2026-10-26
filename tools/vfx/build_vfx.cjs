/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS build tool, like pack_units.cjs. */
// Battle VFX v001: generated effect textures with true alpha, plus the Blender
// spell props (comet rock, rally horn) rendered by build_vfx_props.py, packed
// into public/assets/battle-vfx/v001 with a runtime manifest.
//   node tools/vfx/build_vfx.cjs [props_dir]
// Effects are authored white or in their element colours. White textures are
// tinted at runtime (team rings, shields). Elemental effects keep their own
// colours and are never recoloured by allegiance. Every random shape is
// seeded, so a rebuild is byte-stable.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require(path.join(__dirname, "../../node_modules/sharp"));
sharp.cache(false);

const OUT = path.join(__dirname, "../../public/assets/battle-vfx/v001");
const PROPS = process.argv[2] || "C:/Users/USER/Documents/ChogRoyale-Assets/final-assets/vfx-props";

const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const svg = (w, h, body, defs = "") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`);
const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const f2 = (n) => Math.round(n * 100) / 100;

async function sheet(frames, w, h) {
  const bufs = await Promise.all(frames.map((b) => sharp(b).png().toBuffer()));
  return sharp({ create: { width: w * bufs.length, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(bufs.map((input, i) => ({ input, left: i * w, top: 0 })))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ---------------------------------------------------------------- textures

const glow = () => svg(64, 64, `<circle cx="32" cy="32" r="31" fill="url(#g)"/>`,
  `<radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);

const ring = () => svg(128, 128,
  `<circle cx="64" cy="64" r="54" fill="none" stroke="#fff" stroke-width="10" stroke-opacity="0.45" filter="url(#b)"/><circle cx="64" cy="64" r="54" fill="none" stroke="#fff" stroke-width="3.2"/>`,
  blur("b", 4));

// Ground ring in board perspective (52 degree camera tilt: y squashed by cos).
const groundRing = () => svg(160, 100,
  `<ellipse cx="80" cy="50" rx="70" ry="43" fill="none" stroke="#fff" stroke-width="9" stroke-opacity="0.4" filter="url(#b)"/><ellipse cx="80" cy="50" rx="70" ry="43" fill="none" stroke="#fff" stroke-width="2.6"/>`,
  blur("b", 3.5));

const spark = () => {
  const p = (r, k) => Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; const rr = i % 2 ? r * k : r; return `${f2(24 + Math.cos(a) * rr)},${f2(24 + Math.sin(a) * rr)}`; }).join(" ");
  return svg(48, 48, `<circle cx="24" cy="24" r="10" fill="#fff" opacity="0.55" filter="url(#b)"/><polygon points="${p(22, 0.18)}" fill="#fff"/>`, blur("b", 4));
};

const streak = () => svg(96, 24, `<ellipse cx="60" cy="12" rx="34" ry="6" fill="#fff" opacity="0.6" filter="url(#b)"/><ellipse cx="62" cy="12" rx="30" ry="2.6" fill="#fff"/>`,
  blur("b", 3) + `<linearGradient id="t"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>`);

const muzzle = () => {
  const p = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; const rr = i % 2 ? 9 : 29; return `${f2(32 + Math.cos(a) * rr)},${f2(32 + Math.sin(a) * rr)}`; }).join(" ");
  return svg(64, 64, `<circle cx="32" cy="32" r="18" fill="#fff" opacity="0.6" filter="url(#b)"/><polygon points="${p}" fill="#fff" opacity="0.9"/><circle cx="32" cy="32" r="8" fill="#fff"/>`, blur("b", 5));
};

const burstFrames = () => Array.from({ length: 5 }, (_, f) => {
  const k = (f + 1) / 5;
  const r = rng(77 + f);
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + r() * 0.3;
    const r0 = 10 + 26 * k, r1 = r0 + (22 - 14 * k) * (0.7 + 0.5 * r());
    const w = 5 * (1 - k * 0.7);
    const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    return `<polygon points="${f2(48 + Math.cos(a) * r0 + nx)},${f2(48 + Math.sin(a) * r0 + ny)} ${f2(48 + Math.cos(a) * r1)},${f2(48 + Math.sin(a) * r1)} ${f2(48 + Math.cos(a) * r0 - nx)},${f2(48 + Math.sin(a) * r0 - ny)}" fill="#fff"/>`;
  }).join("");
  const op = f2(1 - k * 0.75);
  return svg(96, 96, `<g opacity="${op}"><circle cx="48" cy="48" r="${f2(14 + 28 * k)}" fill="none" stroke="#fff" stroke-width="${f2(6 - 4 * k)}"/>${rays}<circle cx="48" cy="48" r="${f2(16 * (1 - k) + 2)}" fill="#fff" filter="url(#b)"/></g>`, blur("b", 4));
});

const smokeFrames = () => Array.from({ length: 6 }, (_, f) => {
  const k = f / 5;
  const r = rng(301);
  const puffs = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + r() * 0.6;
    const d = 6 + 16 * k;
    const rr = 9 + 8 * k + r() * 4;
    return `<circle cx="${f2(32 + Math.cos(a) * d)}" cy="${f2(34 + Math.sin(a) * d * 0.7 - 6 * k)}" r="${f2(rr)}" fill="url(#s)"/>`;
  }).join("");
  return svg(64, 64, `<g opacity="${f2(0.95 - 0.8 * k)}">${puffs}<circle cx="32" cy="${f2(32 - 4 * k)}" r="${f2(11 + 6 * k)}" fill="url(#s)"/></g>`,
    `<radialGradient id="s" cx="0.4" cy="0.35"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#ebe4da"/><stop offset="1" stop-color="#cfc6ba" stop-opacity="0"/></radialGradient>`);
});

const debrisFrames = () => Array.from({ length: 4 }, (_, f) => {
  const r = rng(500 + f);
  const n = 5 + (f % 2);
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + r() * 0.5; const rr = 7 + r() * 4; return `${f2(12 + Math.cos(a) * rr)},${f2(12 + Math.sin(a) * rr * 0.85)}`; }).join(" ");
  return svg(24, 24, `<polygon points="${pts}" fill="url(#d)" stroke="#2a2430" stroke-width="1.6" stroke-linejoin="round"/>`,
    `<linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dde4"/><stop offset="1" stop-color="#7d8390"/></linearGradient>`);
});

// Chaos Bolt: jagged violet strike with a hot white core, distinct from the
// Sparkcaster's yellow electricity. Three seeded variants, sky to ground.
const boltFrames = () => Array.from({ length: 3 }, (_, f) => {
  const r = rng(9001 + f * 17);
  const pts = [[48, 0]];
  let x = 48;
  for (let y = 18; y < 212; y += 14 + r() * 10) { x = Math.max(20, Math.min(76, x + (r() - 0.5) * 34)); pts.push([x, y]); }
  pts.push([48, 214]);
  const line = pts.map(([a, b]) => `${f2(a)},${f2(b)}`).join(" ");
  const branches = Array.from({ length: 3 }, () => {
    const s = pts[2 + Math.floor(r() * (pts.length - 4))];
    let bx = s[0], by = s[1];
    const dir = r() < 0.5 ? -1 : 1;
    const bp = [[bx, by]];
    for (let k = 0; k < 3; k++) { bx += dir * (8 + r() * 10); by += 10 + r() * 12; bp.push([bx, by]); }
    return bp.map(([a, b]) => `${f2(a)},${f2(b)}`).join(" ");
  });
  const stroke = (pl, w, c, o = 1, filt = "") => `<polyline points="${pl}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" opacity="${o}" ${filt}/>`;
  const body = [line, ...branches].map((pl, i) => stroke(pl, i ? 9 : 18, "#7b2ff0", 0.85, 'filter="url(#b)"')).join("") +
    [line, ...branches].map((pl, i) => stroke(pl, i ? 3.5 : 7, "#d24dff")).join("") +
    [line, ...branches].map((pl, i) => stroke(pl, i ? 1.2 : 2.8, "#fff4ff")).join("") +
    `<ellipse cx="48" cy="214" rx="30" ry="12" fill="#e9b8ff" opacity="0.75" filter="url(#b)"/>`;
  return svg(96, 228, body, blur("b", 5));
});

const cometTrail = () => svg(176, 64,
  `<path d="M176,32 C130,6 60,10 0,30 C60,48 130,56 176,32 Z" fill="url(#t)" filter="url(#b)"/><path d="M176,32 C135,18 80,20 30,31 C80,40 135,44 176,32 Z" fill="url(#c)"/>`,
  blur("b", 3.5) +
  `<linearGradient id="t"><stop offset="0" stop-color="#5a1aa8" stop-opacity="0"/><stop offset="0.55" stop-color="#9a3cf0" stop-opacity="0.75"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient>` +
  `<linearGradient id="c"><stop offset="0" stop-color="#ffcf7a" stop-opacity="0"/><stop offset="0.7" stop-color="#ffb04a" stop-opacity="0.8"/><stop offset="1" stop-color="#fff3d0"/></linearGradient>`);

// Rift Snare: a ground-trap sigil, violet web with cyan crystal nodes and a
// low-opacity centre so units stay visible. Spell radii are Euclidean in
// arena units and the board maps both axes linearly, so the boundary is a
// true circle on screen, matching the rule exactly.
const snareSigil = () => {
  const W = 256, H = 256, cx = 128, cy = 128, rx = 116, ry = 116;
  const P = (a, k) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  const spokes = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; const [x, y] = P(a, 0.97); return `<line x1="${cx}" y1="${cy}" x2="${f2(x)}" y2="${f2(y)}"/>`; }).join("");
  const webs = [0.36, 0.62, 0.86].map((k) => `<polygon points="${Array.from({ length: 8 }, (_, i) => P((i / 8) * Math.PI * 2, k).map(f2).join(",")).join(" ")}"/>`).join("");
  const gems = Array.from({ length: 8 }, (_, i) => {
    const [x, y] = P((i / 8) * Math.PI * 2 + Math.PI / 8, 1.0);
    return `<polygon points="${f2(x)},${f2(y - 13)} ${f2(x + 5.5)},${f2(y - 2)} ${f2(x)},${f2(y + 5)} ${f2(x - 5.5)},${f2(y - 2)}" fill="url(#gem)" stroke="#0d4a74" stroke-width="1.3"/><polygon points="${f2(x)},${f2(y - 13)} ${f2(x + 5.5)},${f2(y - 2)} ${f2(x)},${f2(y - 3)}" fill="#e8fdff" opacity="0.85"/>`;
  }).join("");
  return svg(W, H,
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#7a2fe0" opacity="0.16"/>` +
    `<g fill="none" stroke="#b04dff" stroke-width="7" opacity="0.5" filter="url(#b)">${spokes}${webs}<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></g>` +
    `<g fill="none" stroke="#e7a8ff" stroke-width="2.2" stroke-linejoin="round">${spokes}${webs}</g>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#5ff0ff" stroke-width="3"/>${gems}`,
    blur("b", 4) + `<linearGradient id="gem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ff7ff"/><stop offset="1" stop-color="#1ea9e0"/></linearGradient>`);
};

const snareBind = () => svg(72, 44,
  `<ellipse cx="36" cy="22" rx="30" ry="17" fill="none" stroke="#b04dff" stroke-width="7" opacity="0.55" filter="url(#b)"/>` +
  `<ellipse cx="36" cy="22" rx="30" ry="17" fill="none" stroke="#e7a8ff" stroke-width="2"/>` +
  `<ellipse cx="36" cy="22" rx="20" ry="11" fill="none" stroke="#5ff0ff" stroke-width="1.6" stroke-dasharray="5 4"/>` +
  [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.4; const x = 36 + Math.cos(a) * 30, y = 22 + Math.sin(a) * 17; return `<polygon points="${f2(x)},${f2(y - 7)} ${f2(x + 3.4)},${f2(y)} ${f2(x)},${f2(y + 3)} ${f2(x - 3.4)},${f2(y)}" fill="#7ff2ff" stroke="#0d4a74" stroke-width="1"/>`; }).join(""),
  blur("b", 3));

// Hex shield dome, white for runtime tint (Bulwark gold, Warden blue).
const shieldDome = () => {
  const hex = [];
  for (let row = -4; row <= 4; row++) for (let col = -4; col <= 4; col++) {
    const x = 64 + col * 17 + (row % 2 ? 8.5 : 0), y = 64 + row * 14.7;
    if ((x - 64) ** 2 + (y - 64) ** 2 > 54 ** 2) continue;
    hex.push(`<polygon points="${Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return `${f2(x + Math.cos(a) * 9.4)},${f2(y + Math.sin(a) * 9.4)}`; }).join(" ")}"/>`);
  }
  return svg(128, 128,
    `<circle cx="64" cy="64" r="58" fill="url(#f)"/><g fill="none" stroke="#fff" stroke-width="1.3" opacity="0.55" clip-path="url(#c)">${hex.join("")}</g>` +
    `<circle cx="64" cy="64" r="58" fill="none" stroke="#fff" stroke-width="7" opacity="0.45" filter="url(#b)"/><circle cx="64" cy="64" r="58" fill="none" stroke="#fff" stroke-width="2.4"/>` +
    `<ellipse cx="46" cy="38" rx="20" ry="10" fill="#fff" opacity="0.5" transform="rotate(-30 46 38)"/>`,
    blur("b", 4) + `<clipPath id="c"><circle cx="64" cy="64" r="56"/></clipPath><radialGradient id="f" cx="0.42" cy="0.38"><stop offset="0" stop-color="#fff" stop-opacity="0.04"/><stop offset="0.8" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0.35"/></radialGradient>`);
};

// Summon circle in board perspective: rune ring for deploys and spawns, white
// for the friendly blue / enemy red allegiance tint.
const summon = () => {
  const runes = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const x = 80 + Math.cos(a) * 58, y = 50 + Math.sin(a) * 35;
    return `<rect x="${f2(x - 3)}" y="${f2(y - 1.5)}" width="6" height="3" rx="1" transform="rotate(${f2((a * 180) / Math.PI + 90)} ${f2(x)} ${f2(y)})"/>`;
  }).join("");
  return svg(160, 100,
    `<ellipse cx="80" cy="50" rx="70" ry="43" fill="url(#f)"/>` +
    `<g fill="none" stroke="#fff" stroke-width="8" opacity="0.4" filter="url(#b)"><ellipse cx="80" cy="50" rx="70" ry="43"/></g>` +
    `<ellipse cx="80" cy="50" rx="70" ry="43" fill="none" stroke="#fff" stroke-width="2.6"/><ellipse cx="80" cy="50" rx="50" ry="31" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.8"/>` +
    `<g fill="#fff">${runes}</g>`,
    blur("b", 3.5) + `<radialGradient id="f"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/></radialGradient>`);
};

const arrow = () => svg(64, 16,
  `<rect x="6" y="6.8" width="44" height="2.4" rx="1.2" fill="#f6d8ff"/><rect x="2" y="5" width="46" height="6" rx="3" fill="#e05cff" opacity="0.5" filter="url(#b)"/>` +
  `<polygon points="62,8 48,2.5 51,8 48,13.5" fill="#ff7af0" stroke="#5a1680" stroke-width="1"/><polygon points="10,8 2,3 6,8 2,13" fill="#b04dff"/>`, blur("b", 2));

const net = () => {
  const lines = [];
  for (let i = -3; i <= 3; i++) lines.push(`<line x1="${20 + i * 5}" y1="3" x2="${20 + i * 5}" y2="37"/>`, `<line x1="3" y1="${20 + i * 5}" x2="37" y2="${20 + i * 5}"/>`);
  return svg(40, 40, `<g clip-path="url(#c)"><g stroke="#e7cf9a" stroke-width="1.8">${lines.join("")}</g></g><circle cx="20" cy="20" r="16" fill="none" stroke="#7a5a2c" stroke-width="2.6"/><circle cx="20" cy="20" r="16" fill="none" stroke="#9be86a" stroke-width="1.2" opacity="0.8"/>`,
    `<clipPath id="c"><circle cx="20" cy="20" r="16"/></clipPath>`);
};

const star5 = () => {
  const p = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const rr = i % 2 ? 6 : 14; return `${f2(16 + Math.cos(a) * rr)},${f2(16 + Math.sin(a) * rr)}`; }).join(" ");
  return svg(32, 32, `<polygon points="${p}" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>`);
};

// ---------------------------------------------------------------- pack

const TEXTURES = [
  { key: "glow", make: glow, blend: "add", note: "Soft radial glow, tinted per effect." },
  { key: "ring", make: ring, blend: "add", note: "Expanding shockwave ring, tinted." },
  { key: "ground-ring", make: groundRing, blend: "add", note: "Decorative ground ring in perspective (never a rule boundary; use ring for radii)." },
  { key: "spark", make: spark, blend: "add", note: "Four-point sparkle." },
  { key: "streak", make: streak, blend: "add", note: "Tracer and trail segment, head on the right." },
  { key: "muzzle", make: muzzle, blend: "add", note: "Muzzle flash star." },
  { key: "burst", frames: burstFrames, w: 96, h: 96, fps: 20, blend: "add", note: "Five-frame impact burst." },
  { key: "smoke", frames: smokeFrames, w: 64, h: 64, fps: 14, blend: "normal", note: "Six-frame dust puff for defeats and destruction." },
  { key: "debris", frames: debrisFrames, w: 24, h: 24, fps: 0, blend: "normal", note: "Four stone chips, one per frame." },
  { key: "bolt", frames: boltFrames, w: 96, h: 228, fps: 24, blend: "add", note: "Chaos Bolt strike, three seeded variants, ground point at the bottom centre." },
  { key: "comet-trail", make: cometTrail, blend: "add", note: "Chaos Comet flame trail, head on the right." },
  { key: "snare-sigil", make: snareSigil, blend: "normal", note: "Rift Snare ground sigil, circular to match the rule radius (r = 116 px)." },
  { key: "snare-bind", make: snareBind, blend: "normal", note: "Binding ring under a snared unit while the slow lasts." },
  { key: "shield", make: shieldDome, blend: "add", note: "Hex shield dome, tinted (Bulwark gold, Warden blue)." },
  { key: "summon", make: summon, blend: "add", note: "Deploy and spawn rune circle in board perspective, allegiance tint." },
  { key: "arrow", make: arrow, blend: "normal", note: "Violet arrow for Chaos Archer and Deadeye." },
  { key: "net", make: net, blend: "normal", note: "Gale Netter net projectile." },
  { key: "star", make: star5, blend: "add", note: "Five-point star (Warden, Rally buff), tinted." },
];

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const write = (file, buf) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); };

(async () => {
  const manifest = { schema: 1, version: "battle-vfx-v001", source: "tools/vfx/build_vfx.cjs + tools/blender/chog-units-v001/scripts/build_vfx_props.py", textures: {} };
  for (const t of TEXTURES) {
    let buf, info;
    if (t.frames) {
      const fr = t.frames();
      buf = await sheet(fr, t.w, t.h);
      info = { kind: "sheet", frameWidth: t.w, frameHeight: t.h, frames: fr.length, fps: t.fps };
    } else {
      buf = await sharp(t.make()).png({ compressionLevel: 9 }).toBuffer();
      info = { kind: "image" };
    }
    const m = await sharp(buf).metadata();
    const rel = `${t.key}.png`;
    write(path.join(OUT, rel), buf);
    manifest.textures[t.key] = { path: rel, ...info, width: m.width, height: m.height, blend: t.blend, sha256: sha(buf), note: t.note };
  }
  // Blender props: comet rock (rotation sheet) and rally horn.
  const props = [
    { key: "comet", dir: "comet", frames: 6, size: 96, fps: 16, blend: "normal", note: "Chaos Comet rock, dark violet crystal with molten orange cracks, six rotation frames." },
    { key: "horn", dir: "horn", frames: 1, size: 128, fps: 0, blend: "normal", note: "Rally Horn, gold and cream, three-quarter view." },
  ];
  for (const p of props) {
    const files = Array.from({ length: p.frames }, (_, i) => path.join(PROPS, p.dir, `${String(i).padStart(2, "0")}.png`));
    if (!files.every((f) => fs.existsSync(f))) { console.warn(`missing ${p.key} renders in ${PROPS}`); continue; }
    const frames = await Promise.all(files.map((f) => sharp(f).resize(p.size, p.size, { kernel: "lanczos3" }).png().toBuffer()));
    const buf = p.frames > 1 ? await sheet(frames, p.size, p.size) : await sharp(frames[0]).png({ compressionLevel: 9 }).toBuffer();
    const m = await sharp(buf).metadata();
    write(path.join(OUT, `${p.key}.png`), buf);
    manifest.textures[p.key] = { path: `${p.key}.png`, kind: p.frames > 1 ? "sheet" : "image", ...(p.frames > 1 ? { frameWidth: p.size, frameHeight: p.size, frames: p.frames, fps: p.fps } : {}),
      width: m.width, height: m.height, blend: p.blend, sha256: sha(buf), note: p.note };
  }
  write(path.join(OUT, "manifests/vfx.runtime.json"), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  const total = Object.values(manifest.textures).reduce((n, t) => n + t.width * t.height * 4, 0);
  console.log(Object.keys(manifest.textures).length, "textures", `${(total / 1024).toFixed(0)} KB RGBA`);
})().catch((e) => { console.error(e); process.exit(1); });
