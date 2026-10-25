"""Chog Royale animated units v001: Choglings and Boulderback.

Rigid-part Chog models (no skinning), posed per frame by pivots and rendered
with the v003 arena camera tilt and lights, so units match the approved arena.

Run headless from this folder:
  blender.exe -b --factory-startup --python build_units.py -- <out_dir> [unit ...]

Env flags:
  PREVIEW=1   identity and gameplay stills only, 16 samples
  CLIPS=a,b   render only these clips
  NOCARD=1    skip the card portrait
  CARDONLY=1  render only the identity still and card portrait

Outputs per unit under <out_dir>/<unit>/:
  frames/<clip>_<nn>.png   one transparent cell per frame, shared ground pivot
  card-portrait@2x.png     512x512 card portrait master
  identity-front.png       front three-quarter identity still
  record.json              cell, pivot, clips and fps for the packer
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "chaos-crossing-v003", "scripts"))
import common as C  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else os.path.join(HERE, "..", "masters"))
ONLY = set(ARGV[1:])
PREVIEW = bool(os.environ.get("PREVIEW"))
CARDONLY = bool(os.environ.get("CARDONLY"))
CLIPS = set(filter(None, os.environ.get("CLIPS", "").split(",")))

# Facing: front three-quarter, turned toward screen right. Phaser mirrors on X
# for left-moving units, which is the renderer's existing single-view contract.
YAW = math.radians(24)

M = {}
OUTLINES = []


def mats():
    M.update({
        "cream": C.mat("ChogCream", "#ffeacb", rough=0.45, sss=0.08, coat=0.1, emit="#ffeacb", emit_strength=0.14),
        "creamShade": C.mat("ChogCreamShade", "#f0dcc0", rough=0.5, sss=0.06),
        "eyeWhite": C.mat("EyeWhite", "#ffffff", rough=0.18, spec=0.7, emit="#ffffff", emit_strength=0.3),
        "pupil": C.mat("Pupil", "#0d0b10", rough=0.4, spec=0.2),
        "blush": C.mat("Blush", "#ff6f9f", rough=0.55, emit="#ff4f8a", emit_strength=0.15),
        "mouth": C.mat("Mouth", "#2a1a1e", rough=0.6),
        "tongue": C.mat("Tongue", "#ff7d93", rough=0.5),
        # Choglings: cyan spikes from the card art, two tones plus a deep core.
        "cyan": C.mat("ChogCyan", "#13b9cc", rough=0.55, coat=0.05, spec=0.3),
        "cyanLight": C.mat("ChogCyanLight", "#45dbe8", rough=0.55, coat=0.05, spec=0.3),
        "cyanDeep": C.mat("ChogCyanDeep", "#0b8fa6", rough=0.58, coat=0.05, spec=0.3),
        # Boulderback: charcoal suit and spikes, three-tone stone plates.
        "suit": C.mat("Suit", "#2c2a31", rough=0.62),
        "suitLight": C.mat("SuitLight", "#3c3943", rough=0.6),
        "bSpike": C.mat("BoulderSpike", "#2a272f", rough=0.6, coat=0.08),
        "bSpike2": C.mat("BoulderSpikeLight", "#48444f", rough=0.58, coat=0.08),
        "stoneA": C.mat("StoneLight", "#cbbba3", rough=0.66, coat=0.12),
        "stoneB": C.mat("StoneMid", "#ad9d87", rough=0.68, coat=0.1),
        "stoneC": C.mat("StoneCool", "#938571", rough=0.7, coat=0.08),
        "stoneD": C.mat("StoneDeep", "#7a6e5f", rough=0.74),
        "dust": C.mat("Dust", "#d9cdb8", rough=0.9),
    })


# ---------------------------------------------------------------- rig

def empty(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def make_rig(joints):
    """joints: name -> (parent name, world rest position). Pivots start at rest
    with identity rotation, so a part's world transform is easy to bind."""
    yaw = empty("yaw", None, (0, 0, 0))
    piv = {"yaw": yaw}
    rest = {}
    world = {"yaw": Vector((0, 0, 0))}
    for name, (parent, pos) in joints.items():
        p = Vector(pos)
        piv[name] = empty(name, piv[parent], p - world[parent])
        world[name] = p
        rest[name] = tuple(p - world[parent])
    bpy.context.view_layer.update()
    return {"piv": piv, "rest": rest, "sets": {}, "stones": []}


def bind(rig, pivot, o):
    p = rig["piv"][pivot]
    o.parent = p
    o.matrix_parent_inverse = p.matrix_world.inverted()


def pose(rig, p):
    piv = rig["piv"]
    piv["yaw"].rotation_euler = (0, 0, YAW + p.get("yaw", 0.0))
    for name, rest in rig["rest"].items():
        o = piv[name]
        d = p.get(name + "_loc", (0, 0, 0))
        o.location = (rest[0] + d[0], rest[1] + d[1], rest[2] + d[2])
        rot = p.get(name + "_rot", (0, 0, 0))
        # A small constant chin lift keeps the face readable from the high camera.
        o.rotation_euler = (rot[0] - 0.12, rot[1], rot[2]) if name == "head" else rot
        s = p.get(name + "_scale", 1.0)
        o.scale = (s, s, s) if isinstance(s, (int, float)) else s
    for key, objs in rig["sets"].items():
        show = p.get("show", {}).get(key, key.endswith("_default"))
        for o in objs:
            o.hide_render = not show
    k = p.get("crumble", 0.0)
    for o, rest_loc, out in rig["stones"]:
        o.location = rest_loc + out * k + Vector((0, 0, -0.9 * k * k))
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- parts

