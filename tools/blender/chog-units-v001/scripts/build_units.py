"""Chog Royale animated units v001: Choglings and Boulderback.

Rigid-part Chog models (no skinning), posed per frame by pivots and rendered
with the v003 arena camera tilt and lights, so units match the approved arena.

Run headless from this folder:
  blender.exe -b --factory-startup --python build_units.py -- <out_dir> [unit ...]

Env flags:
  PREVIEW=1   identity and gameplay stills only, 16 samples
  PCLIP=, PFRAME=  which clip/frame the preview poses (default idle 0)
  VIEWS=front,rear  which gameplay views to render (default both)
  CLIPS=a,b   render only these clips
  NOCARD=1    skip the card portrait
  CARDONLY=1  render only the identity stills and card portrait

Outputs per unit under <out_dir>/<unit>/:
  frames/<clip>_<nn>.png        front three-quarter cell per frame, shared ground pivot
  frames/rear/<clip>_<nn>.png   rear three-quarter cell per frame, same pivot and timing
  card-portrait@4x.png          1024x1024 card portrait master
  identity-front.png, identity-rear.png   near-level identity stills
  record.json                   cell, pivot, views, clips and fps for the packer

Gameplay cells render at 2x the runtime sheet. pack_units.cjs halves them.
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

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
# for left-moving units. Slice 3.1 adds the rear three-quarter view (facing
# screen right and away) for units heading up the board. The rear view is the
# front view reflected through the screen-horizontal plane: yaw 180 - 24 plus
# a left/right mirrored pose, so lunges and leans still travel screen-right.
YAW = math.radians(24)
VIEWS = {"front": YAW, "rear": math.pi - YAW}
VIEW = ["front"]
# Head lift per view (radians). Gameplay frames tip the face toward the high
# board camera. Identity and card stills use the near-level value.
LIFT = {"front": 0.12, "rear": 0.12}
VIEWS_ON = [v for v in os.environ.get("VIEWS", "front,rear").split(",") if v in VIEWS]

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
        "cyan": C.mat("ChogCyan", "#14c0cc", rough=0.6, coat=0.04, spec=0.25),
        "cyanLight": C.mat("ChogCyanLight", "#4ee0e4", rough=0.6, coat=0.04, spec=0.25),
        "cyanDeep": C.mat("ChogCyanDeep", "#0c97a6", rough=0.62, coat=0.04, spec=0.25),
        # Boulderback: charcoal suit and spikes.
        "suit": C.mat("Suit", "#2c2a31", rough=0.62),
        "suitLight": C.mat("SuitLight", "#3c3943", rough=0.6),
        "bSpike": C.mat("BoulderSpike", "#2a272f", rough=0.6, coat=0.08),
        "bSpike2": C.mat("BoulderSpikeLight", "#48444f", rough=0.58, coat=0.08),
        "dust": C.mat("Dust", "#cfcbc4", rough=0.9),
        "magenta": C.mat("Magenta", "#ec3c93", rough=0.5, emit="#e8338f", emit_strength=0.22),
        # Slice 3.1 Boulderback stone: the card's neutral grey, three tones.
        "rockA": C.mat("RockLight", "#cbc1b0", rough=0.62, coat=0.12),
        "rockB": C.mat("RockMid", "#aea392", rough=0.66, coat=0.1),
        "rockC": C.mat("RockCool", "#938978", rough=0.7, coat=0.08),

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


SWAP = {"armL": "armR", "armR": "armL", "legL": "legR", "legR": "legL", "wingL": "wingR", "wingR": "wingL"}


def mirror_pose(p):
    """Reflect a pose through the rig's sagittal plane (x -> -x): locations
    negate x, XYZ eulers negate y and z, left and right limbs swap."""
    q = {}
    for k, v in p.items():
        base, _, suffix = k.partition("_")
        name = (SWAP.get(base, base) + "_" + suffix) if suffix else k
        if k == "yaw":
            v = -v
        elif suffix == "loc":
            v = (-v[0], v[1], v[2])
        elif suffix == "rot":
            v = (v[0], -v[1], -v[2])
        q[name] = v
    return q


def pose(rig, p):
    piv = rig["piv"]
    # Slice 4: units holding a prop in one hand mirror the whole model for the
    # rear view (negative X scale on the yaw root), so the bow or shield stays
    # in the hand that carries the pose. Symmetric units mirror only the pose.
    flip = VIEW[0] == "rear" and rig.get("mirror_geo")
    if VIEW[0] == "rear" and not flip:
        p = mirror_pose(p)
    yaw = -p.get("yaw", 0.0) if flip else p.get("yaw", 0.0)
    piv["yaw"].rotation_euler = (0, 0, VIEWS[VIEW[0]] + yaw)
    piv["yaw"].scale = (-1, 1, 1) if flip else (1, 1, 1)
    for name, rest in rig["rest"].items():
        o = piv[name]
        d = p.get(name + "_loc", (0, 0, 0))
        o.location = (rest[0] + d[0], rest[1] + d[1], rest[2] + d[2])
        rot = p.get(name + "_rot", (0, 0, 0))
        # A constant chin lift keeps the face readable from the high camera.
        o.rotation_euler = (rot[0] - LIFT[VIEW[0]], rot[1], rot[2]) if name == "head" else rot
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


def blade(rig, pivot, base, dirv, L, rad, material, flat_axis, flat=0.45, ol=0.05, verts=10, smooth=True):
    """Broad soft spike: a cone pointing along `dirv`, flattened along
    `flat_axis`, so a ring of them reads as the card's painted sunburst."""
    z = Vector(dirv).normalized()
    y = Vector(flat_axis)
    y = (y - z * y.dot(z)).normalized()
    x = y.cross(z)
    rot = Matrix((x, y, z)).transposed().to_euler()
    return part(rig, pivot, "cone", Vector(base) + z * (L / 2), (rad, rad * flat, L), material, rot=rot, ol=ol,
                vertices=verts, radius1=1.0, radius2=0.0, smooth=smooth)


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
        part(rig, pivot, "sphere", pp, (r * ew * 0.89, r * 0.06, r * eh * 0.9), M["pupil"], rot=(0, 0, yaw), ol=0, segments=20, ring_count=10, sets=["eyes_default"])
        hp = pp + d * (r * 0.06) + Vector((-0.07 * r, 0, 0.1 * r))
        part(rig, pivot, "sphere", hp, (r * 0.075, r * 0.03, r * 0.085), M["eyeWhite"], rot=(0, 0, yaw), ol=0, segments=12, ring_count=6, sets=["eyes_default"])
        # Closed eye: a chevron pointing toward the nose bridge.
        for k in (-1, 1):
            cp = p + d * (r * 0.03) + Vector((0, 0, k * eh * r * 0.28))
            part(rig, pivot, "cube", cp, (r * ew * 1.5, r * 0.06, r * 0.08), M["pupil"], rot=(0, k * sx * math.radians(28), yaw), ol=0, bev=0.02, sets=["eyes_closed"])
        bp, bd = on_head(center, r, (sx * 0.66, -0.72, ez - 0.36), -0.06)
        part(rig, pivot, "sphere", bp, (r * style.get("blush", 0.17), r * 0.05, r * 0.11), M[style.get("blush_mat", "blush")], rot=(0, 0, yaw_for(bd)), ol=0, segments=16, ring_count=8)
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
    "hips": ("root", (0, 0, 1.02)),
    "head": ("hips", (0, 0, 2.12)),
    "spikes": ("head", (0, 0.05, 3.18)),
    "armL": ("hips", (-0.6, 0, 1.88)),
    "armR": ("hips", (0.6, 0, 1.88)),
    "legL": ("root", (-0.34, 0, 0.95)),
    "legR": ("root", (0.34, 0, 0.95)),
}


