"""Chaos Crossing v003 team mounts: Chog-world towers with Bulwark (red, top,
faces down) and Chog Guardian (blue, bottom, faces up) defenders.

Run headless:
  blender.exe -b --factory-startup --python build_mounts.py -- <out_dir> [role ...]

Each role renders on a 512x640 master canvas at 20 px per logical unit with the
structure ground anchor at pixel (256, 560), the v002 mount contract. Parts:
structure-base, socket-platform, defender-idle, defender-<aim>, front-rim.
Weapon anchors are the projected 3D muzzle centre, not hand-picked pixels.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else os.path.join(os.path.dirname(__file__), "..", "masters", "mounts"))
ONLY = set(ARGV[1:])
PX = 20
PIVOT = (256, 560)

ROLES = {
    "lane-red": {"kind": "tower", "team": "red", "defender": "bulwark", "aim": "aim-south", "w": 7.2, "h": 5.0, "scale": 1.5},
    "lane-blue": {"kind": "tower", "team": "blue", "defender": "guardian", "aim": "aim-north", "w": 7.2, "h": 5.0, "scale": 1.5},
    "king-red": {"kind": "core", "team": "red", "defender": "bulwark", "aim": "aim-south", "w": 9.0, "h": 5.8, "scale": 1.65},
    "king-blue": {"kind": "core", "team": "blue", "defender": "guardian", "aim": "aim-north", "w": 9.0, "h": 5.8, "scale": 1.65},
}

M = {}


def mats():
    M.update({
        "stone": C.mat("Stone", "#a9adb5", rough=0.72),
        "stone2": C.mat("StoneWarm", "#bdb5a8", rough=0.72),
        "stoneDark": C.mat("StoneDark", "#7c818c", rough=0.75),
        "floor": C.mat("Floor", "#9c917f", rough=0.85),
        "mortar": C.mat("Mortar", "#6f7480", rough=0.9),
        "blockA": C.mat("BlockWarm", "#d3cbbb", rough=0.68, coat=0.05),
        "blockB": C.mat("BlockMid", "#bfb8aa", rough=0.7, coat=0.05),
        "blockC": C.mat("BlockCool", "#aab0ba", rough=0.7, coat=0.05),
        "quoin": C.mat("Quoin", "#e2dccd", rough=0.62, coat=0.08),
        "gold": C.mat("Gold", "#f4b731", rough=0.26, metal=0.9),
        "goldDeep": C.mat("GoldDeep", "#d4901c", rough=0.3, metal=0.9),
        "iron": C.mat("Iron", "#3b404b", rough=0.35, metal=0.8),
        "ironDark": C.mat("IronDark", "#16181d", rough=0.5, metal=0.3),
        "wood": C.mat("Wood", "#9a5f30", rough=0.6),
        "red": C.mat("TeamRed", "#e2323c", rough=0.5),
        "redDeep": C.mat("TeamRedDeep", "#a51d2a", rough=0.5),
        "redGem": C.mat("RedGem", "#ff3d4d", rough=0.06, emit="#ff2438", emit_strength=2.0, spec=1.0, coat=0.8),
        "blue": C.mat("TeamBlue", "#2f7cf0", rough=0.5),
        "blueDeep": C.mat("TeamBlueDeep", "#1c4fb0", rough=0.5),
        "blueGem": C.mat("BlueGem", "#46a6ff", rough=0.06, emit="#2a8cff", emit_strength=2.0, spec=1.0, coat=0.8),
        # Chog materials, sampled from the original card art palette.
        "cream": C.mat("ChogCream", "#fbeed6", rough=0.45, sss=0.08),
        "eyeWhite": C.mat("EyeWhite", "#ffffff", rough=0.2, spec=0.7, emit="#ffffff", emit_strength=0.25),
        "pupil": C.mat("Pupil", "#121016", rough=0.15, spec=0.9),
        "blush": C.mat("Blush", "#ff8fb0", rough=0.6),
        "mouth": C.mat("Mouth", "#2a1a1e", rough=0.6),
        "gSpike": C.mat("GuardianSpike", "#1f63e6", rough=0.38, coat=0.3),
        "gSpikeLight": C.mat("GuardianSpikeLight", "#3b86ff", rough=0.38, coat=0.3),
        "gSpikeDeep": C.mat("GuardianSpikeDeep", "#1749b8", rough=0.4, coat=0.3),
        "scarfDeep": C.mat("ScarfDeep", "#16459e", rough=0.6),
        "bSpike2": C.mat("BulwarkSpikeLight", "#3a3442", rough=0.42, coat=0.25),
        "steel": C.mat("Steel", "#a9b2bd", rough=0.32, metal=0.88),
        "steelDark": C.mat("SteelDark", "#737c89", rough=0.36, metal=0.85),
        "scarf": C.mat("Scarf", "#1f5fd6", rough=0.6),
        "leather": C.mat("Leather", "#7a4a26", rough=0.6),
        "bSkin": C.mat("BulwarkSkin", "#5b3826", rough=0.5, sss=0.05),
        "bSpike": C.mat("BulwarkSpike", "#24202a", rough=0.45, coat=0.2),
        "bCrest": C.mat("BulwarkCrest", "#e3232c", rough=0.55),
        "bCrestDeep": C.mat("BulwarkCrestDeep", "#b5151f", rough=0.55),
        "bArmor": C.mat("BulwarkArmor", "#f6f1e6", rough=0.35, coat=0.3),
        "shieldFace": C.mat("ShieldFace", "#f1ece2", rough=0.35, coat=0.3),
    })


# ---------------------------------------------------------------- part helpers

def apply_tf(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def part(group, kind, loc, scale, material, rot=(0, 0, 0), outline=0.035, smooth=True, bev=None, **kw):
    # Unit primitives: cube scale = full size, cylinder/cone scale z = full height.
    if kind == "cube":
        kw.setdefault("size", 1.0)
    if kind in ("cyl", "cone"):
        kw.setdefault("depth", 1.0)
    o = C.prim(kind, f"{group['name']}_{kind}", loc=loc, scale=scale, rot=rot, material=material, coll=group["coll"], smooth=smooth, **kw)
    apply_tf(o)
    if bev:
        C.bevel(o, bev, 2)
    if outline:
        C.add_outline(o, outline)
    o.parent = group["root"]
    group["parts"].append(o)
    return o


def new_group(name, coll):
    root = bpy.data.objects.new(name + "_root", None)
    coll.objects.link(root)
    return {"name": name, "root": root, "coll": coll, "parts": []}


def facemask_material(name, spike_hex, mask_hex, front_min=0.22, top_max=0.58):
    """Single head material: Chog face mask on the front, spike colour behind."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = 0.45
    b.inputs["Subsurface Weight"].default_value = 0.06
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
    return m