def apply_tf(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def outline(o, t):
    if t:
        C.add_outline(o, t)
        mod = o.modifiers["Outline"]
        OUTLINES.append((mod, t))


def part(rig, pivot, kind, loc, scale, material, rot=(0, 0, 0), ol=0.05, smooth=True, bev=None, sets=None, **kw):
    if kind == "cube":
        kw.setdefault("size", 1.0)
    if kind in ("cyl", "cone"):
        kw.setdefault("depth", 1.0)
    o = C.prim(kind, f"{pivot}_{kind}", loc=loc, scale=scale, rot=rot, material=material, smooth=smooth, **kw)
    apply_tf(o)
    if bev:
        C.bevel(o, bev, 2)
    outline(o, ol)
    bind(rig, pivot, o)
    for s in sets or ():
        rig["sets"].setdefault(s, []).append(o)
    return o


def capsule(rig, pivot, p0, p1, r, material, ol=0.05, r1=None):
    """Limb segment between two points with rounded ends."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = d.normalized().to_track_quat("Z", "Y").to_euler()
    r1 = r1 or r
    part(rig, pivot, "cone", (p0 + p1) / 2, (1, 1, d.length), material, rot=q, ol=ol, vertices=20, radius1=r, radius2=r1)
    part(rig, pivot, "sphere", p0, (r, r, r), material, ol=ol, segments=20, ring_count=10)
    part(rig, pivot, "sphere", p1, (r1, r1, r1), material, ol=ol, segments=20, ring_count=10)


def spike(rig, pivot, base, dirv, L, rad, material, flat=1.0, ol=0.05, verts=8, smooth=False):
    dirv = Vector(dirv).normalized()
    q = dirv.to_track_quat("Z", "Y")
    return part(rig, pivot, "cone", Vector(base) + dirv * (L / 2), (rad, rad * flat, L), material, rot=q.to_euler(), ol=ol,
                vertices=verts, radius1=1.0, radius2=0.0, smooth=smooth)


def stone(rig, pivot, center, size, rnd, rot=(0, 0, 0), material=None, ol=0.05, crumble=True, body=Vector((0, 0, 2.0))):
    """Chiselled stylised boulder: jittered box, bevelled, flat-shaded faces."""
    import bmesh

    o = C.prim("cube", f"{pivot}_stone", loc=center, scale=size, rot=rot, material=material or rnd.choice((M["stoneA"], M["stoneB"], M["stoneC"])), smooth=False, size=1.0)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for v in bm.verts:
        v.co += Vector((rnd.uniform(-0.13, 0.13), rnd.uniform(-0.13, 0.13), rnd.uniform(-0.1, 0.1)))
    bm.to_mesh(o.data)
    bm.free()
    apply_tf(o)
    b = C.bevel(o, min(size) * 0.34, 3)
    b.limit_method = "NONE"
    b.harden_normals = False
    for poly in o.data.polygons:
        poly.use_smooth = True
    outline(o, ol)
    bind(rig, pivot, o)
    if crumble:
        out = (Vector(center) - body)
        out.z = abs(out.z) * 0.3 + 0.2
        rig["stones"].append((o, o.location.copy(), out.normalized() * 0.9))
    return o


def crown(rig, hc, r, mats2, rnd, rad, verts=6):
    """Upward-back crown spikes that cover the smooth scalp between the ring and fan."""
    for i in range(8):
        a = i / 8 * math.tau
        b = Vector((math.cos(a) * 0.5, 0.25 + math.sin(a) * 0.45, 0.82)).normalized()
        dv = b + Vector((0, 0.35, 0.2))
        spike(rig, "spikes", hc + b * r * 0.7, dv, r * rnd.uniform(0.75, 0.95), r * rad, mats2[i % 2], verts=verts)


def facemask_material(name, spike_hex, mask_hex, front_min=0.22, top_max=0.62):
    """Single head material: Chog face mask on the front, spike colour behind."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Subsurface Weight"].default_value = 0.06
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 0.15
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Normal"], sep.inputs[0])
    neg = nt.nodes.new("ShaderNodeMath")
    neg.operation = "MULTIPLY"
    neg.inputs[1].default_value = -1.0
    nt.links.new(sep.outputs["Y"], neg.inputs[0])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = front_min
    nt.links.new(neg.outputs[0], gt.inputs[0])
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = top_max
    nt.links.new(sep.outputs["Z"], lt.inputs[0])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(gt.outputs[0], mul.inputs[0])
    nt.links.new(lt.outputs[0], mul.inputs[1])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(mul.outputs[0], mix.inputs["Factor"])
    mix.inputs["A"].default_value = C.hexc(spike_hex)
    mix.inputs["B"].default_value = C.hexc(mask_hex)
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    nt.links.new(mix.outputs["Result"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.12
    b.inputs["Coat Weight"].default_value = 0.08
    b.inputs["Roughness"].default_value = 0.5
    return m


def on_head(center, r, d, push=0.0):
    d = Vector(d).normalized()
    return Vector(center) + d * (r + push), d


def yaw_for(d):
    return math.atan2(d.x, -d.y)


def chog_face(rig, pivot, center, r, style):
    """Card-art Chog face: round eyes with a white ring and heavy rim, large black
    pupils with an upper-left glint, angled brows, pink blush and a small mouth.
    Closed '><' eyes live in the `eyes_closed` set for hit and defeat frames."""
    ew, eh = style.get("eye", (0.27, 0.32))
    spread, ez = style.get("spread", 0.4), style.get("eye_z", 0.06)
    brow = style.get("brow", 0.4)
    for sx in (-1, 1):
        p, d = on_head(center, r, (sx * spread, -0.92, ez), -0.05)
        yaw = yaw_for(d)
        part(rig, pivot, "sphere", p, (r * ew, r * 0.08, r * eh), M["eyeWhite"], rot=(0, 0, yaw), ol=0.07, segments=24, ring_count=12, sets=["eyes_default"])
        pp = p + d * (r * 0.05) + Vector((sx * 0.02 * r, 0, -0.02 * r))
        part(rig, pivot, "sphere", pp, (r * ew * 0.82, r * 0.06, r * eh * 0.84), M["pupil"], rot=(0, 0, yaw), ol=0, segments=20, ring_count=10, sets=["eyes_default"])
        hp = pp + d * (r * 0.06) + Vector((-0.07 * r, 0, 0.1 * r))
        part(rig, pivot, "sphere", hp, (r * 0.075, r * 0.03, r * 0.085), M["eyeWhite"], rot=(0, 0, yaw), ol=0, segments=12, ring_count=6, sets=["eyes_default"])
        # Closed eye: a chevron pointing toward the nose bridge.
        for k in (-1, 1):
            cp = p + d * (r * 0.03) + Vector((0, 0, k * eh * r * 0.28))
            part(rig, pivot, "cube", cp, (r * ew * 1.5, r * 0.06, r * 0.08), M["pupil"], rot=(0, k * sx * math.radians(28), yaw), ol=0, bev=0.02, sets=["eyes_closed"])
        bp, bd = on_head(center, r, (sx * 0.66, -0.72, ez - 0.36), -0.06)
        part(rig, pivot, "sphere", bp, (r * style.get("blush", 0.17), r * 0.05, r * 0.11), M["blush"], rot=(0, 0, yaw_for(bd)), ol=0, segments=16, ring_count=8)
        # Angled brow, inner end low: the card's mischievous / stern V.
        brp, brd = on_head(center, r, (sx * (spread + 0.02), -0.86, ez + eh * 1.2 + 0.05), -0.02)
        part(rig, pivot, "cube", brp, (r * 0.4, r * 0.09, r * 0.11), M["pupil"], rot=(0, -sx * brow, yaw_for(brd)), ol=0, bev=0.035)
    mp, md = on_head(center, r, (0.05, -0.97, ez - 0.48), -0.035)
    import bmesh

    o = part(rig, pivot, "torus", mp + Vector((0.0, 0, 0.06 * r)), (r * 0.14, r * 0.14, r * 0.12), M["mouth"],
             rot=(math.radians(90), math.radians(style.get("mouth_tilt", -10)), yaw_for(md)), ol=0, major_radius=1.0, minor_radius=0.22,
             major_segments=24, minor_segments=8)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    cz = sum(v.co.z for v in bm.verts) / len(bm.verts)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > cz + 0.01 * r], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()


# ---------------------------------------------------------------- characters

CHOG_JOINTS = {
    "root": ("yaw", (0, 0, 0)),
    "hips": ("root", (0, 0, 0.9)),
    "head": ("hips", (0, 0, 2.0)),
    "spikes": ("head", (0, 0.05, 3.05)),
    "armL": ("hips", (-0.66, 0, 1.78)),
    "armR": ("hips", (0.66, 0, 1.78)),
    "legL": ("root", (-0.36, 0, 0.82)),
    "legR": ("root", (0.36, 0, 0.82)),
}


def chogling():
    """Choglings (card 01): cream Chog body, big cream face mask on a cyan
    spiky head, sunburst spikes with a backswept rear fan, white-ring round
    eyes, mischievous V brows, pink blush, small smile, short limbs."""
    rig = make_rig(CHOG_JOINTS)
    rnd = random.Random(101)
    hc, r = Vector((0, 0, 3.05)), 1.22
    # Legs and round feet.
    for sx, key in ((-1, "legL"), (1, "legR")):
        x = sx * 0.36
        capsule(rig, key, (x, 0, 0.8), (x * 1.08, -0.02, 0.32), 0.25, M["cream"], r1=0.24)
        part(rig, key, "sphere", (x * 1.1, -0.16, 0.17), (0.38, 0.52, 0.21), M["cream"], ol=0.05)
        for k in (-1, 0, 1):
            part(rig, key, "sphere", (x * 1.1 + k * 0.16, -0.6, 0.15), (0.12, 0.12, 0.11), M["cream"], ol=0.03)
    # Pear body with a soft belly.
    part(rig, "hips", "sphere", (0, 0, 1.36), (0.8, 0.7, 0.84), M["cream"], ol=0.055, segments=32, ring_count=16)
    part(rig, "hips", "sphere", (0, -0.2, 1.18), (0.62, 0.55, 0.52), M["cream"], ol=0.0, segments=24, ring_count=12)
    # Short arms with round mitten hands and a thumb.
    for sx, key in ((-1, "armL"), (1, "armR")):
        sh = Vector((sx * 0.66, 0, 1.78))
        hand = Vector((sx * 0.98, -0.12, 1.12))
        capsule(rig, key, sh, hand, 0.2, M["cream"], r1=0.19)
        part(rig, key, "sphere", hand + Vector((0, -0.02, -0.06)), (0.26, 0.25, 0.25), M["cream"], ol=0.05)
        part(rig, key, "sphere", hand + Vector((-sx * 0.14, -0.16, 0.04)), (0.1, 0.1, 0.11), M["cream"], ol=0.03)
    # Head: cream mask in front, cyan behind.
    part(rig, "head", "sphere", hc, (r, r * 0.95, r * 0.94), facemask_material("ChoglingHead", "#13b9cc", "#ffeacb", front_min=0.24, top_max=0.66),
         ol=0.06, segments=48, ring_count=24)
    chog_face(rig, "head", hc, r, {"spread": 0.38, "eye_z": 0.04, "eye": (0.25, 0.3), "brow": math.radians(24), "mouth_tilt": -12})
    # Sunburst ring framing the mask, sweeping back.
    n = 15
    for i in range(n):
        th = math.radians(-152 + 304 * i / (n - 1))
        b = Vector((math.sin(th) * 0.82, 0.5, math.cos(th) * 0.82)).normalized()
        dv = Vector((math.sin(th) * 1.15, 0.45, math.cos(th) * 1.05 + 0.08))
        L = r * (0.98 - 0.26 * abs(th) / math.radians(152) + rnd.uniform(-0.05, 0.1))
        spike(rig, "spikes", hc + b * r * 0.6, dv, L, r * 0.44, M["cyanLight"] if i % 2 else M["cyan"], verts=6)
    # Backswept rear fan: the long spikes that give the back silhouette.
    for (x, z, s) in ((-0.75, 0.5, 1.0), (0.75, 0.5, 1.0), (0.0, 0.9, 1.1), (-0.95, -0.2, 0.85), (0.95, -0.2, 0.85), (-0.4, -0.65, 0.8), (0.4, -0.65, 0.8), (0.0, 0.2, 1.15)):
        dv = Vector((x * 1.3, 1.0, z * 1.2 + 0.25)).normalized()
        spike(rig, "spikes", hc, dv, r * 1.75 * s, r * 0.5, M["cyanDeep"] if (x + z) > 0.3 else M["cyan"], verts=7)
    crown(rig, hc, r, (M["cyan"], M["cyanLight"]), rnd, 0.42)
    # Front forelock tuft over the brow.
    for sx, L in ((-0.3, 0.62), (0.05, 0.75), (0.36, 0.56)):
        bb = Vector((sx, -0.35, 0.94)).normalized()
        spike(rig, "spikes", hc + bb * r * 0.78, Vector((sx * 1.2, -0.25, 1.0)), r * L, r * 0.28, M["cyanLight"], verts=7)
    return rig


BOULDER_JOINTS = {
    "root": ("yaw", (0, 0, 0)),
    "hips": ("root", (0, 0, 1.2)),
    "head": ("hips", (0, -0.15, 2.7)),
    "spikes": ("head", (0, -0.3, 3.42)),
    "armL": ("hips", (-1.3, 0.05, 2.7)),
    "armR": ("hips", (1.3, 0.05, 2.7)),
    "legL": ("root", (-0.58, 0, 1.15)),
    "legR": ("root", (0.58, 0, 1.15)),
}


def boulderback():
    """Boulderback (card 03): Chog face mask with white-ring eyes, stern brows
    and big blush inside a crown of dark rocky spikes, charcoal body, massive
    layered stone shoulders and arms, stone chest and back plates, big cream
    fists and feet. Compact, heavy, slightly hunched."""
    rig = make_rig(BOULDER_JOINTS)
    rnd = random.Random(303)
    hc, r = Vector((0, -0.3, 3.42)), 1.13
    # Legs: short thick charcoal limbs, stone knee caps, cream toed feet.
    for sx, key in ((-1, "legL"), (1, "legR")):
        x = sx * 0.6
        capsule(rig, key, (x, 0, 1.12), (x * 1.08, -0.05, 0.42), 0.4, M["suit"], r1=0.36)
        stone(rig, key, (x * 1.12, -0.36, 0.72), (0.5, 0.36, 0.42), rnd, rot=(0.2, sx * 0.2, 0))
        part(rig, key, "sphere", (x * 1.1, -0.2, 0.22), (0.5, 0.66, 0.26), M["cream"], ol=0.05)
        for k in (-1, 0, 1):
            part(rig, key, "sphere", (x * 1.1 + k * 0.21, -0.78, 0.18), (0.15, 0.15, 0.14), M["cream"], ol=0.035)
    # Charcoal torso, hunched forward.
    part(rig, "hips", "sphere", (0, 0.05, 2.0), (1.15, 0.98, 1.08), M["suit"], ol=0.06, segments=32, ring_count=16)
    part(rig, "hips", "sphere", (0, 0.05, 1.3), (0.95, 0.85, 0.5), M["suitLight"], ol=0.04)
    # Chest and belly plates.
    for (x, z, w, h, roll) in ((-0.44, 2.28, 0.86, 0.66, -0.12), (0.44, 2.28, 0.86, 0.66, 0.1), (0.02, 1.62, 0.9, 0.5, 0.06)):
        stone(rig, "hips", (x, -0.88, z), (w, 0.36, h), rnd, rot=(rnd.uniform(-0.12, 0.12), roll, x * 0.3))
    # Back hump: the layered boulders the unit is named for.
    for (x, y, z, s) in ((0, 0.85, 2.7, 1.0), (-0.65, 0.75, 2.3, 0.8), (0.65, 0.75, 2.3, 0.8), (0, 0.95, 1.9, 0.85), (0, 0.55, 3.2, 0.7)):
        stone(rig, "hips", (x, y, z), (0.95 * s, 0.6 * s, 0.7 * s), rnd, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3)))
    # Massive arms: boulder pauldrons, stone upper arm and forearm bands, cream fists.
    for sx, key in ((-1, "armL"), (1, "armR")):
        sh = Vector((sx * 1.3, 0.05, 2.7))
        el = Vector((sx * 1.72, -0.12, 1.85))
        fist = Vector((sx * 1.62, -0.42, 1.0))
        capsule(rig, key, sh, el, 0.42, M["suit"])
        capsule(rig, key, el, fist, 0.38, M["suit"])
        for (dx, dy, dz, w, d, h) in ((0.1, 0.0, 0.45, 1.25, 1.1, 0.75), (0.35, -0.25, 0.05, 0.9, 0.8, 0.7), (0.2, 0.35, 0.15, 0.85, 0.75, 0.7)):
            stone(rig, key, sh + Vector((sx * dx, dy, dz)), (w, d, h), rnd, rot=(rnd.uniform(-0.25, 0.25), sx * rnd.uniform(0.1, 0.35), rnd.uniform(-0.2, 0.2)))
        mid = (sh + el) / 2
        stone(rig, key, mid + Vector((sx * 0.25, -0.1, -0.05)), (0.62, 0.75, 0.6), rnd, rot=(0.1, sx * 0.4, 0.1))
        fm = (el + fist) / 2
        for k, off in enumerate((Vector((sx * 0.12, -0.15, 0.18)), Vector((sx * 0.1, -0.05, -0.18)))):
            stone(rig, key, fm + off, (0.82, 0.78, 0.4), rnd, rot=(0.15 * k, sx * 0.25, rnd.uniform(-0.2, 0.2)))
        part(rig, key, "sphere", fist + Vector((0, -0.05, -0.12)), (0.56, 0.52, 0.5), M["cream"], ol=0.055)
        for k in (-1, 0, 1):
            part(rig, key, "sphere", fist + Vector((k * 0.2, -0.42, -0.02)), (0.17, 0.16, 0.18), M["cream"], ol=0.035)
    # Head: cream mask, dark rock spikes.
    part(rig, "head", "sphere", hc, (r, r * 0.95, r * 0.94), facemask_material("BoulderHead", "#2a2730", "#ffeacb", front_min=0.26, top_max=0.66),
         ol=0.06, segments=48, ring_count=24)
    chog_face(rig, "head", hc, r, {"spread": 0.4, "eye_z": 0.05, "eye": (0.27, 0.3), "brow": math.radians(26), "blush": 0.22, "mouth_tilt": -6})
    n = 13
    for i in range(n):
        th = math.radians(-148 + 296 * i / (n - 1))
        b = Vector((math.sin(th) * 0.82, 0.5, math.cos(th) * 0.82)).normalized()
        dv = Vector((math.sin(th) * 1.15, 0.55, math.cos(th) * 1.05 + 0.12))
        L = r * (1.05 - 0.3 * abs(th) / math.radians(148) + rnd.uniform(-0.05, 0.1))
        spike(rig, "spikes", hc + b * r * 0.55, dv, L, r * 0.4, M["bSpike2"] if i % 2 else M["bSpike"], verts=6)
    for (x, z, s) in ((-0.7, 0.55, 1.0), (0.7, 0.55, 1.0), (0.0, 0.95, 1.1), (-0.95, -0.1, 0.8), (0.95, -0.1, 0.8), (0.0, 0.25, 1.1)):
        dv = Vector((x * 1.3, 1.0, z * 1.2 + 0.25)).normalized()
        spike(rig, "spikes", hc, dv, r * 1.65 * s, r * 0.45, M["bSpike"] if (x + z) > 0.3 else M["bSpike2"], verts=6)
    crown(rig, hc, r, (M["bSpike"], M["bSpike2"]), rnd, 0.44, verts=5)
    for sx, L in ((-0.28, 0.55), (0.08, 0.68), (0.4, 0.5)):
        bb = Vector((sx, -0.35, 0.94)).normalized()
        spike(rig, "spikes", hc + bb * r * 0.78, Vector((sx * 1.2, -0.2, 1.0)), r * L, r * 0.3, M["bSpike2"], verts=6)
    # Impact chips for the slam, hidden outside the impact frames.
    for i in range(6):
        a = i / 6 * math.tau
        part(rig, "yaw", "ico", (math.cos(a) * 0.9, -1.6 + math.sin(a) * 0.5, 0.2), (0.16, 0.14, 0.12), M["stoneB"] if i % 2 else M["dust"],
             ol=0.03, subdivisions=1, smooth=False, sets=["chips"])
    return rig