def sunburst(rig, hc, r, rnd, mats3, tilt=math.radians(16), k=1.0, scalp=True):
    """Card-01 spike silhouette: broad soft blades in a disc behind the face,
    wrapping the top, both sides and down past the cheeks, a second offset
    ring behind it, and a rear burst so the back view reads as a cyan crown.
    Returns the disc normal (toward the camera side of the face)."""
    light, mid, deep = mats3
    nrm = Vector((0, -math.cos(tilt), math.sin(tilt)))
    back = -nrm
    u = Vector((1, 0, 0))
    v = nrm.cross(u).normalized() * -1
    if v.z < 0:
        v = -v

    def d(th):
        return u * math.sin(th) + v * math.cos(th)

    n = 11
    for i in range(n):
        th = math.radians(-160 + 320 * i / (n - 1))
        side = max(0.0, abs(math.degrees(th)) - 95) / 65
        L = k * r * (1.22 + rnd.uniform(-0.05, 0.12)) * (1 - 0.3 * side)
        blade(rig, "spikes", hc + back * (0.02 * r) + d(th) * (0.55 * r), d(th) + back * 0.2, L, r * 0.6,
              light if i % 2 else mid, nrm, flat=0.34, ol=0.05, verts=16)
    for i in range(n):
        th = math.radians(-170 + 340 * (i + 0.5) / n)
        side = max(0.0, abs(math.degrees(th)) - 100) / 70
        L = k * r * (1.32 + rnd.uniform(-0.05, 0.1)) * (1 - 0.3 * side)
        blade(rig, "spikes", hc + back * (0.35 * r) + d(th) * (0.45 * r), d(th) + back * 0.45, L, r * 0.6,
              mid if i % 2 else deep, nrm, flat=0.4, ol=0.05, verts=16)
    # Rear burst: short broad blades fanning out of the back of the head.
    for i in range(7):
        th = math.radians(-150 + 300 * i / 6)
        tang = u * math.cos(th) - v * math.sin(th)
        blade(rig, "spikes", hc + back * (0.3 * r), back + d(th) * 0.9, k * r * (1.05 + rnd.uniform(-0.05, 0.08)), r * 0.5,
              deep if i % 2 else mid, tang, flat=0.55, ol=0.05, verts=16)
    blade(rig, "spikes", hc + back * (0.3 * r), back + v * 0.3, k * r * 1.05, r * 0.5, mid, u, flat=0.55, ol=0.05, verts=16)
    # Scalp blades: break up the smooth dome the high camera sees above the face.
    for x, kk in ((-0.42, 0.9), (0.0, 1.0), (0.42, 0.9)) if scalp else ():
        dv = v * 1.0 + back * 0.55 + u * x
        blade(rig, "spikes", hc + (v * 0.55 + back * 0.05 + u * x * 0.5) * r, dv, k * r * 0.78 * kk, r * 0.5, light if x else mid, nrm, flat=0.4, ol=0.05, verts=16)
    return nrm


