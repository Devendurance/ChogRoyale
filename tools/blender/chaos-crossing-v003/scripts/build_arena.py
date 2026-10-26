"""Chaos Crossing v003 arena: procedural 2.5D environment, rendered as separated
camera-space layers on the 1200x1840 master canvas (10 px per logical unit).

Run headless:
  blender.exe -b --factory-startup --python build_arena.py -- <out_dir> [layer ...]

Every gameplay anchor comes from the live engine geometry (src/lib/combat.ts,
arena-v2): river y 74..86, bridges x 24..36 and 64..76, ford x 44..56, lane
towers (30|70, 40|120), cores (50, 8|152). Art uses the centered cell envelope
(+/-0.5 unit). No towers, defenders or units are baked into any layer.
"""
import json
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else os.path.join(os.path.dirname(__file__), "..", "masters", "layers"))
ONLY = set(ARGV[1:])
os.makedirs(OUT, exist_ok=True)

RIVER = (73.5, 86.5)
BRIDGES = [(23.5, 36.5), (63.5, 76.5)]
FORD = (43.5, 56.5)
TOWERS = [(30, 40), (70, 40), (30, 120), (70, 120)]
CORES = [(50, 8), (50, 152)]
GROUND_X = (-15.0, 115.0)
GROUND_Y = (-15.0, 175.0)

rng = random.Random(3003)
nrng = np.random.default_rng(3003)

sc = C.reset_scene()
C.setup_world(0.8)
sun = C.setup_sun(3.4)
cam = C.arena_camera()
if os.environ.get("LOWQ"):
    sc.render.resolution_percentage = 50
    sc.eevee.taa_render_samples = 16

colls = {k: C.collection(k) for k in (
    "terrain", "water", "ripA", "ripB", "fordOpen", "fordClose", "banks", "found", "border", "ambient", "trim", "fore",
)}

# ------------------------------------------------------------------ helpers


def value_noise(h, w, cell, seed):
    g = np.random.default_rng(seed).random((int(h / cell) + 3, int(w / cell) + 3))
    ys = np.arange(h) / cell
    xs = np.arange(w) / cell
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = ys - y0
    fx = xs - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(h, w, base, octaves, seed):
    out = np.zeros((h, w))
    amp, tot, cell = 1.0, 0.0, base
    for i in range(octaves):
        out += amp * value_noise(h, w, cell, seed + i)
        tot += amp
        amp *= 0.5
        cell = max(1.0, cell / 2)
    return out / tot


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mesh_from_prim(kind, **kw):
    o = C.prim(kind, "_proto_" + kind, **kw)
    me = o.data
    bpy.data.objects.remove(o)
    return me


def inst(name, mesh, loc, scale=(1, 1, 1), rot=(0, 0, 0), coll=None, mats=None):
    o = bpy.data.objects.new(name, mesh)
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    if mats:
        o.data = mesh
        for i, m in enumerate(mats):
            if i < len(o.material_slots):
                o.material_slots[i].link = "OBJECT"
                o.material_slots[i].material = m
    coll.objects.link(o)
    return o


def rock_mesh(seed, subdiv=2, flat=0.55, jitter=0.22):
    r = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1.0)
    o = bpy.context.active_object
    for v in o.data.vertices:
        n = v.co.normalized()
        k = 1.0 + r.uniform(-jitter, jitter)
        v.co = n * k
        v.co.z *= flat
        if v.co.z < -0.15:
            v.co.z = -0.15 + (v.co.z + 0.15) * 0.3
    for p in o.data.polygons:
        p.use_smooth = False
    me = o.data
    me.name = f"rock{seed}"
    bpy.data.objects.remove(o)
    return me


# ------------------------------------------------------------------ materials

M = {
    "dirt": C.mat("Dirt", "#d9b77a", rough=0.9),
    "lime": C.mat("Limestone", "#d6cdb8", rough=0.75),
    "lime2": C.mat("LimestoneWarm", "#c4b597", rough=0.78),
    "bank": C.mat("BankStone", "#b4b8bf", rough=0.7),
    "bank2": C.mat("BankStoneWarm", "#c9c2b2", rough=0.72),
    "bankDark": C.mat("BankStoneDark", "#8d939d", rough=0.75),
    "wood3": C.mat("WoodWarm", "#a8673a", rough=0.6, coat=0.1),
    "fern": C.mat("Fern", "#3f9a36", rough=0.8),
    "fern2": C.mat("FernLight", "#68bf3f", rough=0.8),
    "flag": C.mat("Flagstone", "#d8cdb2", rough=0.8),
    "flag2": C.mat("FlagstoneCool", "#bdbab0", rough=0.8),
    "moss": C.mat("Moss", "#5fae3a", rough=0.85),
    "stone": C.mat("Stone", "#9aa0a8", rough=0.7),
    "stoneDark": C.mat("StoneDark", "#6f7682", rough=0.75),
    "wood": C.mat("Wood", "#b0703a", rough=0.6, coat=0.1),
    "wood2": C.mat("WoodLight", "#c98a4b", rough=0.6, coat=0.1),
    "woodDark": C.mat("WoodDark", "#7a4724", rough=0.65),
    "gold": C.mat("Gold", "#f2b632", rough=0.28, metal=0.85),
    "gem": C.mat("GemCyan", "#35e0ff", rough=0.12, emit="#2fd6ff", emit_strength=1.6, spec=0.9),
    "crystal": C.mat("Crystal", "#56d8ff", rough=0.08, emit="#3cc9ff", emit_strength=0.9, spec=1.0, coat=0.6),
    "crystalDeep": C.mat("CrystalDeep", "#3a8dff", rough=0.1, emit="#2f7dff", emit_strength=0.6, spec=1.0),
    "pine": C.mat("Pine", "#2f8a3e", rough=0.8),
    "pine2": C.mat("PineLight", "#3fa34b", rough=0.8),
    "bush": C.mat("Bush", "#46a83a", rough=0.85),
    "bush2": C.mat("BushLight", "#6cc443", rough=0.85),
    "trunk": C.mat("Trunk", "#7b5032", rough=0.8),
    "flame": C.mat("Flame", "#ffb347", rough=0.5, emit="#ff9a2e", emit_strength=6.0),
    "petalW": C.mat("PetalWhite", "#fffaf0", rough=0.6),
    "petalY": C.mat("PetalYellow", "#ffd84a", rough=0.6),
    "petalP": C.mat("PetalPink", "#ff8fc8", rough=0.6),
    "petalB": C.mat("PetalBlue", "#7fc8ff", rough=0.6),
    "tuft": C.mat("Tuft", "#79c63f", rough=0.85),
    "tuft2": C.mat("TuftDeep", "#5aae34", rough=0.85),
    "red": C.mat("TeamRed", "#e5333c", rough=0.55, sss=0.05),
    "redGem": C.mat("RedGem", "#ff3b4a", rough=0.12, emit="#ff2438", emit_strength=1.4, spec=0.9),
    "blue": C.mat("TeamBlue", "#2f7cf0", rough=0.55, sss=0.05),
    "blueGem": C.mat("BlueGem", "#3fa0ff", rough=0.12, emit="#2a8cff", emit_strength=1.4, spec=0.9),
    "rift": C.mat("Rift", "#d15bff", rough=0.1, emit="#c04bff", emit_strength=3.0, spec=1.0),
    "riftCyan": C.mat("RiftCyan", "#56f0ff", rough=0.1, emit="#3fe6ff", emit_strength=2.6, spec=1.0),
}