# ---------------------------------------------------------------- clips

def lunge(k, z=0.0):
    """Root offset toward the facing direction: screen right, slightly toward camera."""
    return (0.55 * k, -0.55 * k, z)


def lean(a, roll=0.0):
    """Lean toward the facing direction (positive) or away from it (negative)."""
    return (0.62 * a, 0.5 * a, roll)


def chog_clips():
    tau = math.tau
    clips = {}
    f = []
    for i in range(6):
        t = i / 6 * tau
        s = math.sin(t)
        f.append({"hips_loc": (0, 0, 0.04 * s), "root_scale": (1 - 0.025 * s, 1 - 0.025 * s, 1 + 0.03 * s),
                  "head_rot": (0.05 * math.sin(t + 0.8), 0.07 * math.sin(t), 0), "spikes_rot": (-0.04 * math.sin(t + 1.4), 0, 0),
                  "armL_rot": (0.08 * s, 0.1 + 0.05 * s, 0), "armR_rot": (-0.08 * s, -0.1 - 0.05 * s, 0)})
    clips["idle"] = {"fps": 8, "loop": True, "frames": f}
    f = []
    for i in range(8):
        t = i / 8 * tau
        s, c2 = math.sin(t), math.cos(2 * t)
        f.append({"root_loc": (0, 0, 0.42 * abs(s)), "root_rot": (0.2, 0, 0.04 * s),
                  "root_scale": (1 + 0.06 * c2, 1 + 0.06 * c2, 1 - 0.09 * c2),
                  "legL_rot": (-0.8 * s, 0, 0), "legR_rot": (0.8 * s, 0, 0),
                  "armL_rot": (0.9 * s, 0.25, 0), "armR_rot": (-0.9 * s, -0.25, 0),
                  "head_rot": (0.07 * c2, 0, -0.06 * s), "spikes_rot": (-0.1 * c2, 0, 0)})
    clips["move"] = {"fps": 14, "loop": True, "frames": f}
    clips["attack"] = {"fps": 16, "loop": False, "impact": 3, "frames": [
        {"root_scale": (1.07, 1.07, 0.88), "root_rot": lean(-0.14), "armR_rot": (0.9, -0.2, 0), "armL_rot": (0.4, 0.3, 0), "head_rot": (-0.12, 0, 0)},
        {"root_loc": lunge(-0.18), "root_scale": (1.1, 1.1, 0.84), "root_rot": lean(-0.24), "armR_rot": (1.3, -0.3, 0), "armL_rot": (0.5, 0.3, 0), "head_rot": (-0.16, 0, 0), "spikes_rot": (0.08, 0, 0)},
        {"root_loc": lunge(0.65, 0.4), "root_scale": (0.92, 0.92, 1.12), "root_rot": lean(0.38), "armR_rot": (-1.5, -0.4, 0), "armL_rot": (0.7, 0.4, 0), "legL_rot": (0.6, 0, 0), "legR_rot": (0.3, 0, 0), "head_rot": (-0.12, 0, 0), "spikes_rot": (-0.12, 0, 0)},
        {"root_loc": lunge(0.85, 0.18), "root_scale": (1.1, 1.1, 0.9), "root_rot": lean(0.42), "armR_rot": (-1.7, -0.5, 0), "armL_rot": (0.8, 0.4, 0), "legL_rot": (0.5, 0, 0), "legR_rot": (-0.2, 0, 0), "head_rot": (-0.18, 0, 0), "spikes_rot": (0.12, 0, 0)},
        {"root_loc": lunge(0.5, 0.05), "root_scale": (1.03, 1.03, 0.96), "root_rot": lean(0.2), "armR_rot": (-0.8, -0.2, 0), "armL_rot": (0.4, 0.2, 0), "head_rot": (-0.08, 0, 0)},
        {"root_loc": lunge(0.15), "root_scale": (1.02, 1.02, 0.98), "root_rot": lean(0.06), "armR_rot": (-0.2, -0.1, 0)},
    ]}
    shut = {"eyes_default": False, "eyes_closed": True}
    clips["hit"] = {"fps": 14, "loop": False, "frames": [
        {"root_loc": lunge(-0.4, 0.1), "root_rot": lean(-0.36, 0.08), "root_scale": (1.08, 1.08, 0.9), "armL_rot": (0, 0.7, 0), "armR_rot": (0, -0.7, 0), "head_rot": (-0.15, 0, 0.1), "show": shut},
        {"root_loc": lunge(-0.28), "root_rot": lean(-0.2, 0.04), "armL_rot": (0, 0.4, 0), "armR_rot": (0, -0.4, 0), "show": shut},
        {"root_loc": lunge(-0.1), "root_rot": lean(-0.06)},
    ]}
    d = []
    # Knock-out pop: eyes shut, hop, spin to show the spike fan, poof away.
    for z, tilt, spin, sc in ((0.15, -0.3, 0.0, 1.0), (0.6, -0.35, 0.8, 1.0), (0.95, -0.3, 1.8, 0.95), (0.9, -0.25, 2.8, 0.85),
                              (0.6, -0.2, 3.6, 0.68), (0.3, -0.15, 4.4, 0.5), (0.1, -0.1, 5.0, 0.32), (0.02, 0.0, 5.4, 0.16)):
        d.append({"root_loc": (0, 0.1, z), "root_rot": (tilt, 0, 0), "yaw": spin, "root_scale": sc,
                  "armL_rot": (0, 1.2, 0), "armR_rot": (0, -1.2, 0), "legL_rot": (-0.5, 0, 0), "legR_rot": (0.3, 0, 0), "show": shut})
    clips["defeat"] = {"fps": 14, "loop": False, "frames": d}
    return clips