def chogling():
    """Choglings (card 01): short cream Chog body, round cream face on a cyan
    head framed by a broad sunburst of soft spikes that wraps the sides and
    rear, white-ring round eyes, mischievous V brows, pink blush, small smile,
    little mitten hands and toed feet."""
    rig = make_rig(CHOG_JOINTS)
    rnd = random.Random(101)
    hc, r = Vector((0, 0, 3.18)), 1.12
    # Legs and round feet.
    for sx, key in ((-1, "legL"), (1, "legR")):
        x = sx * 0.34
        capsule(rig, key, (x, 0, 0.95), (x * 1.08, -0.02, 0.3), 0.23, M["cream"], r1=0.22)
        part(rig, key, "sphere", (x * 1.1, -0.17, 0.16), (0.36, 0.5, 0.2), M["cream"], ol=0.05)
        for k in (-1, 0, 1):
            part(rig, key, "sphere", (x * 1.1 + k * 0.15, -0.6, 0.14), (0.115, 0.115, 0.105), M["cream"], ol=0.03)
    # Small pear body with a soft belly.
    part(rig, "hips", "sphere", (0, 0, 1.5), (0.7, 0.62, 0.8), M["cream"], ol=0.055, segments=32, ring_count=16)
    part(rig, "hips", "sphere", (0, -0.18, 1.32), (0.56, 0.5, 0.5), M["cream"], ol=0.0, segments=24, ring_count=12)
    # Short arms with round mitten hands and a thumb.
    for sx, key in ((-1, "armL"), (1, "armR")):
        sh = Vector((sx * 0.6, 0, 1.88))
        hand = Vector((sx * 0.92, -0.12, 1.22))
        capsule(rig, key, sh, hand, 0.18, M["cream"], r1=0.17)
        part(rig, key, "sphere", hand + Vector((0, -0.02, -0.06)), (0.24, 0.23, 0.23), M["cream"], ol=0.05)
        part(rig, key, "sphere", hand + Vector((-sx * 0.13, -0.15, 0.04)), (0.09, 0.09, 0.1), M["cream"], ol=0.03)
    # Head: round cream face in front, cyan scalp showing around it.
    part(rig, "head", "sphere", hc, (r, r * 0.84, r * 0.97), facemask_material("ChoglingHead", "#14c0cc", "#ffeacb", front_min=0.3, top_max=0.88),
         ol=0.06, segments=48, ring_count=24)
    chog_face(rig, "head", hc, r, {"spread": 0.4, "eye_z": 0.0, "eye": (0.26, 0.31), "brow": math.radians(27), "blush": 0.22, "mouth_tilt": -14})
    sunburst(rig, hc, r, rnd, (M["cyanLight"], M["cyan"], M["cyanDeep"]))
    return rig