# ------------------------------------------------------------------ ground

TEX = 10  # px per unit
TW = int((GROUND_X[1] - GROUND_X[0]) * TEX)
TH = int((GROUND_Y[1] - GROUND_Y[0]) * TEX)
PX = GROUND_X[0] + (np.arange(TW) + 0.5) / TEX
PY = GROUND_Y[1] - (np.arange(TH) + 0.5) / TEX  # image row 0 = north
GX, GY = np.meshgrid(PX, PY)

lanes = []
for x in (30, 70):
    side = -1 if x < 50 else 1
    lanes += [
        (x, 86.5, x, 120),
        (x, 120, 50 + side * 7, 150),
        (x, 73.5, x, 40),
        (x, 40, 50 + side * 7, 10),
    ]
pd = np.full(GX.shape, 1e9)
for a in lanes:
    pd = np.minimum(pd, seg_dist(GX, GY, *a))
edge_n = fbm(TH, TW, 22, 3, 11)
path = 1 - smooth(1.5, 3.0, pd + (edge_n - 0.5) * 2.0)
for (x, y) in TOWERS:
    path = np.maximum(path, 1 - smooth(4.6, 6.2, np.hypot(GX - x, GY - y) + (edge_n - 0.5) * 1.5))
for (x, y) in CORES:
    path = np.maximum(path, 1 - smooth(6.0, 7.8, np.hypot(GX - x, GY - y) + (edge_n - 0.5) * 1.5))

# Grass: broad sunlit glades and soft cloud-shade patches, a gentle mowing
# checker, then clumped tufts with lit tops so the turf has a clear hierarchy.
big = fbm(TH, TW, 120, 3, 21)
mid = fbm(TH, TW, 26, 3, 31)
fine = fbm(TH, TW, 3, 2, 41)
g_sun = np.array([0.64, 0.85, 0.31])
g_mid = np.array([0.45, 0.75, 0.25])
g_deep = np.array([0.35, 0.64, 0.22])
t = smooth(0.26, 0.74, big * 0.75 + mid * 0.25)[..., None]
grass = g_deep + (g_mid - g_deep) * np.clip(t * 2, 0, 1)
grass = grass + (g_sun - grass) * np.clip(t * 2 - 1, 0, 1)
checker = ((np.floor(GX / 8) + np.floor(GY / 8)) % 2) * 2 - 1
grass *= (1 + checker * 0.03)[..., None]
clump_n = fbm(TH, TW, 1.7, 2, 51)
clump = smooth(0.6, 0.7, clump_n)
# Upper-left neighbour of each clump pixel: light comes from the upper left.
ul = smooth(0.6, 0.7, np.roll(np.roll(clump_n, 2, axis=0), 2, axis=1))
rim_lit = np.clip(clump - ul, 0, 1)
rim_shade = np.clip(ul - clump, 0, 1)
grass *= (1 - clump * 0.12 - rim_shade * 0.14)[..., None]
grass = grass + (np.array([0.8, 0.94, 0.44]) - grass) * (rim_lit * 0.4)[..., None]
grass *= (0.95 + fine * 0.1)[..., None]

# Paths: warm worn earth with a darker trodden border and broken flagstones.
dirt_a = np.array([0.88, 0.74, 0.5])
dirt_b = np.array([0.79, 0.63, 0.41])
dirt = dirt_a + (dirt_b - dirt_a) * (fine * 0.6 + mid * 0.4)[..., None]
row = np.floor(GY / 1.7)
u = GX / 2.3 + (row % 2) * 0.5
tile_id = np.floor(u) * 131 + row * 71
h = np.sin(tile_id * 12.9898) * 43758.5453
h = h - np.floor(h)
fu = u - np.floor(u)
fv = GY / 1.7 - row
gap = np.minimum(np.minimum(fu, 1 - fu) * 2.3, np.minimum(fv, 1 - fv) * 1.7)
tile = smooth(0.1, 0.2, gap) * (h < 0.62) * smooth(0.55, 0.8, path)
stone_c = np.array([0.86, 0.8, 0.66]) + (h[..., None] - 0.3) * np.array([0.12, 0.1, 0.08])
dirt = dirt * (1 - tile[..., None]) + stone_c * tile[..., None]
seam = (tile > 0) * (1 - smooth(0.06, 0.16, gap))
dirt *= (1 - seam * 0.3)[..., None]
border = np.clip(path * (1 - path) * 4, 0, 1)
pmask = (path * 0.85)[..., None]
col = grass * (1 - pmask) + dirt * pmask
col *= (1 - border * 0.14)[..., None]