def boulder_clips():
    tau = math.tau
    clips = {}
    f = []
    for i in range(6):
        t = i / 6 * tau
        s = math.sin(t)
        f.append({"hips_loc": (0, 0, 0.05 * s), "root_scale": (1 + 0.015 * s, 1 + 0.015 * s, 1 - 0.012 * s),
                  "armL_loc": (0, 0, 0.07 * s), "armR_loc": (0, 0, 0.07 * s), "armL_rot": (0, 0.04 * s, 0), "armR_rot": (0, -0.04 * s, 0),
                  "head_rot": (0.04 * math.sin(t + 1.0), 0, 0.03 * s)})
    clips["idle"] = {"fps": 6, "loop": True, "frames": f}
    f = []
    for i in range(8):
        t = i / 8 * tau
        s, c2 = math.sin(t), math.cos(2 * t)
        f.append({"root_loc": (0, 0, 0.12 * abs(s) - 0.05 * max(0.0, c2)), "root_rot": (0.16, 0.09 * s, 0.05 * s),
                  "root_scale": (1 + 0.03 * max(0.0, c2), 1 + 0.03 * max(0.0, c2), 1 - 0.04 * max(0.0, c2)),
                  "legL_rot": (-0.5 * s, 0, 0), "legR_rot": (0.5 * s, 0, 0),
                  "legL_loc": (0, 0, 0.18 * max(0.0, -s)), "legR_loc": (0, 0, 0.18 * max(0.0, s)),
                  "armL_rot": (0.3 * s, 0.05, 0), "armR_rot": (-0.3 * s, -0.05, 0),
                  "head_rot": (0.05 * c2, 0, -0.05 * s)})
    clips["move"] = {"fps": 9, "loop": True, "frames": f}
    up = lambda a: {"armL_rot": (a, 0.1, 0), "armR_rot": (a, -0.1, 0)}  # noqa: E731
    chips = {"chips": True}
    clips["attack"] = {"fps": 11, "loop": False, "impact": 4, "frames": [
        {"root_rot": lean(0.08), **up(-0.5)},
        {"root_rot": lean(-0.16), "root_scale": (0.97, 0.97, 1.05), "head_rot": (-0.14, 0, 0), **up(-2.3)},
        {"root_loc": lunge(-0.15, 0.12), "root_rot": lean(-0.26), "root_scale": (0.96, 0.96, 1.07), "head_rot": (-0.2, 0, 0), **up(-2.9)},
        {"root_loc": lunge(0.2, 0.05), "root_rot": lean(0.26), "head_rot": (-0.2, 0, 0), **up(-1.4)},
        {"root_loc": lunge(0.35, -0.06), "root_rot": lean(0.4), "root_scale": (1.09, 1.09, 0.9), "head_rot": (-0.3, 0, 0), **up(-0.75), "show": chips},
        {"root_loc": lunge(0.3, -0.04), "root_rot": lean(0.36), "root_scale": (1.05, 1.05, 0.94), "head_rot": (-0.28, 0, 0), **up(-0.8), "show": chips, "chips_up": 1},
        {"root_loc": lunge(0.15), "root_rot": lean(0.22), "head_rot": (-0.1, 0, 0), **up(-0.25)},
        {"root_rot": lean(0.08), **up(-0.05)},
    ]}
    shut = {"eyes_default": False, "eyes_closed": True}
    clips["hit"] = {"fps": 12, "loop": False, "frames": [
        {"root_loc": lunge(-0.16), "root_rot": lean(-0.16, 0.05), "root_scale": (1.04, 1.04, 0.95), "head_rot": (-0.12, 0, 0.08), "show": shut},
        {"root_loc": lunge(-0.14), "root_rot": lean(-0.2, 0.03), "head_rot": (-0.08, 0, 0.05), "show": shut},
        {"root_loc": lunge(-0.06), "root_rot": lean(-0.08)},
        {"root_rot": lean(0.02)},
    ]}
    d = []
    seq = ((0, -0.15, 0, 0, 0), (-0.2, 0.05, 0.9, 0, 0), (-0.45, 0.2, 1.2, 0, 0), (-0.62, 0.38, 1.3, 0, 0), (-0.72, 0.5, 1.35, 0.0, (1.05, 1.05, 0.92)),
           (-0.75, 0.55, 1.35, 0.35, 1.0), (-0.78, 0.58, 1.35, 0.7, 0.95), (-0.8, 0.6, 1.35, 1.05, 0.88), (-0.8, 0.6, 1.35, 1.35, 0.8))
    for i, (z, tilt, knee, crumble, sc) in enumerate(seq):
        d.append({"root_loc": (0, 0.1 * min(i, 4), z), "root_rot": (tilt, 0, 0), "root_scale": sc or 1.0,
                  "legL_rot": (knee, 0, 0), "legR_rot": (knee * 0.9, 0, 0), "armL_rot": (-0.6 * min(tilt, 1), 0.2, 0), "armR_rot": (-0.6 * min(tilt, 1), -0.2, 0),
                  "head_rot": (-0.4 * min(tilt, 0.6), 0, 0), "crumble": crumble, "show": shut})
    clips["defeat"] = {"fps": 10, "loop": False, "frames": d}
    return clips