BOULDER_JOINTS = {
    "root": ("yaw", (0, 0, 0)),
    "hips": ("root", (0, 0, 1.2)),
    "head": ("hips", (0, -0.15, 2.7)),
    "spikes": ("head", (0, -0.3, 3.64)),
    "armL": ("hips", (-1.38, 0.05, 2.75)),
    "armR": ("hips", (1.38, 0.05, 2.75)),
    "legL": ("root", (-0.6, 0, 1.15)),
    "legR": ("root", (0.6, 0, 1.15)),
}


def orient(z, up=Vector((0, 0, 1))):
    z = Vector(z).normalized()
    up = Vector(up)
    y = up - z * up.dot(z)
    if y.length < 1e-4:
        y = Vector((0, 1, 0)) - z * z.y
    y.normalize()
    return Matrix((y.cross(z), y, z)).transposed()


def finish_rock(rig, pivot, o, bev, ol, crumble, body):
    apply_tf(o)
    b = C.bevel(o, bev, 3)
    b.limit_method = "NONE"
    b.harden_normals = False
    for poly in o.data.polygons:
        poly.use_smooth = True
    outline(o, ol)
    bind(rig, pivot, o)
    if crumble:
        out = o.matrix_world.translation - Vector(body)
        out.z = abs(out.z) * 0.3 + 0.2
        rig["stones"].append((o, o.location.copy(), out.normalized() * 0.9))
    return o