def on_head(center, r, d, push=0.0):
    d = Vector(d).normalized()
    return center + d * (r + push), d


def yaw_for(d):
    return math.atan2(d.x, -d.y)


def mesh_part(g, name, verts, faces, material, loc=(0, 0, 0), rot=None, outline=0.035, smooth=False, bev=None):
    me = bpy.data.meshes.new(f"{g['name']}_{name}")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(f"{g['name']}_{name}", me)
    me.materials.append(material)
    g["coll"].objects.link(o)
    o.location = loc
    if rot is not None:
        o.rotation_euler = rot
    if bev:
        C.bevel(o, bev, 2)
    if outline:
        C.add_outline(o, outline)
    o.parent = g["root"]
    g["parts"].append(o)
    return o


def taper_box(bw, bd, tw, td, length):
    """Tapered blade along +Z: base half-size (bw, bd), tip half-size (tw, td)."""
    v = [(-bw, -bd, 0), (bw, -bd, 0), (bw, bd, 0), (-bw, bd, 0),
         (-tw, -td, length), (tw, -td, length), (tw, td, length), (-tw, td, length)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def spike(g, base, dirv, L, rad, mat, flat=1.0, outline=0.045, verts=8, smooth=True):
    dirv = Vector(dirv).normalized()
    q = dirv.to_track_quat("Z", "Y")
    return part(g, "cone", base + dirv * (L / 2), (rad, rad * flat, L), mat, rot=q.to_euler(), outline=outline,
                vertices=verts, radius1=1.0, radius2=0.0, depth=1.0, smooth=smooth)


def chog_face(g, center, r, style):
    """Chog face from the card art: round eyes with a heavy rim, a shared upper-left
    highlight, pink blush and a small mouth. `style` keys: sclera, spread, eye_z,
    eye (w, h), brow {side: angle}, mouth ('smirk'|'flat')."""
    ew, eh = style.get("eye", (0.28, 0.33))
    spread, ez = style.get("spread", 0.4), style.get("eye_z", 0.06)
    for sx in (-1, 1):
        p, d = on_head(center, r, (sx * spread, -0.92, ez), -0.05)
        yaw = yaw_for(d)
        if style.get("sclera"):
            part(g, "sphere", p, (r * ew, r * 0.08, r * eh), M["eyeWhite"], rot=(0, 0, yaw), outline=0.065, segments=24, ring_count=12)
            pp = p + d * (r * 0.045) + Vector((-sx * 0.035 * r, 0, -0.025 * r))
            part(g, "sphere", pp, (r * ew * 0.72, r * 0.06, r * eh * 0.76), M["pupil"], rot=(0, 0, yaw), outline=0, segments=20, ring_count=10)
        else:
            pp = p + d * (r * 0.02)
            part(g, "sphere", pp, (r * ew, r * 0.08, r * eh), M["pupil"], rot=(0, 0, yaw), outline=0.03, segments=24, ring_count=12)
        hp = pp + d * (r * 0.06) + Vector((-0.07 * r, 0, 0.1 * r))
        part(g, "sphere", hp, (r * 0.075, r * 0.03, r * 0.085), M["eyeWhite"], rot=(0, 0, yaw), outline=0, segments=12, ring_count=6)
        hp2 = pp + d * (r * 0.06) + Vector((0.06 * r, 0, -0.1 * r))
        part(g, "sphere", hp2, (r * 0.035, r * 0.02, r * 0.035), M["eyeWhite"], rot=(0, 0, yaw), outline=0, segments=8, ring_count=4)
        bp, bd = on_head(center, r, (sx * 0.66, -0.72, -0.3), -0.06)
        part(g, "sphere", bp, (r * 0.17, r * 0.05, r * 0.1), M["blush"], rot=(0, 0, yaw_for(bd)), outline=0, segments=16, ring_count=8)
        brow = style.get("brow") or {}
        if sx in brow:
            brp, brd = on_head(center, r, (sx * 0.4, -0.86, ez + eh * 1.25 + 0.04), -0.02)
            part(g, "cube", brp, (r * 0.36, r * 0.07, r * 0.085), M["pupil"], rot=(0, brow[sx], yaw_for(brd)), outline=0, bev=0.03)
    mp, md = on_head(center, r, (0.06, -0.97, -0.4), -0.035)
    if style.get("mouth") == "smirk":
        o = part(g, "torus", mp + Vector((0.05 * r, 0, 0.07 * r)), (r * 0.15, r * 0.15, r * 0.13), M["mouth"],
                 rot=(math.radians(90), math.radians(-14), yaw_for(md)), outline=0, major_radius=1.0, minor_radius=0.2,
                 major_segments=24, minor_segments=8)
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(o.data)
        cz = sum(v.co.z for v in bm.verts) / len(bm.verts)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > cz + 0.01 * r], context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
    else:
        part(g, "sphere", mp, (r * 0.13, r * 0.04, r * 0.032), M["mouth"], rot=(0, math.radians(-4), yaw_for(md)), outline=0, segments=12, ring_count=6)