river_d = np.minimum(np.abs(GY - RIVER[0]), np.abs(GY - RIVER[1]))
in_river = (GY > RIVER[0]) & (GY < RIVER[1])
col[in_river] = np.array([0.35, 0.55, 0.45])
# Damp, darker turf beside the banks.
bankband = (1 - smooth(0.0, 3.0, river_d))[..., None] * (~in_river)[..., None]
col = col * (1 - bankband * 0.16)

tmp = bpy.data.images.new("GroundTexBuild", TW, TH, alpha=True)
rgba = np.concatenate([np.clip(col, 0, 1), np.ones((TH, TW, 1))], axis=2)
# Blender stores rows bottom-up. Values are sRGB-encoded for a byte image.
tmp.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
TEX_PATH = os.path.join(OUT, "..", "sources", "ground-albedo.png")
os.makedirs(os.path.dirname(TEX_PATH), exist_ok=True)
tmp.filepath_raw = TEX_PATH
tmp.file_format = "PNG"
tmp.save()
img = bpy.data.images.load(TEX_PATH)
img.colorspace_settings.name = "sRGB"

gm = bpy.data.materials.new("Ground")
gm.use_nodes = True
nt = gm.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.88
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
tex.interpolation = "Linear"
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 260.0
noise.inputs["Detail"].default_value = 4.0
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.35
nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

nx, ny = 131, 191
verts, uvs, faces = [], [], []
for j in range(ny):
    y = GROUND_Y[0] + j * (GROUND_Y[1] - GROUND_Y[0]) / (ny - 1)
    for i in range(nx):
        x = GROUND_X[0] + i * (GROUND_X[1] - GROUND_X[0]) / (nx - 1)
        z = 0.0
        if RIVER[0] - 0.2 < y < RIVER[1] + 0.2:
            z = -1.4
        verts.append((x, C.wy(y), z))
        uvs.append(((x - GROUND_X[0]) / (GROUND_X[1] - GROUND_X[0]), (y - GROUND_Y[0]) / (GROUND_Y[1] - GROUND_Y[0])))
for j in range(ny - 1):
    for i in range(nx - 1):
        a = j * nx + i
        faces.append((a, a + 1, a + nx + 1, a + nx))
ground = C.new_mesh_obj("Ground", verts, faces, gm, colls["terrain"])
uvl = ground.data.uv_layers.new(name="UV")
for poly in ground.data.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = uvs[ground.data.loops[li].vertex_index]

# ------------------------------------------------------------------ water

wm = bpy.data.materials.new("Water")
wm.use_nodes = True
nt = wm.node_tree
b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Roughness"].default_value = 0.08
b.inputs["Specular IOR Level"].default_value = 0.8
b.inputs["Coat Weight"].default_value = 0.4
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(tc.outputs["Object"], sep.inputs[0])
# Object-space Y spans the river depth; centre deep, edges shallow.
mapr = nt.nodes.new("ShaderNodeMapRange")
half = (RIVER[1] - RIVER[0]) / 2 / C.COS
mapr.inputs["From Min"].default_value = -half
mapr.inputs["From Max"].default_value = half
nt.links.new(sep.outputs["Y"], mapr.inputs["Value"])
mathn = nt.nodes.new("ShaderNodeMath")
mathn.operation = "PINGPONG"
mathn.inputs[1].default_value = 0.5
nt.links.new(mapr.outputs["Result"], mathn.inputs[0])
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = C.hexc("#a6f6ee")
ramp.color_ramp.elements[1].position = 0.5
ramp.color_ramp.elements[1].color = C.hexc("#139fe0")
el = ramp.color_ramp.elements.new(0.12)
el.color = C.hexc("#55e0ea")
el = ramp.color_ramp.elements.new(0.3)
el.color = C.hexc("#22c0ea")
nt.links.new(mathn.outputs[0], ramp.inputs[0])
wn = nt.nodes.new("ShaderNodeTexNoise")
wn.inputs["Scale"].default_value = 0.35
wn.inputs["Detail"].default_value = 3.0
mix = nt.nodes.new("ShaderNodeMix")
mix.data_type = "RGBA"
mix.blend_type = "SOFT_LIGHT"
mix.inputs["Factor"].default_value = 0.25
nt.links.new(ramp.outputs[0], mix.inputs["A"])
nt.links.new(wn.outputs["Color"], mix.inputs["B"])
# Sun glints: thin distorted wave bands, kept sparse so the river stays calm.
wv = nt.nodes.new("ShaderNodeTexWave")
wv.wave_type = "BANDS"
wv.bands_direction = "Y"
wmap = nt.nodes.new("ShaderNodeMapping")
wmap.inputs["Scale"].default_value = (0.22, 1.0, 1.0)
nt.links.new(tc.outputs["Object"], wmap.inputs[0])
nt.links.new(wmap.outputs[0], wv.inputs["Vector"])
wv.inputs["Scale"].default_value = 0.2
wv.inputs["Distortion"].default_value = 11.0
wv.inputs["Detail"].default_value = 3.0
wr = nt.nodes.new("ShaderNodeValToRGB")
wr.color_ramp.elements[0].position = 0.955
wr.color_ramp.elements[0].color = (0, 0, 0, 1)
wr.color_ramp.elements[1].position = 0.99
wr.color_ramp.elements[1].color = (1, 1, 1, 1)
nt.links.new(wv.outputs["Fac"], wr.inputs[0])
# Glints only in drifting patches, so the surface reads as calm water, not stripes.
gm_n = nt.nodes.new("ShaderNodeTexNoise")
gm_n.inputs["Scale"].default_value = 0.12
nt.links.new(tc.outputs["Object"], gm_n.inputs["Vector"])
gm_r = nt.nodes.new("ShaderNodeMapRange")
gm_r.inputs["From Min"].default_value = 0.5
gm_r.inputs["From Max"].default_value = 0.62
nt.links.new(gm_n.outputs["Fac"], gm_r.inputs["Value"])
gm_m = nt.nodes.new("ShaderNodeMath")
gm_m.operation = "MULTIPLY"
nt.links.new(wr.outputs["Color"], gm_m.inputs[0])
nt.links.new(gm_r.outputs["Result"], gm_m.inputs[1])
# Bright foam rim right against both banks.
fr = nt.nodes.new("ShaderNodeMapRange")
fr.inputs["From Min"].default_value = 0.035
fr.inputs["From Max"].default_value = 0.0
fn = nt.nodes.new("ShaderNodeTexNoise")
fn.inputs["Scale"].default_value = 0.9
nt.links.new(tc.outputs["Object"], fn.inputs["Vector"])
fadd = nt.nodes.new("ShaderNodeMath")
fadd.operation = "MULTIPLY_ADD"
fadd.inputs[1].default_value = 0.035
nt.links.new(fn.outputs["Fac"], fadd.inputs[0])
nt.links.new(mathn.outputs[0], fadd.inputs[2])
nt.links.new(fadd.outputs[0], fr.inputs["Value"])
fmax = nt.nodes.new("ShaderNodeMath")
fmax.operation = "MAXIMUM"
nt.links.new(fr.outputs["Result"], fmax.inputs[0])
nt.links.new(gm_m.outputs[0], fmax.inputs[1])
fmix = nt.nodes.new("ShaderNodeMix")
fmix.data_type = "RGBA"
nt.links.new(fmax.outputs[0], fmix.inputs["Factor"])
nt.links.new(mix.outputs["Result"], fmix.inputs["A"])
fmix.inputs["B"].default_value = (0.95, 1.0, 1.0, 1.0)
nt.links.new(fmix.outputs["Result"], b.inputs["Base Color"])
b.inputs["Emission Color"].default_value = C.hexc("#1fc6d9")
b.inputs["Emission Strength"].default_value = 0.1
wb = nt.nodes.new("ShaderNodeTexNoise")
wb.inputs["Scale"].default_value = 1.4
wb2 = nt.nodes.new("ShaderNodeBump")
wb2.inputs["Strength"].default_value = 0.25
nt.links.new(wb.outputs["Fac"], wb2.inputs["Height"])
nt.links.new(wb2.outputs["Normal"], b.inputs["Normal"])