def plate(rig, pivot, center, normal, radius, thick, rnd, up=(0, 0, 1), aspect=1.0, material=None, ol=0.05, crumble=True, body=(0, 0, 2.0)):
    """Irregular flagstone armour plate: a 5-7 sided convex slab laid on the
    body surface, top face inset for a chiselled edge, heavily bevelled."""
    sides = rnd.randint(5, 7)
    ring = []
    for i in range(sides):
        a = (i + rnd.uniform(-0.28, 0.28)) / sides * math.tau
        rr = radius * rnd.uniform(0.84, 1.12)
        ring.append((math.cos(a) * rr * aspect, math.sin(a) * rr))
    verts = [(x, y, -thick / 2) for x, y in ring] + [(x * 0.84, y * 0.84, thick / 2) for x, y in ring]
    faces = [list(range(sides))[::-1], list(range(sides, 2 * sides))]
    faces += [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    o = C.new_mesh_obj(f"{pivot}_plate", verts, faces, material or rnd.choice((M["rockA"], M["rockB"], M["rockB"], M["rockC"])))
    o.matrix_world = Matrix.Translation(Vector(center)) @ orient(normal, up).to_4x4()
    return finish_rock(rig, pivot, o, thick * 0.42, ol, crumble, body)


def rock(rig, pivot, center, size, rnd, rot=(0, 0, 0), material=None, ol=0.05, crumble=True, body=(0, 0, 2.0), taper=0.18):
    """Rounded boulder mass: subdivided box with jittered, tapered corners so
    no two read as the same block, then a soft bevel."""
    import bmesh

    o = C.prim("cube", f"{pivot}_rock", loc=center, scale=size, rot=rot, material=material or rnd.choice((M["rockA"], M["rockB"], M["rockC"])), smooth=False, size=1.0)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    tx, ty = rnd.uniform(-taper, taper), rnd.uniform(-taper, taper)
    for v in bm.verts:
        v.co.x *= 1 + tx * v.co.z * 2
        v.co.y *= 1 + ty * v.co.z * 2
        v.co += Vector((rnd.uniform(-0.07, 0.07), rnd.uniform(-0.07, 0.07), rnd.uniform(-0.06, 0.06)))
    bm.to_mesh(o.data)
    bm.free()
    return finish_rock(rig, pivot, o, min(size) * 0.3, ol, crumble, body)


def on_body(c, rad, th, h, lift=0.0):
    """Point and outward normal on an ellipsoid body at horizontal angle th
    (0 = front, positive = character's left) and normalised height h."""
    k = math.sqrt(max(0.0, 1 - h * h))
    d = Vector((math.sin(th) * k, -math.cos(th) * k, h))
    p = Vector(c) + Vector((d.x * rad[0], d.y * rad[1], d.z * rad[2]))
    n = Vector((d.x / rad[0], d.y / rad[1], d.z / rad[2])).normalized()
    return p + n * lift, n


def boulderback():
    """Boulderback (card 03): cream Chog face with white-ring eyes, stern
    brows and magenta blush inside a crown of dark rocky spikes. Massive
    layered stone shoulders and boulder forearms dominate the silhouette.
    Charcoal body under interlocking irregular grey stone plates, a boulder
    hump, short legs with stone knees, broad cream clawed feet, modest fists."""
    rig = make_rig(BOULDER_JOINTS)
    rnd = random.Random(303)
    hc, r = Vector((0, -0.3, 3.64)), 1.18
    # Legs: short thick charcoal limbs, stone knee caps, broad cream feet with claw toes.
    for sx, key in ((-1, "legL"), (1, "legR")):
        x = sx * 0.62
        capsule(rig, key, (x, 0, 1.12), (x * 1.06, -0.05, 0.42), 0.42, M["suit"], r1=0.38)
        plate(rig, key, (x * 1.1, -0.38, 0.78), (sx * 0.25, -1, 0.15), 0.36, 0.2, rnd, ol=0.045, body=(x, 0, 0.8))
        part(rig, key, "sphere", (x * 1.08, -0.22, 0.22), (0.56, 0.62, 0.26), M["cream"], ol=0.05)
        for k in (-1, 0, 1):
            tx = x * 1.08 + k * 0.26
            part(rig, key, "sphere", (tx, -0.72, 0.17), (0.15, 0.2, 0.14), M["cream"], ol=0.035)
            blade(rig, key, (tx, -0.84, 0.15), (k * 0.15, -1, -0.25), 0.2, 0.09, M["creamShade"], (0, 0, 1), flat=0.7, ol=0.03, verts=8)
    # Charcoal torso, hunched forward, under interlocking stone plates.
    tc, trad = Vector((0, 0.05, 2.05)), (1.15, 0.98, 1.1)
    part(rig, "hips", "sphere", tc, trad, M["suit"], ol=0.06, segments=32, ring_count=16)
    part(rig, "hips", "sphere", (0, 0.05, 1.3), (0.98, 0.86, 0.52), M["suitLight"], ol=0.04)
    layout = ((-0.4, 0.4, 0.5), (0.42, 0.42, 0.52), (-0.02, -0.08, 0.48), (-0.86, -0.1, 0.42), (0.84, -0.14, 0.42),
              (-0.4, -0.62, 0.42), (0.4, -0.64, 0.42))
    for th, h, R in layout:
        pc, n = on_body(tc, trad, th, h, 0.03)
        plate(rig, "hips", pc, n, R, 0.17, rnd, up=(0, 0, 1), aspect=rnd.uniform(1.0, 1.2), body=tc)

    # Back hump: the layered boulders the unit is named for.
    for th, h, s in ((math.pi, 0.45, 1.0), (math.pi - 0.75, 0.15, 0.85), (math.pi + 0.75, 0.15, 0.85), (math.pi, -0.2, 0.9), (math.pi - 0.4, 0.75, 0.7), (math.pi + 0.45, 0.72, 0.7)):
        pc, n = on_body(tc, trad, th, h, 0.12 * s)
        rock(rig, "hips", pc, (0.95 * s, 0.6 * s, 0.75 * s), rnd, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3)), body=tc)
    # Massive shoulders: a crowning boulder pauldron on the torso, layered
    # stones down the outside of the upper arm, then boulder forearms.
    for sx, key in ((-1, "armL"), (1, "armR")):
        sh = Vector((sx * 1.38, 0.05, 2.75))
        el = Vector((sx * 1.86, -0.1, 1.82))
        fist = Vector((sx * 1.76, -0.4, 0.98))
        rock(rig, "hips", sh + Vector((sx * 0.36, 0.08, 0.3)), (1.45, 1.3, 0.95), rnd, rot=(0.05, sx * 0.32, sx * 0.1), material=M["rockA"], body=tc)
        rock(rig, "hips", sh + Vector((sx * 0.3, -0.5, 0.04)), (0.95, 0.55, 0.8), rnd,
 rot=(0.3, sx * 0.4, 0.15 * sx), material=M["rockB"], body=tc)
        capsule(rig, key, sh, el, 0.42, M["suit"])
        capsule(rig, key, el, fist, 0.4, M["suit"])
        rock(rig, key, sh + Vector((sx * 0.62, 0.0, -0.18)), (0.7, 1.15, 1.0), rnd, rot=(0.1, sx * 0.55, 0.0), material=M["rockB"], body=sh)
        rock(rig, key, (sh + el) / 2 + Vector((sx * 0.3, -0.05, -0.1)), (0.6, 0.9, 0.62), rnd, rot=(0.15, sx * 0.4, 0.1), material=M["rockC"], body=sh)
        fm = (el + fist) / 2
        rock(rig, key, fm + Vector((sx * 0.05, -0.08, 0.2)), (1.15, 1.08, 0.62), rnd, rot=(0.1, sx * 0.2, 0.1), material=M["rockA"], body=el)
        rock(rig, key, fm + Vector((sx * 0.02, -0.12, -0.28)), (1.02, 0.98, 0.5), rnd, rot=(-0.12, sx * 0.15, -0.1), material=M["rockB"], body=el)
        part(rig, key, "sphere", fist + Vector((0, -0.04, -0.16)), (0.42, 0.4, 0.38), M["cream"], ol=0.05)
        for k in (-1, 0, 1):
            part(rig, key, "sphere", fist + Vector((k * 0.17, -0.34, -0.1)), (0.13, 0.12, 0.13), M["cream"], ol=0.03)
    # Head: cream mask, dark rocky spikes wrapping the face.
    part(rig, "head", "sphere", hc, (r, r * 0.86, r * 0.97), facemask_material("BoulderHead", "#2a2730", "#ffeacb", front_min=0.3, top_max=0.86),
         ol=0.06, segments=48, ring_count=24)
    chog_face(rig, "head", hc, r, {"spread": 0.41, "eye_z": 0.02, "eye": (0.255, 0.3), "brow": math.radians(30), "blush": 0.24, "blush_mat": "magenta", "mouth_tilt": -6})
    sunburst(rig, hc, r, rnd, (M["bSpike2"], M["bSpike"], M["bSpike"]), k=1.12)
    # Impact chips for the slam, hidden outside the impact frames.
    for i in range(6):
        a = i / 6 * math.tau
        part(rig, "yaw", "ico", (math.cos(a) * 0.9, -1.6 + math.sin(a) * 0.5, 0.2), (0.16, 0.14, 0.12), M["rockB"] if i % 2 else M["dust"],
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
    "choglings": {"build": chogling, "clips": chog_clips, "cell": (148, 148), "pivot": (74, 124), "px": 16.0, "outlineK": 1.5,
                  "identityScale": 6.4, "identityLook": 2.6, "lift": {"front": 0.3, "rear": 0.05},
                  "card": {"center": (0.0, 0, 2.72), "scale": 5.9, "pitch": 80, "outline": 1.3,
                           "pose": {"yaw": -0.2, "armL_rot": (-0.25, 0.35, 0), "armR_rot": (-0.25, -0.35, 0), "head_rot": (0.05, -0.08, 0.08), "legL_rot": (0, 0.08, 0), "legR_rot": (0, -0.08, 0)}}},
    "boulderback": {"build": boulderback, "clips": boulder_clips, "cell": (200, 220), "pivot": (100, 158), "px": 22.5, "outlineK": 1.4,
                    "identityScale": 7.6, "identityLook": 2.6, "lift": {"front": 0.26, "rear": 0.05},
                    "card": {"center": (0.0, 0, 2.55), "scale": 6.7, "pitch": 80, "outline": 1.3,
                             "pose": {"yaw": -0.16, "root_rot": (0.06, 0, 0), "armL_rot": (-0.4, 0.12, 0), "armR_rot": (-0.4, -0.12, 0), "head_rot": (0.05, -0.06, 0.05)}}},

}