def star_mesh(name, points=8, r_out=1.0, r_in=0.45, depth=0.06, peak=0.14):
    """Faceted eight-point star: flat base, raised apex so each ray catches light."""
    n = points * 2
    verts = [(0, 0, 0)]
    for i in range(n):
        a = i / n * math.tau + math.pi / 2
        rr = r_out if i % 2 == 0 else r_in
        verts.append((math.cos(a) * rr, math.sin(a) * rr, 0))
    for i in range(n):
        a = i / n * math.tau + math.pi / 2
        rr = (r_out if i % 2 == 0 else r_in) * 0.96
        verts.append((math.cos(a) * rr, math.sin(a) * rr, depth))
    apex = len(verts)
    verts.append((0, 0, depth + peak))
    faces = []
    for i in range(n):
        a, b = 1 + i, 1 + (i + 1) % n
        ta, tb = 1 + n + i, 1 + n + (i + 1) % n
        faces += [(0, b, a), (a, b, tb, ta), (apex, ta, tb)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def shield(g, center, facing_yaw, kind, r=1.2):
    """Round shield with a bevelled rim and domed face.
    Guardian: steel rim, riveted steel ring, blue field, steel boss.
    Bulwark: thick gold rim, ivory dome, raised faceted gold eight-point star."""
    rot = (math.radians(90), 0, facing_yaw)
    R = Euler(rot).to_matrix()
    fwd = R @ Vector((0, 0, 1))
    rim, face = (M["steel"], M["steel"]) if kind == "guardian" else (M["gold"], M["shieldFace"])
    part(g, "cyl", center - fwd * 0.04, (r, r, 0.16), M["steelDark"] if kind == "guardian" else M["goldDeep"], rot=rot, outline=0.05, vertices=40, bev=0.04)
    part(g, "sphere", center + fwd * 0.02, (r * 0.86, r * 0.86, 0.14 if kind == "guardian" else 0.16), face, rot=rot, outline=0, segments=40, ring_count=16)
    part(g, "torus", center + fwd * 0.07, (1, 1, 1), rim, rot=rot, outline=0.035, major_radius=r * 0.9, minor_radius=r * (0.1 if kind == "guardian" else 0.12),
         major_segments=48, minor_segments=12)
    if kind == "guardian":
        part(g, "cyl", center + fwd * 0.2, (r * 0.64, r * 0.64, 0.08), M["blue"], rot=rot, outline=0.02, vertices=40, bev=0.03)
        part(g, "torus", center + fwd * 0.24, (1, 1, 1), M["steelDark"], rot=rot, outline=0.015, major_radius=r * 0.64, minor_radius=0.05, major_segments=40, minor_segments=8)
        part(g, "sphere", center + fwd * 0.26, (r * 0.24, r * 0.24, 0.2), M["steel"], rot=rot, outline=0.03)
        for i in range(10):
            a = i / 10 * math.tau
            off = R @ Vector((math.cos(a) * r * 0.75, math.sin(a) * r * 0.75, 0.11))
            part(g, "sphere", center + off, (0.065, 0.065, 0.05), M["steelDark"], outline=0, segments=8, ring_count=4)
    else:
        o = bpy.data.objects.new(g["name"] + "_star", star_mesh(g["name"] + "_starMesh", 8, r * 0.64, r * 0.25, 0.04, 0.12))
        o.data.materials.append(M["gold"])
        g["coll"].objects.link(o)
        o.location = center + fwd * 0.2
        o.rotation_euler = rot
        C.add_outline(o, 0.02)
        o.parent = g["root"]
        g["parts"].append(o)


def cannon(g, base, yaw, pitch, team):
    """Iron cannon on a gold yoke. Returns the muzzle centre in world space."""
    d = Vector((math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    L = 2.8
    q = d.to_track_quat("Z", "Y").to_euler()
    part(g, "cyl", base + d * (L * 0.45), (0.5, 0.5, L), M["iron"], rot=q, outline=0.04, vertices=20, bev=0.04)
    part(g, "cyl", base + d * (L * 0.95), (0.66, 0.66, 0.36), M["iron"], rot=q, outline=0.04, vertices=20, bev=0.05)
    part(g, "cyl", base + d * (L * 1.1), (0.4, 0.4, 0.02), M["ironDark"], rot=q, outline=0, vertices=20)
    for f in (0.2, 0.62):
        part(g, "cyl", base + d * (L * f), (0.56, 0.56, 0.18), M["gold"], rot=q, outline=0.02, vertices=20)
    part(g, "sphere", base - d * 0.65, (0.52, 0.52, 0.52), M["iron"], outline=0.04)
    gem = M["redGem"] if team == "red" else M["blueGem"]
    part(g, "ico", base + d * (L * 0.62) + Vector((0, 0, 0.5)), (0.16, 0.16, 0.2), gem, outline=0.015, subdivisions=1)
    for sx in (-1, 1):
        side = Vector((math.cos(yaw), -math.sin(yaw), 0)) * sx * 0.62
        part(g, "cube", base + side + Vector((0, 0, -0.35)), (0.16, 0.5, 0.8), M["gold"], rot=(0, 0, -yaw), outline=0.03, bev=0.04)
    return base + d * (L * 1.12)


# ---------------------------------------------------------------- defenders

GUARDIAN_YAW = math.radians(180 + 42)  # rear three-quarter, shield side toward the camera
BULWARK_YAW = math.radians(22)


def guardian(g, aim, pose):
    """Chog Guardian (card 07): sunburst of thick blue spikes around a large cream
    face mask, one angled brow, pink blush and a confident smirk, a thick blue
    scarf, layered silver plate, blue tabard and a riveted steel shield with a
    blue field. Faces north (away from camera) to aim up, so the spike crown,
    scarf tail, pauldrons and shield carry the back-view identity."""
    import random

    rnd = random.Random(707)
    head_c = Vector((0, 0, 3.45))
    r = 1.26
    part(g, "sphere", head_c, (r, r * 0.96, r * 0.94), facemask_material("GuardianHead", "#1d5fe0", "#fbeed6", front_min=0.3, top_max=0.8),
         outline=0.05, segments=48, ring_count=24)
    chog_face(g, head_c, r, {"sclera": False, "spread": 0.37, "eye_z": 0.02, "eye": (0.19, 0.26),
                              "brow": {1: math.radians(-26)}, "mouth": "smirk"})
    # Ring A: broad sunburst framing the face mask, sweeping back.
    n = 9
    for i in range(n):
        th = math.radians(-112 + 224 * i / (n - 1))
        b = Vector((math.sin(th) * 0.8, 0.6, math.cos(th) * 0.8)).normalized()
        dv = Vector((math.sin(th), 0.85, math.cos(th) + 0.2))
        L = r * (1.22 - 0.25 * abs(th) / math.radians(112) + rnd.uniform(-0.05, 0.08))
        spike(g, head_c + b * r * 0.55, dv, L, r * 0.46, M["gSpike"] if i % 2 else M["gSpikeLight"], verts=7, smooth=False)
    # Ring B: rear starburst that gives the back view its spiky silhouette.
    for (x, z) in ((-0.75, 0.55), (0.75, 0.55), (0.0, 0.95), (-0.95, -0.15), (0.95, -0.15), (-0.45, -0.7), (0.45, -0.7), (0.0, -0.45)):
        dv = Vector((x * 1.7, 0.45, z * 1.5 + 0.15)).normalized()
        spike(g, head_c, dv, r * rnd.uniform(1.95, 2.1), r * 0.5, M["gSpikeDeep"] if (x + z) > 0 else M["gSpike"], verts=7, smooth=False)
    # Forelock: the tuft leaning to the viewer's left over the brow.
    for sx, L in ((-0.42, 0.74), (-0.12, 0.86)):
        b = Vector((sx, -0.25, 0.95)).normalized()
        spike(g, head_c + b * r * 0.8, Vector((sx * 1.1 - 0.4, -0.1, 1.0)), r * L, r * 0.32, M["gSpikeLight"], verts=7, smooth=False)
    # Thick blue scarf with a knot in front and a wind-blown tail behind.
    part(g, "torus", Vector((0, 0, 2.3)), (0.86, 0.8, 0.9), M["scarf"], outline=0.035, major_radius=1.0, minor_radius=0.33, major_segments=28, minor_segments=12)
    part(g, "sphere", Vector((0.32, -0.76, 2.16)), (0.28, 0.2, 0.24), M["scarf"], outline=0.03)
    part(g, "cube", Vector((0.36, -0.84, 1.8)), (0.32, 0.1, 0.58), M["scarf"], rot=(math.radians(-6), math.radians(8), 0), outline=0.03, bev=0.05)
    part(g, "cube", Vector((0.3, 0.98, 1.62)), (0.5, 0.12, 1.3), M["scarf"], rot=(math.radians(12), 0, math.radians(8)), outline=0.035, bev=0.06)
    # Segmented silver plate.
    part(g, "sphere", Vector((0, 0, 1.62)), (0.94, 0.8, 0.9), M["steel"], outline=0.04)
    for z, s in ((1.92, 0.86), (1.42, 0.97)):
        part(g, "torus", Vector((0, 0, z)), (s, s * 0.84, 0.6), M["steelDark"], outline=0.015, major_radius=1.0, minor_radius=0.07, major_segments=32, minor_segments=8)
    part(g, "torus", Vector((0, 0, 1.12)), (0.9, 0.78, 0.8), M["leather"], outline=0.02, major_radius=1.0, minor_radius=0.15)
    part(g, "cube", Vector((0, -0.84, 1.12)), (0.26, 0.08, 0.2), M["gold"], outline=0.02, bev=0.03)
    part(g, "cube", Vector((0.62, -0.58, 1.02)), (0.32, 0.22, 0.3), M["leather"], rot=(0, 0, math.radians(-30)), outline=0.025, bev=0.06)
    for yy in (-0.72, 0.72):
        part(g, "cube", Vector((0, yy, 0.78)), (0.5, 0.08, 0.6), M["blue"], outline=0.025, bev=0.03)
    for sx in (-1, 1):
        for k in range(3):
            part(g, "sphere", Vector((sx * (1.02 + 0.09 * k), 0, 2.12 - 0.25 * k)), (0.74 - 0.07 * k, 0.68 - 0.05 * k, 0.44 - 0.05 * k),
                 M["steel"] if k % 2 == 0 else M["steelDark"], outline=0.035)
        part(g, "cyl", Vector((sx * 0.4, 0, 0.42)), (0.31, 0.31, 0.62), M["steelDark"], outline=0.03, vertices=14)
        part(g, "sphere", Vector((sx * 0.4, -0.16, 0.6)), (0.26, 0.2, 0.2), M["steel"], outline=0.025)
        part(g, "sphere", Vector((sx * 0.42, -0.16, 0.08)), (0.42, 0.52, 0.24), M["cream"], outline=0.03)
    # Gauntlet arm reaches to the cannon, the shield arm stays raised.
    part(g, "cyl", Vector((-1.15, -0.35, 1.6)), (0.27, 0.27, 0.8), M["steelDark"], rot=(math.radians(60), 0, 0), outline=0.03, vertices=14)
    part(g, "cyl", Vector((-1.15, -0.62, 1.5)), (0.33, 0.33, 0.28), M["steel"], rot=(math.radians(60), 0, 0), outline=0.03, vertices=14, bev=0.03)
    part(g, "sphere", Vector((-1.15, -0.85, 1.43)), (0.32, 0.32, 0.32), M["cream"], outline=0.03)
    shield(g, Vector((1.42, -0.35, 1.7)), math.radians(100), "guardian", r=1.22)
    g["root"].rotation_euler = (0, 0, GUARDIAN_YAW)


def bulwark(g, aim, pose):
    """Bulwark (commander card 21): dark-brown Chog face framed by a gold
    Corinthian helmet with a V brow and long cheek guards, a tall striped red
    crest on a gold ridge, black spikes fanning out from under the helmet,
    white tunic with gold studs and trim, gold pauldrons and greaves, and a
    large round shield with a raised gold eight-point star. Faces south
    (toward camera) to aim down."""
    import random

    rnd = random.Random(2121)
    head_c = Vector((0, 0, 3.42))
    r = 1.18
    head_start = len(g["parts"])
    # Black spikes fanning back and up from beneath the helmet's back edge.
    n = 11
    for i in range(n):
        a = math.radians(-108 + 216 * i / (n - 1))
        h = Vector((math.sin(a), math.cos(a), 0))
        e = math.radians((0, 30, 14)[i % 3])
        dv = h * math.cos(e) * 1.1 + Vector((0, 0.65, math.sin(e) + 0.3))
        base = head_c + Vector((0, 0, -0.3 + 0.14 * (i % 2))) + h * r * 0.7
        spike(g, base, dv, r * (1.3 + rnd.uniform(-0.08, 0.14) - 0.12 * abs(math.cos(a))), r * 0.46, M["bSpike"] if i % 2 else M["bSpike2"], verts=10)
    part(g, "sphere", head_c, (r, r * 0.95, r * 0.93), M["bSkin"], outline=0.05, segments=48, ring_count=24)
    chog_face(g, head_c, r, {"sclera": True, "spread": 0.42, "eye_z": 0.02, "eye": (0.3, 0.36), "mouth": "flat"})
    # Corinthian helmet: dome with a rectangular face opening and an open nape,
    # leaving long cheek guards that frame the face down past the jaw.
    hc = head_c + Vector((0, 0.04, 0.1))
    helm = part(g, "sphere", hc, (r * 1.1, r * 1.06, r * 1.02), M["gold"], outline=0.05, segments=56, ring_count=28)
    cutters = []
    for nm, loc, sc in (("HelmCutFace", head_c + Vector((0, -1.25, -0.6)), (1.8, 1.5, 2.0)),
                        ("HelmCutNape", head_c + Vector((0, 0.9, -1.28)), (3.2, 2.2, 1.1))):
        cut = C.prim("cube", nm, loc=loc, scale=sc, coll=g["coll"], size=1.0)
        cut.hide_render = True
        cut.visible_camera = False
        cut.visible_shadow = False
        cut.parent = g["root"]
        cutters.append(cut)
        bm = helm.modifiers.new(nm, "BOOLEAN")
        bm.operation = "DIFFERENCE"
        bm.object = cut
        bm.solver = "EXACT"
    for nm in ("HelmCutNape", "HelmCutFace"):
        helm.modifiers.move(helm.modifiers.find(nm), 0)
    # V brow ridge: outer ends high, centre dipping over the eyes for the stern look.
    for sx in (-1, 1):
        part(g, "cube", head_c + Vector((sx * 0.42, -1.16, 0.46)), (0.9, 0.22, 0.2), M["gold"],
             rot=(0, -sx * math.radians(16), sx * 0.32), outline=0.04, bev=0.07)
    # Striped horsehair crest: one smooth band, wider at the outer edge, tallest
    # above the crown, alternating red tones like the card's painted strands.
    R = r * 1.06
    nseg = 26
    verts, faces, fmat = [], [], []
    for i in range(nseg + 1):
        t = i / nseg
        a = math.radians(42 + 132 * t)
        radial = Vector((0, -math.cos(a), math.sin(a)))
        rin = R * 0.9
        rout = R + r * (0.5 + 0.78 * math.sin(math.pi * (0.1 + 0.8 * t)) ** 0.85) + (0.05 * r if i % 2 else 0.0)
        sweep = Vector((0, 0.22 * (rout - rin), 0))
        for rr, w, sw in ((rin, 0.28 * r, Vector()), (rout, 0.5 * r, sweep)):
            for sx in (-1, 1):
                verts.append(hc + radial * rr + Vector((sx * w, 0, 0)) + sw)
    for i in range(nseg):
        b0, b1 = i * 4, (i + 1) * 4
        faces += [(b0 + 0, b0 + 2, b1 + 2, b1 + 0), (b0 + 1, b1 + 1, b1 + 3, b0 + 3), (b0 + 2, b0 + 3, b1 + 3, b1 + 2), (b0 + 0, b1 + 0, b1 + 1, b0 + 1)]
        fmat += [(i // 2) % 2] * 4
    faces += [(0, 1, 3, 2), (nseg * 4, nseg * 4 + 2, nseg * 4 + 3, nseg * 4 + 1)]
    fmat += [0, 0]
    crest = mesh_part(g, "crest", verts, faces, M["bCrest"], outline=0, smooth=True)
    crest.data.materials.append(M["bCrestDeep"])
    for poly, mi in zip(crest.data.polygons, fmat):
        poly.material_index = mi
    import bmesh
    bmc = bmesh.new()
    bmc.from_mesh(crest.data)
    bmesh.ops.recalc_face_normals(bmc, faces=bmc.faces)
    bmc.to_mesh(crest.data)
    bmc.free()
    sub = crest.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    C.add_outline(crest, 0.05)
    for i in range(9):
        t = i / 8
        a = math.radians(40 + 132 * t)
        radial = Vector((0, -math.cos(a), math.sin(a)))
        part(g, "cube", hc + radial * R * 0.99, (0.36, 0.42, 0.22), M["goldDeep"], rot=(-(a - math.pi / 2), 0, 0), outline=0.025, bev=0.05)
    # Lift the head a little so the face reads from the high gameplay camera.
    from mathutils import Matrix
    pivot = Vector((0, 0, 2.4))
    T = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(-14), 4, "X") @ Matrix.Translation(-pivot)
    for o in g["parts"][head_start:] + cutters:
        o.matrix_basis = T @ o.matrix_basis
    # Body: white tunic, gold studs, brown belt with a gold buckle.
    part(g, "sphere", Vector((0, 0, 1.62)), (0.96, 0.8, 0.9), M["bArmor"], outline=0.04)
    part(g, "torus", Vector((0, 0, 2.3)), (0.62, 0.56, 0.7), M["gold"], outline=0.02, major_radius=1.0, minor_radius=0.14)
    for sx in (-1, 1):
        part(g, "sphere", Vector((sx * 0.34, -0.66, 2.06)), (0.14, 0.08, 0.14), M["gold"], outline=0.02, segments=16, ring_count=8)
        part(g, "cube", Vector((sx * 0.3, -0.73, 1.62)), (0.08, 0.06, 0.7), M["gold"], rot=(0, sx * 0.25, 0), outline=0.0, bev=0.02)
    part(g, "torus", Vector((0, 0, 1.15)), (0.9, 0.78, 0.8), M["leather"], outline=0.02, major_radius=1.0, minor_radius=0.15)
    part(g, "sphere", Vector((0, -0.78, 1.15)), (0.22, 0.1, 0.2), M["gold"], outline=0.02)
    part(g, "cone", Vector((0, 0, 0.86)), (0.98, 0.84, 0.56), M["bArmor"], outline=0.035, vertices=24, radius1=1.0, radius2=0.86, depth=1.0)
    part(g, "torus", Vector((0, 0, 0.6)), (0.98, 0.84, 0.6), M["gold"], outline=0.015, major_radius=1.0, minor_radius=0.07, major_segments=32, minor_segments=8)
    part(g, "cube", Vector((0, -0.8, 0.8)), (0.42, 0.08, 0.5), M["bArmor"], outline=0.02, bev=0.03)
    part(g, "cube", Vector((0, -0.85, 0.8)), (0.08, 0.04, 0.46), M["gold"], outline=0.0, bev=0.01)
    for sx in (-1, 1):
        part(g, "sphere", Vector((sx * 1.0, 0, 2.08)), (0.64, 0.62, 0.46), M["gold"], outline=0.04)
        part(g, "torus", Vector((sx * 1.0, 0, 1.92)), (0.6, 0.58, 0.5), M["goldDeep"], outline=0.015, major_radius=1.0, minor_radius=0.12)
        part(g, "cyl", Vector((sx * 0.4, 0, 0.4)), (0.32, 0.32, 0.6), M["gold"], outline=0.03, vertices=14, bev=0.03)
        part(g, "sphere", Vector((sx * 0.42, -0.16, 0.08)), (0.42, 0.52, 0.24), M["bArmor"], outline=0.03)
        part(g, "sphere", Vector((sx * 0.42, -0.42, 0.14)), (0.24, 0.2, 0.16), M["gold"], outline=0.02)
    part(g, "cyl", Vector((1.15, -0.35, 1.6)), (0.26, 0.26, 0.8), M["bArmor"], rot=(math.radians(60), 0, 0), outline=0.03, vertices=12)
    part(g, "torus", Vector((1.15, -0.62, 1.5)), (0.3, 0.3, 0.3), M["gold"], rot=(math.radians(60), 0, 0), outline=0.015, major_radius=1.0, minor_radius=0.22)
    part(g, "sphere", Vector((1.15, -0.84, 1.44)), (0.36, 0.34, 0.34), M["bSkin"], outline=0.03)
    shield(g, Vector((-1.42, -0.62, 1.66)), math.radians(-18), "bulwark", r=1.26)
    g["root"].rotation_euler = (0, 0, BULWARK_YAW)


# ---------------------------------------------------------------- tower

def tower(spec, groups):
    """Chog-world tower: stone block body, gold trim, team banner with crest gem,
    crenellated parapet split into back (base) and front (rim) halves."""
    w, h = spec["w"], spec["h"]
    d = w * 0.9  # footprint depth in world Y, seen foreshortened
    team = spec["team"]
    cloth, cloth_deep, gem = (M["red"], M["redDeep"], M["redGem"]) if team == "red" else (M["blue"], M["blueDeep"], M["blueGem"])
    base, rim = groups["structure-base"], groups["front-rim"]
    # Plinth, body and cap.
    part(base, "cube", Vector((0, 0, 0.35)), (w * 1.08, d * 1.08, 0.7), M["stoneDark"], outline=0.05, bev=0.18)
    part(base, "cube", Vector((0, 0, h / 2)), (w, d, h), M["mortar"], outline=0.05, bev=0.22)
    part(base, "cube", Vector((0, -d * 0.54 - 0.02, 0.74)), (w * 1.04, 0.12, 0.12), M["gold"], outline=0.02, bev=0.03)
    # Stone courses: offset blocks on the front face read as masonry.
    import random

    rnd = random.Random(11 if team == "red" else 12)
    rows = 4
    for ri in range(rows):
        z = 0.9 + ri * (h - 1.6) / rows
        x = -w / 2 + (0.0 if ri % 2 else 0.7)
        while x < w / 2 - 0.4:
            bw = rnd.uniform(1.3, 2.0)
            bw = min(bw, w / 2 - 0.2 - x)
            if bw > 0.5:
                part(base, "cube", Vector((x + bw / 2, -d / 2 - 0.05, z + 0.42)), (bw - 0.16, 0.18, 0.7), rnd.choice((M["blockA"], M["blockB"], M["blockC"])), outline=0.03, bev=0.09)
            x += bw
    # Light corner quoins, alternating long and short, frame the front face.
    qrows = 5
    for k in range(qrows):
        qh = (h - 0.8) / qrows
        z = 0.8 + qh * (k + 0.5)
        qw = 1.0 if k % 2 == 0 else 0.66
        for sx in (-1, 1):
            part(base, "cube", Vector((sx * (w / 2 - qw / 2 + 0.1), -d / 2 - 0.08, z)), (qw, 0.24, qh - 0.1), M["quoin"], outline=0.03, bev=0.08)
    part(base, "cube", Vector((0, 0, h + 0.12)), (w * 1.1, d * 1.1, 0.34), M["gold"], outline=0.04, bev=0.08)
    part(base, "cube", Vector((0, 0, h + 0.32)), (w * 0.98, d * 0.98, 0.1), M["floor"], outline=0, bev=0.02)
    for sx in (-1, 1):
        part(base, "cube", Vector((sx * w * 0.53, -d * 0.53, h + 0.12)), (0.5, 0.5, 0.46), M["goldDeep"], outline=0.03, bev=0.08)
    # Team banner on the front face with a gold frame and crest gem.
    bw, bh = w * 0.42, h * 0.62
    fz = h * 0.52
    part(base, "cube", Vector((0, -d / 2 - 0.16, fz)), (bw + 0.3, 0.12, bh + 0.3), M["gold"], outline=0.04, bev=0.05)
    part(base, "cube", Vector((0, -d / 2 - 0.24, fz + 0.05)), (bw, 0.1, bh), cloth, outline=0.0, bev=0.03)
    part(base, "cone", Vector((0, -d / 2 - 0.24, fz - bh / 2 - 0.25)), (bw / 2, 0.06, 0.6), cloth, rot=(math.radians(-90), math.radians(180), 0), outline=0.03, vertices=3, radius1=1.0, radius2=0, depth=1.0, smooth=False)
    gc = Vector((0, -d / 2 - 0.42, fz + 0.1))
    part(base, "torus", gc + Vector((0, 0.08, 0)), (bw * 0.36, bh * 0.3, bh * 0.3), M["gold"], rot=(math.radians(90), 0, 0), outline=0.025, major_radius=1.0, minor_radius=0.13, major_segments=24, minor_segments=8)
    for sz in (1, -1):
        part(base, "cone", gc + Vector((0, 0, sz * bh * 0.13)), (bw * 0.27, 0.3, bh * 0.26), gem, rot=(0 if sz > 0 else math.pi, 0, 0), outline=0.03, vertices=6, radius1=1.0, radius2=0.0, depth=1.0, smooth=False)
    part(base, "cube", Vector((0, -d / 2 - 0.3, fz + bh / 2 - 0.25)), (bw, 0.08, 0.18), cloth_deep, outline=0, bev=0.02)
    if spec["kind"] == "core":
        # Gold crown above the gem marks the king tower.
        cz = fz + bh * 0.36
        part(base, "cube", Vector((0, -d / 2 - 0.36, cz)), (bw * 0.6, 0.12, 0.22), M["gold"], outline=0.03, bev=0.03)
        for sx in (-1, 0, 1):
            part(base, "cone", Vector((sx * bw * 0.24, -d / 2 - 0.36, cz + 0.3)), (0.16, 0.08, 0.42), M["gold"], outline=0.02, vertices=4, radius1=1, radius2=0, depth=1)
        for sx in (-1, 1):
            for sy in (-1, 1):
                grp = rim if sy < 0 else base
                part(grp, "cyl", Vector((sx * (w / 2 + 0.1), sy * (d / 2 + 0.05), h * 0.62)), (0.85, 0.85, h * 1.24), M["stone2"], outline=0.05, vertices=12, bev=0.1)
                part(grp, "cone", Vector((sx * (w / 2 + 0.1), sy * (d / 2 + 0.05), h * 1.24 + 0.55)), (1.0, 1.0, 1.1), cloth, outline=0.04, vertices=12, radius1=1, radius2=0, depth=1)
                part(grp, "ico", Vector((sx * (w / 2 + 0.1), sy * (d / 2 + 0.05), h * 1.24 + 1.2)), (0.14, 0.14, 0.18), M["gold"], outline=0.015, subdivisions=1)
    # Crenellations: back and side merlons behind the defender, front ones in the rim.
    mz = h + 0.75
    n = 4
    for i in range(n):
        x = -w / 2 + 0.55 + i * (w - 1.1) / (n - 1)
        part(base, "cube", Vector((x, d / 2 - 0.4, mz)), (0.95, 0.75, 0.95), M["stone2"], outline=0.04, bev=0.1)
        part(rim, "cube", Vector((x, -d / 2 + 0.4, mz - 0.1)), (0.95, 0.75, 0.75), M["stone2"], outline=0.04, bev=0.1)
    for sx in (-1, 1):
        part(base, "cube", Vector((sx * (w / 2 - 0.4), 0.15, mz)), (0.75, 0.9, 0.95), M["stone2"], outline=0.04, bev=0.1)
    part(rim, "cube", Vector((0, -d / 2 + 0.4, h + 0.42)), (w * 0.96, 0.5, 0.2), M["gold"], outline=0.03, bev=0.04)
    # Small corner pennants in team colour on the back merlons.
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.55)
        part(base, "cyl", Vector((x, d / 2 - 0.4, mz + 1.4)), (0.07, 0.07, 1.9), M["wood"], outline=0.02, vertices=8)
        part(base, "cube", Vector((x + sx * 0.5, d / 2 - 0.4, mz + 1.95)), (0.9, 0.05, 0.6), cloth, outline=0.03, bev=0.02)
    return h + 0.32


# ---------------------------------------------------------------- render

def build_role(role, spec):
    C.reset_scene()
    C._mats.clear()
    M.clear()
    mats()
    if os.environ.get("LOWQ"):
        bpy.context.scene.eevee.taa_render_samples = 16
    C.setup_world(0.8)
    C.setup_sun(3.4)
    cam = C.mount_camera(PX, (512, 640), PIVOT)
    parts = {}
    for key in ("structure-base", "socket-platform", "front-rim"):
        parts[key] = new_group(f"{role}_{key}", C.collection(key))
    top = tower(spec, parts)

    sock = parts["socket-platform"]
    part(sock, "cyl", Vector((1.55, -0.3, top + 0.18)), (1.25, 1.25, 0.3), M["iron"], outline=0.04, vertices=24, bev=0.06)
    part(sock, "torus", Vector((1.55, -0.3, top + 0.34)), (1.25, 1.25, 1.2), M["gold"], outline=0.02, major_radius=1.0, minor_radius=0.09)

    defenders = {}
    anchors = {}
    for pose in ("idle", spec["aim"]):
        g = new_group(f"{role}_defender-{pose}", C.collection(f"defender-{pose}"))
        (bulwark if spec["defender"] == "bulwark" else guardian)(g, spec["aim"], pose)
        g["root"].scale = (spec["scale"],) * 3
        g["root"].location = (0, 0.35 if spec["aim"] == "aim-south" else -0.1, top)
        yaw = 0.0 if spec["aim"] == "aim-north" else math.pi
        pitch = {"idle": math.radians(18), "aim-south": math.radians(-24), "aim-north": math.radians(12)}[pose]
        cb = Vector((1.75 if spec["aim"] == "aim-south" else 2.0, -0.6 if spec["aim"] == "aim-south" else 0.2, top + 1.9))
        # The cannon is authored in world space under an untransformed root so
        # the character's turn and scale never move the measured muzzle.
        cg = {"name": g["name"] + "_cannon", "root": bpy.data.objects.new(g["name"] + "_cannon_root", None), "coll": g["coll"], "parts": g["parts"]}
        g["coll"].objects.link(cg["root"])
        muzzle = cannon(cg, cb, -yaw if yaw else 0.0, pitch, spec["team"])
        defenders[pose] = g
        anchors[pose] = muzzle
    bpy.context.view_layer.update()

    out_dir = os.path.join(OUT, role)
    os.makedirs(out_dir, exist_ok=True)
    groups = {**{k: v for k, v in parts.items()}, **{f"defender-{p}": g for p, g in defenders.items()}}
    record = {"role": role, **spec, "pxPerUnit": PX, "canvas": [512, 640], "pivot": list(PIVOT), "parts": {}, "poses": {}}
    active_pose = spec["aim"]
    for key, g in groups.items():
        for k2, g2 in groups.items():
            is_pose = k2.startswith("defender-")
            for o in g2["parts"]:
                o.visible_camera = k2 == key
                # Only the pose being drawn (or the aim pose, for static parts) casts shadows.
                o.visible_shadow = (not is_pose) or k2 == key or (not key.startswith("defender-") and k2 == f"defender-{active_pose}")
                o.hide_render = False
        path = os.path.join(out_dir, f"{key}.png")
        C.render_to(path)
        record["parts" if not key.startswith("defender-") else "poses"][key] = os.path.relpath(path, OUT).replace("\\", "/")
    for pose, mz in anchors.items():
        px, py = C.project(cam, mz)
        record.setdefault("weapon", {})[pose] = {
            "world": [round(v, 4) for v in mz],
            "masterPixels": [round(px, 3), round(py, 3)],
            "weaponAnchorLocalBoardPixels": [round((px - PIVOT[0]) / 2, 3), round((py - PIVOT[1]) / 2, 3)],
        }
    # Identity check: the same aim-pose model turned to a front three-quarter
    # view on a plain card-style backdrop, compared against the original card.
    g = defenders[spec["aim"]]
    for k2, g2 in groups.items():
        for o in g2["parts"]:
            o.visible_camera = g2 is g
            o.visible_shadow = g2 is g
    saved = (tuple(g["root"].rotation_euler), tuple(g["root"].location))
    g["root"].rotation_euler = (0, 0, math.radians(-20 if spec["defender"] == "guardian" else 20))
    g["root"].location = (0, 0, 0)
    for o in g["parts"]:
        if "_cannon" in o.name:
            o.hide_render = True
    idc = bpy.data.cameras.new("IdCam")
    idc.type = "ORTHO"
    idc.ortho_scale = 7.6 * spec["scale"]
    ido = bpy.data.objects.new("IdCam", idc)
    bpy.context.scene.collection.objects.link(ido)
    ido.rotation_euler = (math.radians(78), 0, 0)
    look = Vector((0, 0, 2.6 * spec["scale"]))
    ido.location = look - Vector((0, math.sin(math.radians(78)), -math.cos(math.radians(78)))) * 60
    sc = bpy.context.scene
    sc.camera = ido
    sc.render.resolution_x, sc.render.resolution_y = 384, 512
    C.render_to(os.path.join(out_dir, f"identity-{spec['defender']}.png"))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 512, 640
    g["root"].rotation_euler, g["root"].location = saved
    gp = C.project(cam, Vector((0, 0, 0)))
    record["groundAnchorCheck"] = [round(gp[0], 3), round(gp[1], 3)]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{role}.blend"))
    return record


def preview(which):
    """Cheap identity loop: defender only, 16 samples, front identity view plus the
    gameplay-angle view used on the tower (back view for the Guardian)."""
    for name in which:
        C.reset_scene()
        C._mats.clear()
        M.clear()
        mats()
        sc = bpy.context.scene
        sc.eevee.taa_render_samples = 16
        C.setup_world(0.8)
        C.setup_sun(3.4)
        g = new_group(f"pv_{name}", C.collection("pv"))
        (bulwark if name == "bulwark" else guardian)(g, None, "aim")
        s = 1.5
        g["root"].scale = (s, s, s)
        game_yaw = tuple(g["root"].rotation_euler)
        C.ortho_camera("GameCam", Vector((0, 0, 3.9)), 10.5, 320, 400)
        C.render_to(os.path.join(OUT, f"{name}-game.png"))
        g["root"].rotation_euler = (0, 0, math.radians(-20 if name == "guardian" else 20))
        idc = bpy.data.cameras.new("IdCam")
        idc.type = "ORTHO"
        idc.ortho_scale = 7.6 * s
        ido = bpy.data.objects.new("IdCam", idc)
        sc.collection.objects.link(ido)
        ido.rotation_euler = (math.radians(78), 0, 0)
        look = Vector((0, 0, 2.6 * s))
        ido.location = look - Vector((0, math.sin(math.radians(78)), -math.cos(math.radians(78)))) * 60
        sc.camera = ido
        sc.render.resolution_x, sc.render.resolution_y = 384, 512
        C.render_to(os.path.join(OUT, f"{name}-front.png"))
        g["root"].rotation_euler = game_yaw


os.makedirs(OUT, exist_ok=True)
if os.environ.get("PREVIEW"):
    preview(sorted(ONLY) or ["bulwark", "guardian"])
    sys.exit(0)
records = []
for role, spec in ROLES.items():
    if ONLY and role not in ONLY:
        continue
    records.append(build_role(role, spec))
    print("role done", role, json.dumps(records[-1]["weapon"]))
rec_path = os.path.join(OUT, "_mounts-record.json")
if ONLY and os.path.exists(rec_path):
    # Partial rebuild: keep the other roles' records, replace the rebuilt ones in ROLES order.
    with open(rec_path) as f:
        old = {r["role"]: r for r in json.load(f)}
    old.update({r["role"]: r for r in records})
    records = [old[k] for k in ROLES if k in old]
with open(rec_path, "w") as f:
    json.dump(records, f, indent=1)