UNITS = {
    "choglings": {"build": chogling, "clips": chog_clips, "cell": (112, 112), "pivot": (56, 94), "px": 12.0, "outlineK": 1.5,
                  "card": {"center": (-0.15, 0, 3.1), "scale": 5.0, "pose": {"yaw": -0.42, "armL_rot": (-0.7, 0.5, 0), "armR_rot": (-0.7, -0.5, 0), "head_rot": (0.04, -0.1, 0.06), "root_rot": (0.08, 0, 0)}}},
    "boulderback": {"build": boulderback, "clips": boulder_clips, "cell": (160, 176), "pivot": (80, 126), "px": 18.0, "outlineK": 1.4,
                    "card": {"center": (0.0, 0, 3.15), "scale": 5.3, "pose": {"yaw": -0.3, "root_rot": (0.12, 0, 0), "armL_rot": (-0.85, 0.3, 0), "armR_rot": (-0.85, -0.3, 0), "head_rot": (0.06, 0, 0)}}},
}


def set_outline(k):
    for mod, t in OUTLINES:
        mod.thickness = t * k


def apply_chips(rig, p):
    up = p.get("chips_up", 0)
    for i, o in enumerate(rig["sets"].get("chips", [])):
        a = i / 6 * math.tau
        o.location = (0.9 + math.cos(a) * (0.8 + 0.35 * up), -1.5 + math.sin(a) * (0.5 + 0.2 * up), 0.2 + 0.45 * up * (1 + (i % 3) * 0.3))