def set_outline(k):
    for mod, t in OUTLINES:
        mod.thickness = t * k


def apply_chips(rig, p):
    up = p.get("chips_up", 0)
    sx = -1 if VIEW[0] == "rear" else 1
    for i, o in enumerate(rig["sets"].get("chips", [])):
        a = i / 6 * math.tau
        o.location = (sx * (0.9 + math.cos(a) * (0.8 + 0.35 * up)), -1.5 + math.sin(a) * (0.5 + 0.2 * up), 0.2 + 0.45 * up * (1 + (i % 3) * 0.3))


def record_anchors(rig, cam, record, view, clip, i, cd):
    """Final assets: project named anchor empties (muzzle, weapon tip) into
    the cell at idle frame 0 and at the attack impact frame, so effects can
    start where the art shows the weapon. Units without anchors skip this."""
    if not rig.get("anchors") or not ((clip == "idle" and i == 0) or (clip == "attack" and i == (cd.get("impact") or 0))):
        return
    for nm, e in rig["anchors"].items():
        px, py = C.project(cam, e.matrix_world.translation)
        record.setdefault("anchors", {}).setdefault(view, {}).setdefault(nm, {})[clip] = [round(px, 2), round(py, 2)]


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
    LIFT.update(spec.get("lift", {}))
    if CARDONLY:
        pass
    elif PREVIEW:
        for view in VIEWS_ON:
            VIEW[0] = view
            pose(rig, clips[os.environ.get("PCLIP", "idle")]["frames"][int(os.environ.get("PFRAME", "0"))])
            C.render_to(os.path.join(out_dir, f"preview-game-{view}.png"))
            sc.render.resolution_x, sc.render.resolution_y = cw * 4, ch * 4
            C.render_to(os.path.join(out_dir, f"preview-game-{view}@4x.png"))
            sc.render.resolution_x, sc.render.resolution_y = cw, ch
    else:
        record["views"] = {}
        for view in VIEWS_ON:
            VIEW[0] = view
            vclips = {}
            for clip, cd in clips.items():
                if CLIPS and clip not in CLIPS:
                    continue
                files = []
                for i, fr in enumerate(cd["frames"]):
                    pose(rig, fr)
                    apply_chips(rig, fr)
                    record_anchors(rig, cam, record, view, clip, i, cd)
                    sub = "frames" if view == "front" else os.path.join("frames", view)
                    path = os.path.join(out_dir, sub, f"{clip}_{i:02d}.png")
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    C.render_to(path)
                    files.append(os.path.relpath(path, out_dir).replace("\\", "/"))
                vclips[clip] = {"fps": cd["fps"], "loop": cd["loop"], "impact": cd.get("impact"), "files": files}
            record["views"][view] = vclips
        record["clips"] = record["views"].get("front", {})
    VIEW[0] = "front"
    gp = C.project(cam, Vector((0, 0, 0)))
    record["groundAnchorCheck"] = [round(gp[0], 3), round(gp[1], 3)]

    # Identity stills: front and rear three-quarter at a near-level camera.
    LIFT.update({"front": 0.12, "rear": 0.12})
    set_outline(1.0)
    idc = bpy.data.cameras.new("IdCam")
    idc.type = "ORTHO"
    idc.ortho_scale = spec["identityScale"]
    ido = bpy.data.objects.new("IdCam", idc)
    sc.collection.objects.link(ido)
    ido.rotation_euler = (math.radians(80), 0, 0)
    look = Vector((0, 0, spec["identityLook"]))
    ido.location = look - Vector((0, math.sin(math.radians(80)), -math.cos(math.radians(80)))) * 60
    sc.camera = ido
    sc.render.resolution_x, sc.render.resolution_y = 768, 1024
    for view in ("front", "rear"):
        VIEW[0] = view
        pose(rig, clips["idle"]["frames"][0])
        C.render_to(os.path.join(out_dir, f"identity-{view}.png"))
    VIEW[0] = "front"

    if not os.environ.get("NOCARD"):
        card = spec["card"]
        pose(rig, card["pose"])
        idc.ortho_scale = card["scale"]
        ido.rotation_euler = (math.radians(card.get("pitch", 76)), 0, 0)
        look = Vector(card["center"])
        ido.location = look - Vector((0, math.sin(ido.rotation_euler[0]), -math.cos(ido.rotation_euler[0]))) * 60
        set_outline(card.get("outline", 0.85))
        sc.render.resolution_x, sc.render.resolution_y = 1024, 1024
        C.render_to(os.path.join(out_dir, "card-portrait@4x.png"))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = cw, ch
    if not PREVIEW and not CARDONLY:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{name}.blend"))
        with open(os.path.join(out_dir, "record.json"), "w") as fh:
            json.dump(record, fh, indent=2)
    return record


def main(units):
    os.makedirs(OUT, exist_ok=True)
    for unit_name, unit_spec in units.items():
        if ONLY and unit_name not in ONLY:
            continue
        build_unit(unit_name, unit_spec)


# build_roster.py imports this module for its helpers and runs its own units.
if __name__ == "__main__":
    main(UNITS)