wy0, wy1 = C.wy(RIVER[0]), C.wy(RIVER[1])
water = C.new_mesh_obj(
    "Water",
    [(-15, wy0, -0.45), (115, wy0, -0.45), (115, wy1, -0.45), (-15, wy1, -0.45)],
    [(0, 1, 2, 3)],
    wm,
    colls["water"],
)
water.location = (0, 0, 0)
# Object-space origin at the river centre so the depth ramp is symmetric.
for v in water.data.vertices:
    v.co.y -= (wy0 + wy1) / 2
water.location.y = (wy0 + wy1) / 2


def ripple_material(name, w):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.3, 0.62, 1)
    nt.links.new(tc.outputs["Object"], mp.inputs[0])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.voronoi_dimensions = "4D"
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 1.0
    vor.inputs["W"].default_value = w
    nt.links.new(mp.outputs[0], vor.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1, 1, 1, 0.55)
    ramp.color_ramp.elements[1].position = 0.06
    ramp.color_ramp.elements[1].color = (1, 1, 1, 0.0)
    nt.links.new(vor.outputs["Distance"], ramp.inputs[0])
    # Edge foam: stronger near both banks.
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    ab = nt.nodes.new("ShaderNodeMath")
    ab.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["Y"], ab.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = half * 0.55
    mr.inputs["From Max"].default_value = half
    mr.inputs["To Min"].default_value = 0.55
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(ab.outputs[0], mr.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(ramp.outputs["Alpha"], mul.inputs[0])
    nt.links.new(mr.outputs["Result"], mul.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (0.92, 1.0, 1.0, 1)
    em.inputs[1].default_value = 1.6
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mul.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        m.blend_method = "BLEND"
    return m


for key, w in (("ripA", 0.0), ("ripB", 0.37)):
    r = C.new_mesh_obj(
        "Ripples_" + key,
        [(-15, wy0 - (wy0 + wy1) / 2, 0), (115, wy0 - (wy0 + wy1) / 2, 0), (115, wy1 - (wy0 + wy1) / 2, 0), (-15, wy1 - (wy0 + wy1) / 2, 0)],
        [(0, 1, 2, 3)],
        ripple_material("Ripple_" + key, w),
        colls[key],
    )
    r.location = (0, (wy0 + wy1) / 2, -0.4)

# ------------------------------------------------------------------ banks

rock_meshes = [rock_mesh(100 + i) for i in range(8)]
for me in rock_meshes:
    me.materials.append(M["lime"])


def place_rock(coll, x, y, s, z=0.0, mat=None, flat=1.0, name="Rock"):
    me = rng.choice(rock_meshes)
    o = inst(name, me, C.wpos(x, y, z), (s * rng.uniform(0.9, 1.25), s * rng.uniform(0.8, 1.1), s * flat), (0, 0, rng.uniform(0, 6.28)), coll)
    if mat:
        o.material_slots[0].link = "OBJECT"
        o.material_slots[0].material = mat
    return o


def in_span(x, spans, pad=0.0):
    return any(a - pad <= x <= b + pad for a, b in spans)


FERNS = []
for edge, sgn in ((RIVER[0], -1), (RIVER[1], 1)):
    x = -2.0
    while x < 102:
        if not in_span(x, BRIDGES, 0.6):
            s = rng.uniform(1.0, 1.55)
            place_rock(colls["banks"], x, edge + sgn * rng.uniform(-0.15, 0.35), s, z=-0.35, mat=rng.choice([M["bank"], M["bank"], M["bank2"], M["bankDark"]]))
            if rng.random() < 0.45:
                place_rock(colls["banks"], x + rng.uniform(-0.6, 0.6), edge - sgn * rng.uniform(0.3, 0.9), s * 0.55, z=-0.5, mat=M["bankDark"])
            if rng.random() < 0.3:
                o = place_rock(colls["banks"], x + rng.uniform(-0.5, 0.5), edge + sgn * rng.uniform(0.9, 1.4), 0.55, z=0.0, mat=M["moss"], flat=0.6)
            elif rng.random() < 0.28:
                FERNS.append((x + rng.uniform(-0.4, 0.4), edge + sgn * rng.uniform(1.0, 1.5)))
        x += rng.uniform(1.3, 1.9)

# ------------------------------------------------------------------ bridges

plank = mesh_from_prim("cube", size=1.0)
post = mesh_from_prim("cube", size=1.0)
gem_me = mesh_from_prim("ico", subdivisions=1, radius=1.0)
cap_me = mesh_from_prim("cyl", vertices=8, radius=1.0, depth=1.0)
flame_me = mesh_from_prim("ico", subdivisions=2, radius=1.0)


def box(name, coll, cx, cy, cz, sx, sy, sz, material, bev=0.06):
    o = bpy.data.objects.new(name, plank.copy())
    o.data.materials.clear()
    o.data.materials.append(material)
    o.location = (cx, cy, cz)
    o.scale = (sx, sy, sz)
    coll.objects.link(o)
    if bev:
        C.bevel(o, bev, 2)
    return o


def torch(coll, x, y, h=1.9):
    box("TorchPost", coll, x, C.wy(y), h / 2, 0.42, 0.42, h, M["stoneDark"], 0.05)
    bowl = inst("TorchBowl", cap_me, C.wpos(x, y, h + 0.12), (0.42, 0.42, 0.22), coll=coll)
    bowl.data = cap_me.copy()
    bowl.data.materials.append(M["gold"])
    fl = inst("Flame", flame_me, C.wpos(x, y, h + 0.5), (0.3, 0.3, 0.48), coll=coll)
    fl.data = flame_me.copy()
    fl.data.materials.append(M["flame"])
    fl.visible_shadow = False
    lamp = bpy.data.lights.new("TorchLight", "POINT")
    lamp.energy = 60
    lamp.color = (1.0, 0.62, 0.3)
    lamp.shadow_soft_size = 0.4
    lo = bpy.data.objects.new("TorchLight", lamp)
    lo.location = C.wpos(x, y, h + 0.9)
    coll.objects.link(lo)


for (x0, x1) in BRIDGES:
    cx = (x0 + x1) / 2
    w = x1 - x0
    coll = colls["banks"]
    y = RIVER[0] - 0.9
    i = 0
    while y < RIVER[1] + 0.9:
        sh = rng.uniform(-0.04, 0.04)
        box("Plank", coll, cx + rng.uniform(-0.12, 0.12), C.wy(y + 0.42), 0.2 + sh, w - 0.9 + rng.uniform(-0.25, 0.1), 0.76 / C.COS, 0.3, rng.choice((M["wood"], M["wood2"], M["wood3"])), 0.09)
        y += 0.9
        i += 1
    for xe in (x0 + 0.35, x1 - 0.35):
        box("Beam", coll, xe, C.wy(80), 0.2, 0.55, (RIVER[1] - RIVER[0] + 2.4) / C.COS, 0.42, M["woodDark"], 0.06)
        box("Rail", coll, xe, C.wy(80), 0.95, 0.32, (RIVER[1] - RIVER[0] - 0.6) / C.COS, 0.28, M["wood"], 0.06)
        for yy in (RIVER[0] + 1.6, 80.0, RIVER[1] - 1.6):
            box("Baluster", coll, xe, C.wy(yy), 0.6, 0.26, 0.26, 0.8, M["woodDark"], 0.03)
        for ye in (RIVER[0] - 0.7, RIVER[1] + 0.7):
            box("PostBase", coll, xe, C.wy(ye), 0.25, 1.25, 1.25 / C.COS * 0.85, 0.5, M["bankDark"], 0.12)
            box("Post", coll, xe, C.wy(ye), 1.05, 1.0, 1.0 / C.COS * 0.85, 1.7, M["stone"], 0.16)
            cap = box("PostCap", coll, xe, C.wy(ye), 1.98, 1.18, 1.18 / C.COS * 0.85, 0.24, M["gold"], 0.07)
            gface = bpy.data.objects.new("PostFaceGem", gem_me.copy())
            gface.data.materials.append(M["gem"])
            gface.location = C.wpos(xe, ye - 0.55, 1.15)
            gface.scale = (0.28, 0.1, 0.36)
            coll.objects.link(gface)
            g = bpy.data.objects.new("PostGem", gem_me.copy())
            g.data.materials.append(M["gem"])
            g.location = C.wpos(xe, ye, 2.42)
            g.scale = (0.32, 0.32, 0.44)
            coll.objects.link(g)
    # Stone abutments carry the deck onto each bank.
    for ye in (RIVER[0] - 0.9, RIVER[1] + 0.9):
        box("Abutment", coll, cx, C.wy(ye), 0.02, w + 0.4, 1.4 / C.COS, 0.3, M["lime2"], 0.1)
    for ye, sgn in ((RIVER[0] - 2.2, -1), (RIVER[1] + 2.2, 1)):
        torch(coll, x0 - 0.9, ye)
        torch(coll, x1 + 0.9, ye)

# ------------------------------------------------------------------ ford

hexm = mesh_from_prim("cyl", vertices=6, radius=1.0, depth=1.0)
spark_me = mesh_from_prim("ico", subdivisions=1, radius=1.0)
y = RIVER[0] + 0.8
k = 0
while y < RIVER[1] - 0.4:
    for xx in (47.0, 50.0, 53.0) if k % 2 == 0 else (48.5, 51.5):
        o = bpy.data.objects.new("FordStone", hexm.copy())
        o.data.materials.append(M["rift"] if (k + int(xx)) % 3 else M["riftCyan"])
        C.bevel(o, 0.12, 2)
        o.location = C.wpos(xx + rng.uniform(-0.3, 0.3), y, -0.3)
        o.scale = (1.25, 1.25 / C.COS * 0.85, 0.35)
        o.rotation_euler = (0, 0, rng.uniform(0, 1))
        colls["fordOpen"].objects.link(o)
    y += 2.1
    k += 1
for ye in (RIVER[0] + 0.3, RIVER[1] - 0.3):
    for xx in (45.0, 47.5, 50.0, 52.5, 55.0):
        o = bpy.data.objects.new("FordSpark", spark_me.copy())
        o.data.materials.append(M["rift"])
        o.location = C.wpos(xx + rng.uniform(-0.6, 0.6), ye + rng.uniform(-0.3, 0.3), -0.2 + rng.uniform(0, 0.4))
        o.scale = (0.22, 0.22, 0.34)
        colls["fordClose"].objects.link(o)

# ------------------------------------------------------------------ foundations

paver_me = mesh_from_prim("cyl", vertices=8, radius=1.0, depth=1.0)


def plaza(x, y, r):
    o = bpy.data.objects.new("Plaza", paver_me.copy())
    o.data.materials.append(M["stone"])
    C.bevel(o, 0.18, 3)
    o.location = C.wpos(x, y, 0.05)
    o.scale = (r, r / C.COS, 0.12)
    o.rotation_euler = (0, 0, math.radians(22.5))
    colls["found"].objects.link(o)
    inner = bpy.data.objects.new("PlazaInner", paver_me.copy())
    inner.data.materials.append(M["lime2"])
    C.bevel(inner, 0.12, 2)
    inner.location = C.wpos(x, y, 0.12)
    inner.scale = (r * 0.82, r * 0.82 / C.COS, 0.1)
    inner.rotation_euler = (0, 0, math.radians(22.5))
    colls["found"].objects.link(inner)
    for i in range(10):
        a = i / 10 * math.tau + 0.3
        rr = r + rng.uniform(0.1, 0.7)
        place_rock(colls["found"], x + math.cos(a) * rr, y + math.sin(a) * rr, rng.uniform(0.28, 0.5), z=0.0, mat=M["lime"], flat=0.7)


for (x, y) in TOWERS:
    plaza(x, y, 4.6)
for (x, y) in CORES:
    plaza(x, y, 5.8)

# ------------------------------------------------------------------ border scenery

cone_me = mesh_from_prim("cone", vertices=10, radius1=1.0, radius2=0.0, depth=1.0)
trunk_me = mesh_from_prim("cyl", vertices=8, radius=1.0, depth=1.0)
blob_me = mesh_from_prim("ico", subdivisions=2, radius=1.0)
crys_me = mesh_from_prim("cyl", vertices=6, radius=1.0, depth=1.0)
tip_me = mesh_from_prim("cone", vertices=6, radius1=1.0, radius2=0.0, depth=1.0)


def obj(name, me, material, loc, scale, rot=(0, 0, 0), coll=None, bev=None):
    o = bpy.data.objects.new(name, me.copy())
    o.data.materials.append(material)
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    (coll or colls["border"]).objects.link(o)
    if bev:
        C.bevel(o, bev, 2)
    return o


def pine(x, y, h, coll):
    obj("Trunk", trunk_me, M["trunk"], C.wpos(x, y, h * 0.12), (0.22 * h / 4, 0.22 * h / 4, h * 0.24), coll=coll)
    for i, (z, r) in enumerate(((0.28, 0.42), (0.52, 0.33), (0.74, 0.23))):
        obj("PineTier", cone_me, M["pine"] if i % 2 == 0 else M["pine2"], C.wpos(x, y, h * z), (h * r, h * r, h * 0.36), (0, 0, rng.uniform(0, 1)), coll)


def bush(x, y, s, coll):
    for i in range(rng.randint(3, 5)):
        obj("Bush", blob_me, M["bush"] if i % 2 else M["bush2"],
            C.wpos(x + rng.uniform(-0.6, 0.6) * s, y + rng.uniform(-0.5, 0.5) * s, s * rng.uniform(0.35, 0.6)),
            (s * rng.uniform(0.55, 0.8),) * 2 + (s * rng.uniform(0.5, 0.7),), coll=coll)


def crystal(x, y, s, coll):
    for i in range(rng.randint(3, 5)):
        h = s * rng.uniform(1.2, 2.6)
        r = s * rng.uniform(0.22, 0.38)
        tilt = (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), rng.uniform(0, 1))
        ox, oy = x + rng.uniform(-0.5, 0.5) * s, y + rng.uniform(-0.4, 0.4) * s
        m = M["crystal"] if i % 3 else M["crystalDeep"]
        base = obj("Crystal", crys_me, m, C.wpos(ox, oy, h / 2), (r, r, h), tilt, coll)
        tip = obj("CrystalTip", tip_me, m, C.wpos(ox, oy, h + r * 0.7), (r, r, r * 1.6), tilt, coll)
        tip.parent = None
    place_rock(coll, x, y, s * 0.6, mat=M["stone"], flat=0.6)


def edge_rocks(x, y, s, coll):
    place_rock(coll, x, y, s, mat=M["stone"], flat=0.8)
    if rng.random() < 0.6:
        place_rock(coll, x + rng.uniform(-0.8, 0.8), y + rng.uniform(-0.8, 0.8), s * 0.5, mat=M["moss"], flat=0.6)


border = colls["border"]
for xe, side in ((1.2, -1), (98.8, 1)):
    y = 1.5
    while y < 159:
        if RIVER[0] - 2.5 < y < RIVER[1] + 2.5:
            y += 1.0
            continue
        roll = rng.random()
        if roll < 0.28:
            crystal(xe + side * rng.uniform(0, 0.8), y, rng.uniform(0.9, 1.3), border)
        elif roll < 0.62:
            bush(xe + side * rng.uniform(0, 0.8), y, rng.uniform(1.0, 1.5), border)
        elif roll < 0.82:
            edge_rocks(xe + side * rng.uniform(0, 0.8), y, rng.uniform(0.9, 1.4), border)
        else:
            pine(xe + side * 0.8, y, rng.uniform(4.0, 5.5), border)
        y += rng.uniform(2.2, 3.4)
# Crystal clusters marking each river mouth.
for xe in (2.0, 98.0):
    for ye in (RIVER[0] - 1.8, RIVER[1] + 1.8):
        crystal(xe, ye, 1.4, border)
# Corner groves beside the cores.
for (cx, cy) in ((6, 3), (94, 3), (6, 157), (94, 157), (14, 2), (86, 2), (14, 158), (86, 158)):
    bush(cx, cy, 1.4, border)
    edge_rocks(cx + 2.2, cy + rng.uniform(-0.5, 0.5), 0.8, border)

# ------------------------------------------------------------------ ambient scatter

petal_me = mesh_from_prim("ico", subdivisions=1, radius=1.0)
blade_me = mesh_from_prim("cone", vertices=4, radius1=1.0, radius2=0.0, depth=1.0)
amb = colls["ambient"]


def blocked(x, y, pad=0.0):
    if RIVER[0] - 2.0 - pad < y < RIVER[1] + 2.0 + pad:
        return True
    for (tx, ty) in TOWERS:
        if math.hypot(x - tx, y - ty) < 6.0 + pad:
            return True
    for (tx, ty) in CORES:
        if math.hypot(x - tx, y - ty) < 7.5 + pad:
            return True
    for a in lanes:
        d = float(seg_dist(np.array([x]), np.array([y]), *a)[0])
        if d < 3.0 + pad:
            return True
    return x < 2.5 or x > 97.5


def daisy(x, y, pm, s=1.0):
    for k in range(5):
        a = k / 5 * math.tau + rng.uniform(0, 0.4)
        obj("Petal", petal_me, pm, C.wpos(x + math.cos(a) * 0.2 * s, y + math.sin(a) * 0.2 * s / C.COS, 0.16), (0.17 * s, 0.17 * s, 0.07), (0, 0, a), amb)
    obj("PetalCore", petal_me, M["petalY"], C.wpos(x, y, 0.24), (0.12 * s, 0.12 * s, 0.07), coll=amb)


def tuft(x, y, s=1.0):
    for k in range(rng.randint(6, 8)):
        a = k / 7 * math.tau + rng.uniform(-0.3, 0.3)
        lean = rng.uniform(0.25, 0.5)
        obj("Blade", blade_me, M["tuft"] if k % 2 else M["tuft2"], C.wpos(x + math.cos(a) * 0.18 * s, y + math.sin(a) * 0.15 * s, 0.35 * s),
            (0.2 * s, 0.09 * s, rng.uniform(0.7, 1.05) * s), (math.sin(a) * -lean, math.cos(a) * lean, a), amb)


# Artist-directed clusters: flowers and tufts gather in drifts, weighted toward
# the lush edges, leaving open turf where troops fight.
placed = 0
clusters = 0
while clusters < 72:
    cx = rng.uniform(3, 97) if rng.random() < 0.55 else rng.choice((rng.uniform(3, 18), rng.uniform(82, 97)))
    cy = rng.uniform(2, 158)
    if blocked(cx, cy, 0.5):
        continue
    clusters += 1
    flavour = rng.random()
    pm = rng.choice([M["petalW"], M["petalW"], M["petalW"], M["petalY"], M["petalP"], M["petalB"]])
    for _ in range(rng.randint(4, 8)):
        x, y = cx + rng.gauss(0, 1.3), cy + rng.gauss(0, 1.1)
        if blocked(x, y):
            continue
        roll = rng.random()
        if roll < (0.6 if flavour < 0.5 else 0.25):
            daisy(x, y, pm, rng.uniform(0.9, 1.2))
        elif roll < 0.92:
            tuft(x, y, rng.uniform(0.85, 1.25))
        else:
            place_rock(amb, x, y, rng.uniform(0.25, 0.42), mat=M["stone"], flat=0.6)
        placed += 1
# Lone tufts break up the open turf without cluttering it.
lone = 0
while lone < 90:
    x, y = rng.uniform(3, 97), rng.uniform(2, 158)
    if blocked(x, y):
        continue
    tuft(x, y, rng.uniform(0.7, 1.0))
    lone += 1
# Stepping-stone clusters beside the lanes, flat so they never read as cover.
flag_me = mesh_from_prim("cyl", vertices=7, radius=1.0, depth=1.0)
stones = 0
while stones < 18:
    lx = rng.choice((30, 70))
    x = lx + rng.choice((-1, 1)) * rng.uniform(4.2, 6.5)
    y = rng.uniform(14, 146)
    if RIVER[0] - 4 < y < RIVER[1] + 4 or any(math.hypot(x - tx, y - ty) < 8 for (tx, ty) in TOWERS + CORES):
        continue
    stones += 1
    for k in range(rng.randint(3, 4)):
        o = obj("Flagstone", flag_me, rng.choice((M["flag"], M["flag2"])), C.wpos(x + rng.uniform(-1.1, 1.1), y + rng.uniform(-1.0, 1.0), 0.04),
                (rng.uniform(0.6, 0.85), rng.uniform(0.5, 0.75) / C.COS, 0.1), (0, 0, rng.uniform(0, 1)), amb, bev=0.08)
# Ferns tucked between the bank stones.
for (x, y) in FERNS:
    tuft(x, y, 1.5)
    for k in range(2):
        obj("Fern", blob_me, M["fern"] if k else M["fern2"], C.wpos(x + rng.uniform(-0.4, 0.4), y + rng.uniform(-0.3, 0.3), 0.3),
            (0.6, 0.6, 0.38), coll=colls["banks"])

# ------------------------------------------------------------------ team trim (player-relative, authored)

pole_me = mesh_from_prim("cyl", vertices=8, radius=1.0, depth=1.0)
cloth_me = mesh_from_prim("cube", size=1.0)
trim = colls["trim"]


def banner(x, y, team):
    cloth, gem = (M["red"], M["redGem"]) if team == "red" else (M["blue"], M["blueGem"])
    obj("BannerPole", pole_me, M["woodDark"], C.wpos(x, y, 2.3), (0.12, 0.12, 4.6), coll=trim)
    obj("BannerFinial", gem_me, M["gold"], C.wpos(x, y, 4.75), (0.24, 0.24, 0.3), coll=trim)
    obj("BannerBar", pole_me, M["gold"], C.wpos(x, y - 0.0, 4.25), (0.08, 0.08, 1.7), (0, math.pi / 2, 0), trim)
    c = obj("Banner", cloth_me, cloth, C.wpos(x, y - 0.18, 3.0), (1.4, 0.08, 2.4), coll=trim, bev=0.04)
    tipm = obj("BannerTip", tip_me, cloth, C.wpos(x, y - 0.18, 1.55), (0.7, 0.08, 0.7), (math.pi, 0, math.pi / 6), trim)
    obj("BannerGem", gem_me, gem, C.wpos(x, y - 0.32, 3.1), (0.32, 0.12, 0.42), coll=trim)
    obj("BannerTrim", cloth_me, M["gold"], C.wpos(x, y - 0.2, 4.15), (1.45, 0.1, 0.18), coll=trim)


def crest(x, y, team):
    gem = M["redGem"] if team == "red" else M["blueGem"]
    obj("CrestPlate", paver_me, M["gold"], C.wpos(x, y, 0.2), (0.75, 0.75 / C.COS, 0.08), (0, 0, math.radians(22.5)), trim)
    obj("CrestGem", gem_me, gem, C.wpos(x, y, 0.32), (0.5, 0.5 / C.COS * 0.8, 0.16), coll=trim)


for xs in (4.5, 95.5):
    banner(xs, 146, "red")
    banner(xs, 108, "red")
    banner(xs, 14, "blue")
    banner(xs, 52, "blue")
for (x, y) in TOWERS:
    crest(x, y - 5.6 if y < 80 else y - 5.6, "blue" if y < 80 else "red")
for (x, y) in CORES:
    crest(x, y - 7.0, "blue" if y < 80 else "red")

# ------------------------------------------------------------------ foreground (near-camera corners only)

fore = colls["fore"]
for (fx, fy) in ((1.5, 0.8), (98.5, 0.8), (4.0, -0.4), (96.0, -0.4)):
    bush(fx, fy, 1.6, fore)

# ------------------------------------------------------------------ render passes

LAYERS = [
    ("base-terrain", ["terrain"]),
    ("river-water", ["water"]),
    ("water-ripples-0", ["ripA"]),
    ("water-ripples-1", ["ripB"]),
    ("rift-ford-open", ["fordOpen"]),
    ("rift-ford-closing", ["fordClose"]),
    ("banks-bridges", ["banks"]),
    ("foundations", ["found"]),
    ("border-scenery", ["border"]),
    ("ambient", ["ambient"]),
    ("team-trim", ["trim"]),
    ("foreground", ["fore"]),
]
NO_SHADOW = {"ripA", "ripB", "fordOpen", "fordClose", "water"}


def objs_of(keys):
    out = []
    for k in keys:
        out += list(colls[k].all_objects)
    return out


for k, c in colls.items():
    for o in c.all_objects:
        o.visible_shadow = k not in NO_SHADOW

geometry = {}
pts = {
    "bridgeL_sw": (BRIDGES[0][0], RIVER[0]), "bridgeL_ne": (BRIDGES[0][1], RIVER[1]),
    "bridgeR_sw": (BRIDGES[1][0], RIVER[0]), "bridgeR_ne": (BRIDGES[1][1], RIVER[1]),
    "ford_sw": (FORD[0], RIVER[0]), "ford_ne": (FORD[1], RIVER[1]),
    "core_p0": CORES[0], "core_p1": CORES[1],
    "tower_p0_west": TOWERS[0], "tower_p1_east": TOWERS[3],
}
for nm, (x, y) in pts.items():
    px, py = C.project(cam, C.wpos(x, y, 0))
    geometry[nm] = {"logical": [x, y], "projected": [round(px, 3), round(py, 3)], "expected": [100 + 10 * x, 120 + 10 * (160 - y)]}
with open(os.path.join(OUT, "_geometry-check.json"), "w") as f:
    json.dump(geometry, f, indent=1)
print("geometry", json.dumps(geometry))

for lid, keys in LAYERS:
    if ONLY and lid not in ONLY:
        continue
    vis = set(id(o) for o in objs_of(keys))
    for k, c in colls.items():
        for o in c.all_objects:
            o.visible_camera = id(o) in vis
            o.hide_render = False
            if o.type == "LIGHT":
                o.hide_render = False
    sc.render.film_transparent = lid != "base-terrain"
    C.render_to(os.path.join(OUT, lid + ".png"))
    print("rendered", lid)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "..", "arena-v003.blend"))