def build_unit(name, spec):
    C.reset_scene()
    C._mats.clear()
    M.clear()
    OUTLINES.clear()
    mats()
    sc = bpy.context.scene
    if PREVIEW:
        sc.eevee.taa_render_samples = 16
    C.setup_world(0.85)
    C.setup_sun(3.4)
    rig = spec["build"]()
    out_dir = os.path.join(OUT, name)
    os.makedirs(os.path.join(out_dir, "frames"), exist_ok=True)
    cw, ch = spec["cell"]
    cam = C.mount_camera(spec["px"], (cw, ch), spec["pivot"])
    clips = spec["clips"]()
    record = {"unit": name, "cell": [cw, ch], "pivot": list(spec["pivot"]), "pxPerUnit": spec["px"], "yawDeg": math.degrees(YAW),
              "tiltDeg": math.degrees(C.TILT), "clips": {}}
    set_outline(spec["outlineK"])
    if CARDONLY:
        pass
    elif PREVIEW:
        pose(rig, clips["idle"]["frames"][0])
        C.render_to(os.path.join(out_dir, "preview-game.png"))
        sc.render.resolution_x, sc.render.resolution_y = cw * 4, ch * 4
        cam.data.ortho_scale = max(cw, ch) / spec["px"]
        C.render_to(os.path.join(out_dir, "preview-game@4x.png"))
        sc.render.resolution_x, sc.render.resolution_y = cw, ch
    else:
        for clip, cd in clips.items():
            if CLIPS and clip not in CLIPS:
                continue
            files = []
            for i, fr in enumerate(cd["frames"]):
                pose(rig, fr)
                apply_chips(rig, fr)
                path = os.path.join(out_dir, "frames", f"{clip}_{i:02d}.png")
                C.render_to(path)
                files.append(os.path.relpath(path, out_dir).replace("\\", "/"))
            record["clips"][clip] = {"fps": cd["fps"], "loop": cd["loop"], "impact": cd.get("impact"), "files": files}
    gp = C.project(cam, Vector((0, 0, 0)))
    record["groundAnchorCheck"] = [round(gp[0], 3), round(gp[1], 3)]

    # Identity still: front three-quarter at a near-level camera, larger scale.
    pose(rig, clips["idle"]["frames"][0])
    set_outline(1.0)
    idc = bpy.data.cameras.new("IdCam")
    idc.type = "ORTHO"
    idc.ortho_scale = 6.4 if name == "choglings" else 7.4
    ido = bpy.data.objects.new("IdCam", idc)
    sc.collection.objects.link(ido)
    ido.rotation_euler = (math.radians(80), 0, 0)
    look = Vector((0, 0, 2.5 if name == "choglings" else 2.6))
    ido.location = look - Vector((0, math.sin(math.radians(80)), -math.cos(math.radians(80)))) * 60
    sc.camera = ido
    sc.render.resolution_x, sc.render.resolution_y = 384, 512
    if name == "choglings":
        idc.ortho_scale = 6.0
    C.render_to(os.path.join(out_dir, "identity-front.png"))

    if not os.environ.get("NOCARD"):
        card = spec["card"]
        pose(rig, card["pose"])
        idc.ortho_scale = card["scale"]
        ido.rotation_euler = (math.radians(76), 0, 0)
        look = Vector(card["center"])
        ido.location = look - Vector((0, math.sin(math.radians(76)), -math.cos(math.radians(76)))) * 60
        set_outline(0.85)
        sc.render.resolution_x, sc.render.resolution_y = 512, 512
        C.render_to(os.path.join(out_dir, "card-portrait@2x.png"))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = cw, ch
    if not PREVIEW and not CARDONLY:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{name}.blend"))
        with open(os.path.join(out_dir, "record.json"), "w") as fh:
            json.dump(record, fh, indent=2)
    return record


os.makedirs(OUT, exist_ok=True)
for unit_name, unit_spec in UNITS.items():
    if ONLY and unit_name not in ONLY:
        continue
    build_unit(unit_name, unit_spec)
