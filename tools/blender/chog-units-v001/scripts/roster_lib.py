"""Shared builders for the Slice 4 roster (build_roster.py): materials,
lathe/tube/ribbon/crystal/slab geometry, the Chog base body and head, the
generalised spike fan and reusable clip generators. Imports build_units.py
for the rig, pose, face, camera and render loop.
"""
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_units as U  # noqa: E402

C = U.C
M = U.M
part, capsule, bind, apply_tf, outline = U.part, U.capsule, U.bind, U.apply_tf, U.outline
TAU = math.tau
V = Vector


def blade(rig, pivot, *a, sets=None, **kw):
    """build_units.blade() plus visibility-set membership."""
    o = U.blade(rig, pivot, *a, **kw)
    for s in sets or ():
        rig["sets"].setdefault(s, []).append(o)
    return o


# ---------------------------------------------------------------- materials

def mat(name, hexc, **kw):
    return C.mat(name, hexc, **kw)


def lava_mat(name, rock="#2a2227", glow="#ff7417", scale=2.2, width=0.07, strength=7.0, rough=0.72):
    """Dark rock with glowing molten cracks along Voronoi cell edges."""
    if name in C._mats:
        return C._mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = width
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    nt.links.new(vor.outputs["Distance"], mr.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(mr.outputs["Result"], mix.inputs["Factor"])
    mix.inputs["A"].default_value = C.hexc(rock)
    mix.inputs["B"].default_value = C.hexc(glow)
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Emission Color"].default_value = C.hexc(glow)
    em = nt.nodes.new("ShaderNodeMath")
    em.operation = "MULTIPLY"
    em.inputs[1].default_value = strength
    nt.links.new(mr.outputs["Result"], em.inputs[0])
    nt.links.new(em.outputs[0], b.inputs["Emission Strength"])
    b.inputs["Roughness"].default_value = rough
    C._mats[name] = m
    return m


def glow_mat(name, color, emit, strength=1.5, alpha=0.6):
    """Translucent glowing membrane (Rift Sprite wings)."""
    m = mat(name, color, rough=0.25, emit=emit, emit_strength=strength, spec=0.6)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Alpha"].default_value = alpha
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    else:
        m.blend_method = "BLEND"
    return m


# ---------------------------------------------------------------- geometry

def finish(rig, pivot, o, ol=0.04, bev=None, sets=None, flat=False, solid=None):
    apply_tf(o)
    if solid:
        s = o.modifiers.new("Solid", "SOLIDIFY")
        s.thickness = solid
        s.offset = 0.0
    if bev:
        C.bevel(o, bev, 2)
    for p in o.data.polygons:
        p.use_smooth = not flat
    outline(o, ol)
    bind(rig, pivot, o)
    for s in sets or ():
        rig["sets"].setdefault(s, []).append(o)
    return o


def frame_for(axis):
    z = V(axis).normalized()
    return U.orient(z, (0, 1, 0) if abs(z.z) > 0.9 else (0, 0, 1))


def placed(o, origin, rot3):
    o.matrix_world = Matrix.Translation(V(origin)) @ rot3.to_4x4()
    return o


def lathe(rig, pivot, prof, material, origin=(0, 0, 0), axis=(0, 0, 1), sy=0.9, sx=1.0, segs=28, ol=0.04, sets=None, cap=(False, False), bev=None, arc=None):
    """Surface of revolution from (radius, height) pairs listed bottom to top:
    tunics, robes, boots, belts, bracers, pauldrons. `arc` = (a0, a1) radians
    (0 = front) sweeps only part of the way round, for open collars."""
    vs, fs = [], []
    ring = segs + 1 if arc else segs
    for rr, z in prof:
        for k in range(ring):
            a = arc[0] + (arc[1] - arc[0]) * k / segs if arc else k / segs * TAU
            vs.append((math.sin(a) * rr * sx, -math.cos(a) * rr * sy, z))
    n = len(prof)
    for i in range(n - 1):
        for k in range(segs):
            a, b = i * ring + k, i * ring + (k + 1) % ring
            fs.append([a, b, b + ring, a + ring])
    if arc:
        o = placed(C.new_mesh_obj(f"{pivot}_lathe", vs, fs, material), origin, frame_for(axis))
        return finish(rig, pivot, o, ol, bev, sets, solid=0.05)
    if cap[0]:
        fs.append(list(range(segs))[::-1])
    if cap[1]:
        fs.append(list(range((n - 1) * segs, n * segs)))
    o = placed(C.new_mesh_obj(f"{pivot}_lathe", vs, fs, material), origin, frame_for(axis))
    return finish(rig, pivot, o, ol, bev, sets)


def band(rig, pivot, p0, p1, r, material, ol=0.03, sets=None, segs=20, flare=1.0):
    """Short cylindrical sleeve around a limb segment (wraps, bracers, boots)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    return lathe(rig, pivot, [(r, 0.0), (r * 1.04, d.length * 0.5), (r * flare, d.length)], material, origin=p0, axis=d,
                 sy=1.0, segs=segs, ol=ol, sets=sets, cap=(True, True))


def tube(rig, pivot, pts, radii, material, segs=12, ol=0.035, sets=None, flat=False):
    """Swept tube along a polyline with per-point radius: bows, staffs, handles."""
    P = [V(p) for p in pts]
    R = [radii] * len(P) if isinstance(radii, (int, float)) else list(radii)
    T = [(P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized() for i in range(len(P))]
    n = T[0].orthogonal().normalized()
    vs, fs = [], []
    for i, p in enumerate(P):
        if i:
            n = (T[i - 1].rotation_difference(T[i]) @ n).normalized()
        b = T[i].cross(n)
        for k in range(segs):
            a = k / segs * TAU
            vs.append(tuple(p + (n * math.cos(a) + b * math.sin(a)) * max(R[i], 1e-4)))
    m = len(P)
    for i in range(m - 1):
        for k in range(segs):
            a0, a1 = i * segs + k, i * segs + (k + 1) % segs
            fs.append([a0, a1, a1 + segs, a0 + segs])
    fs.append(list(range(segs))[::-1])
    fs.append(list(range((m - 1) * segs, m * segs)))
    o = C.new_mesh_obj(f"{pivot}_tube", vs, fs, material)
    return finish(rig, pivot, o, ol, None, sets, flat)


def ribbon(rig, pivot, pts, widths, side, material, thick=0.07, ol=0.03, sets=None):
    """Thick cloth strip along a polyline: scarf tails, capes, straps."""
    P = [V(p) for p in pts]
    S = [V(s).normalized() for s in side] if isinstance(side, list) else [V(side).normalized()] * len(P)
    W = [widths] * len(P) if isinstance(widths, (int, float)) else widths
    vs, fs = [], []
    for p, s, w in zip(P, S, W):
        vs += [tuple(p - s * w / 2), tuple(p + s * w / 2)]
    for i in range(len(P) - 1):
        fs.append([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])
    o = C.new_mesh_obj(f"{pivot}_ribbon", vs, fs, material)
    return finish(rig, pivot, o, ol, None, sets, solid=thick)


def crystal(rig, pivot, base, dirv, L, rad, material, ol=0.035, sets=None, sides=6, twist=0.0, shatter=None):
    """Hexagonal ice crystal: prism body, pointed tip, flat facets."""
    ring = [(math.cos(k / sides * TAU + twist), math.sin(k / sides * TAU + twist)) for k in range(sides)]
    vs = [(c * rad * 0.72, s * rad * 0.72, 0.0) for c, s in ring] + [(c * rad, s * rad, L * 0.6) for c, s in ring] + [(0.0, 0.0, L)]
    fs = [list(range(sides))[::-1]]
    fs += [[k, (k + 1) % sides, sides + (k + 1) % sides, sides + k] for k in range(sides)]
    fs += [[sides + k, sides + (k + 1) % sides, 2 * sides] for k in range(sides)]
    o = placed(C.new_mesh_obj(f"{pivot}_crystal", vs, fs, material), base, frame_for(dirv))
    o = finish(rig, pivot, o, ol, None, sets, flat=True)
    if shatter is not None:
        out = o.matrix_world.translation - V(shatter)
        out.z = abs(out.z) * 0.3 + 0.25
        rig["stones"].append((o, o.location.copy(), out.normalized() * 0.9))
    return o


def slab(rig, pivot, outline2d, thick, center, normal, up, material, ol=0.045, sets=None, inset=0.82, bev=0.04, flat=True):
    """Extruded 2D outline (shield faces, plates), front face inset for a
    chiselled edge. outline2d is (x, y) in the slab plane, y toward `up`."""
    n = len(outline2d)
    vs = [(x, y, -thick / 2) for x, y in outline2d] + [(x * inset, y * inset, thick / 2) for x, y in outline2d]
    fs = [list(range(n))[::-1], list(range(n, 2 * n))]
    fs += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    o = placed(C.new_mesh_obj(f"{pivot}_slab", vs, fs, material), center, U.orient(normal, up))
    return finish(rig, pivot, o, ol, bev, sets, flat=flat)


def ice_chunk(rig, pivot, center, size, rnd, rot=(0, 0, 0), material=None, ol=0.04, shatter=None, taper=0.22, sets=None):
    """Faceted crystal block (Slice 4.1 Frostshell armour): a subdivided box
    with jittered, tapered corners, a small bevel and flat shading."""
    import bmesh

    o = C.prim("cube", f"{pivot}_ice", loc=center, scale=size, rot=rot, material=material, smooth=False, size=1.0)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    tx, ty = rnd.uniform(-taper, taper), rnd.uniform(-taper, taper)
    for vt in bm.verts:
        vt.co.x *= 1 + tx * vt.co.z * 2
        vt.co.y *= 1 + ty * vt.co.z * 2
        vt.co += V((rnd.uniform(-0.09, 0.09), rnd.uniform(-0.09, 0.09), rnd.uniform(-0.08, 0.08)))
    bm.to_mesh(o.data)
    bm.free()
    o = finish(rig, pivot, o, ol, min(size) * 0.1, sets, flat=True)
    if shatter is not None:
        out = o.matrix_world.translation - V(shatter)
        out.z = abs(out.z) * 0.3 + 0.25
        rig["stones"].append((o, o.location.copy(), out.normalized() * 0.9))
    return o


def gem_slab(rig, pivot, outline2d, thick, center, normal, up, mats, inner=0.58, dome=0.22, ol=0.05, sets=None):
    """Faceted crystal face (Slice 4.1 Frostshell shield): the outline extruded
    back by `thick`, the front rising in two facet rings to a centre apex.
    Facets alternate between the given materials under flat shading."""
    n = len(outline2d)
    vs = [(x, y, -thick) for x, y in outline2d] + [(x, y, 0.0) for x, y in outline2d]
    vs += [(x * inner, y * inner, dome * 0.7) for x, y in outline2d] + [(0.0, 0.0, dome)]
    fs = [list(range(n))[::-1]]
    fs += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    facets = [[n + i, n + (i + 1) % n, 2 * n + (i + 1) % n, 2 * n + i] for i in range(n)]
    facets += [[2 * n + i, 2 * n + (i + 1) % n, 3 * n] for i in range(n)]
    o = placed(C.new_mesh_obj(f"{pivot}_gem", vs, fs + facets, mats[0]), center, U.orient(normal, up))
    for mm in mats[1:]:
        o.data.materials.append(mm)
    for i, p in enumerate(o.data.polygons):
        if i > n:
            j = i - n - 1
            p.material_index = (j + (j // n)) % len(mats)
    return finish(rig, pivot, o, ol, None, sets, flat=True)


def add_offset(clips, **deltas):
    """Add a constant pose offset (a stance lean) to every frame of every
    clip, on top of whatever the frame sets. Frame counts and timing are
    untouched."""
    for cd in clips.values():
        for f in cd["frames"]:
            for kk, dv in deltas.items():
                f[kk] = tuple(a + b for a, b in zip(f.get(kk, (0, 0, 0)), dv))
    return clips


def poly(rig, pivot, pts, material, ol=0.03, sets=None, solid=0.04, flat=False):
    """Flat fan polygon from 3D points, first point the fan centre (wing membranes)."""
    P = [tuple(V(p)) for p in pts]
    o = C.new_mesh_obj(f"{pivot}_poly", P, [[0, i, i + 1] for i in range(1, len(P) - 1)], material)
    return finish(rig, pivot, o, ol, None, sets, flat=flat, solid=solid)


# ---------------------------------------------------------------- Chog base

def joints(hc=(0, 0, 3.2), sh=(0.6, 0, 1.88), leg=(0.34, 0, 0.95), hips=1.02, neck=2.15, extra=None):
    j = {
        "root": ("yaw", (0, 0, 0)),
        "hips": ("root", (0, 0, hips)),
        "head": ("hips", (0, 0, neck)),
        "spikes": ("head", tuple(hc)),
        "armL": ("hips", (-sh[0], sh[1], sh[2])),
        "armR": ("hips", tuple(sh)),
        "legL": ("root", (-leg[0], leg[1], leg[2])),
        "legR": ("root", tuple(leg)),
    }
    j.update(extra or {})
    return j


def spike_fan(rig, hc, r, rnd, mats, arc=135, n=9, k=1.0, tilt=16, rear=7, scalp=True, sweep=0.0, wid=0.6, ring2=None, rear_mats=None, pivot="spikes", verts=16, smooth=True, thick=1.0):
    """Card spike silhouette generalised from Slice 3.1's sunburst(): broad
    soft blades behind the face over `arc` degrees each side of the top, an
    offset second ring, a backswept rear fan and scalp blades. `sweep` tips
    every blade backward for a streamlined crest. Few `verts` with
    smooth=False turns the blades into faceted shards and `thick` fattens
    them (Frostshell ice)."""
    light, mid, deep = mats

    def blade(*a, **kw):
        kw["verts"] = verts
        kw["flat"] = min(1.0, kw.get("flat", 0.45) * thick)
        return globals()["blade"](*a, smooth=smooth, **kw)
    r2 = ring2 or (mid, deep)
    rl = rear_mats or (deep, mid)
    t = math.radians(tilt)
    nrm = V((0, -math.cos(t), math.sin(t)))
    back = -nrm
    u = V((1, 0, 0))
    v = nrm.cross(u).normalized() * -1
    if v.z < 0:
        v = -v

    def d(th):
        return u * math.sin(th) + v * math.cos(th)

    for i in range(n):
        th = math.radians(-arc + 2 * arc * i / (n - 1))
        side = max(0.0, abs(math.degrees(th)) - 90) / max(1, arc - 90)
        L = k * r * (1.2 + rnd.uniform(-0.05, 0.12)) * (1 - 0.3 * side)
        blade(rig, pivot, hc + back * (0.02 * r) + d(th) * (0.55 * r), d(th) + back * (0.2 + sweep), L, r * wid,
              light if i % 2 else mid, nrm, flat=0.34, ol=0.05, verts=16)
    for i in range(n):
        th = math.radians(-arc - 8 + (2 * arc + 16) * (i + 0.5) / n)
        side = max(0.0, abs(math.degrees(th)) - 95) / max(1, arc - 85)
        L = k * r * (1.3 + rnd.uniform(-0.05, 0.1)) * (1 - 0.3 * side)
        blade(rig, pivot, hc + back * (0.35 * r) + d(th) * (0.45 * r), d(th) + back * (0.45 + sweep), L, r * wid,
              r2[i % 2], nrm, flat=0.4, ol=0.05, verts=16)
    for i in range(rear):
        th = math.radians(-150 + 300 * i / max(1, rear - 1))
        tang = u * math.cos(th) - v * math.sin(th)
        blade(rig, pivot, hc + back * (0.3 * r), back * (1 + sweep) + d(th) * 0.9, k * r * (1.05 + rnd.uniform(-0.05, 0.08)), r * 0.5,
              rl[i % 2], tang, flat=0.55, ol=0.05, verts=16)
    blade(rig, pivot, hc + back * (0.3 * r), back + v * 0.3, k * r * 1.05, r * 0.5, rl[1], u, flat=0.55, ol=0.05, verts=16)
    for x, kk in ((-0.42, 0.9), (0.0, 1.0), (0.42, 0.9)) if scalp else ():
        dv = v * 1.0 + back * (0.55 + sweep) + u * x
        blade(rig, pivot, hc + (v * 0.55 + back * 0.05 + u * x * 0.5) * r, dv, k * r * 0.78 * kk, r * 0.5, light if x else mid, nrm, flat=0.4, ol=0.05, verts=16)
    return nrm, v, back


def head_frame(tilt=16):
    t = math.radians(tilt)
    nrm = V((0, -math.cos(t), math.sin(t)))
    u = V((1, 0, 0))
    v = nrm.cross(u).normalized() * -1
    if v.z < 0:
        v = -v
    return u, v, -nrm


def chog_head(rig, P):
    hc, r = V(P["hc"]), P["r"]
    part(rig, "head", "sphere", hc, (r, r * 0.84, r * 0.97),
         U.facemask_material(P["name"] + "Head", P["spike_hex"], "#ffeacb", front_min=0.3, top_max=P.get("top_max", 0.86)),
         ol=0.06, segments=48, ring_count=24)
    U.chog_face(rig, "head", hc, r, P.get("face", {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(28), "blush": 0.21, "mouth_tilt": -10}))


def chog_legs(rig, P, boots=None):
    cream = M["cream"]
    for sx, key in ((-1, "legL"), (1, "legR")):
        x = sx * P.get("leg_x", 0.34)
        fx, fy = P.get("feet", {}).get(key, (x * 1.08, -0.02))
        lr = P.get("leg_r", 0.23)
        capsule(rig, key, (x, 0, 0.95), (fx, fy, 0.3), lr, cream, r1=lr * 0.95)
        part(rig, key, "sphere", (fx, fy - 0.15, 0.16), (0.35, 0.48, 0.19), cream, ol=0.05)
        for kk in (-1, 0, 1):
            part(rig, key, "sphere", (fx + kk * 0.15, fy - 0.57, 0.14), (0.115, 0.115, 0.105), cream, ol=0.03)
        if boots:
            band(rig, key, (fx, fy, 0.24), (x + (fx - x) * 0.45, fy * 0.5, 0.66), lr + 0.06, boots, ol=0.035, flare=1.08)


def chog_arm(rig, key, sh, hand, elbow=None, r=0.18, mitten=True, material=None):
    material = material or M["cream"]
    sh, hand = V(sh), V(hand)
    if elbow:
        capsule(rig, key, sh, elbow, r, material, r1=r * 0.96)
        capsule(rig, key, elbow, hand, r * 0.96, material, r1=r * 0.92)
    else:
        capsule(rig, key, sh, hand, r, material, r1=r * 0.94)
    if mitten:
        part(rig, key, "sphere", hand + V((0, -0.02, -0.04)), (0.24, 0.23, 0.23), M["cream"], ol=0.05)


def chog_body(rig, P):
    part(rig, "hips", "sphere", (0, 0, P.get("body_z", 1.5)), P.get("body", (0.68, 0.6, 0.8)), M["cream"], ol=0.055, segments=32, ring_count=16)


# ---------------------------------------------------------------- clips

SHUT = {"eyes_default": False, "eyes_closed": True}
lunge, lean = U.lunge, U.lean


def merge(a, b):
    out = dict(a)
    for kk, vv in (b or {}).items():
        out[kk] = {**out.get("show", {}), **vv} if kk == "show" else vv
    return out


def idle_clip(n=6, fps=8, bob=0.04, sway=0.06, base=None, extra=None):
    f = []
    for i in range(n):
        t = i / n * TAU
        s = math.sin(t)
        d = {"hips_loc": (0, 0, bob * s), "root_scale": (1 - 0.02 * s, 1 - 0.02 * s, 1 + 0.025 * s),
             "head_rot": (0.04 * math.sin(t + 0.8), 0.05 * s, 0), "spikes_rot": (-0.03 * math.sin(t + 1.4), 0, 0),
             "armL_rot": (sway * s, 0, 0), "armR_rot": (-sway * s, 0, 0)}
        f.append(merge(merge(base or {}, d), extra(t, s) if extra else None))
    return {"fps": fps, "loop": True, "frames": f}


def walk_clip(n=8, fps=12, stride=0.75, bounce=0.3, tilt=0.18, arms=0.7, base=None, extra=None):
    f = []
    for i in range(n):
        t = i / n * TAU
        s, c2 = math.sin(t), math.cos(2 * t)
        d = {"root_loc": (0, 0, bounce * abs(s)), "root_rot": (tilt, 0, 0.04 * s),
             "root_scale": (1 + 0.04 * c2, 1 + 0.04 * c2, 1 - 0.06 * c2),
             "legL_rot": (-stride * s, 0, 0), "legR_rot": (stride * s, 0, 0),
             "armL_rot": (arms * s, 0.2, 0), "armR_rot": (-arms * s, -0.2, 0),
             "head_rot": (0.06 * c2, 0, -0.05 * s), "spikes_rot": (-0.08 * c2, 0, 0)}
        f.append(merge(merge(base or {}, d), extra(t, s) if extra else None))
    return {"fps": fps, "loop": True, "frames": f}


def fly_clip(n=6, fps=12, hover=0.9, bob=0.18, flap=0.8, tilt=0.0, bias=0.0, base=None, extra=None):
    """Hover or flight loop: the body floats over the ground pivot and the
    wings beat once per loop, the downstroke lifting the body."""
    f = []
    for i in range(n):
        t = i / n * TAU
        s, c = math.sin(t), math.cos(t)
        d = {"root_loc": (0, 0, hover + bob * s), "root_rot": (tilt, 0, 0.03 * s),
             "wingL_rot": (0, bias + flap * c, 0), "wingR_rot": (0, -bias - flap * c, 0),
             "legL_rot": (0.25 + 0.1 * s, 0, 0), "legR_rot": (0.2 + 0.1 * math.sin(t + 0.6), 0, 0),
             "armL_rot": (0.1 * s, 0.25, 0), "armR_rot": (-0.1 * s, -0.25, 0),
             "head_rot": (0.04 * math.sin(t + 0.8), 0, 0), "spikes_rot": (-0.04 * c, 0, 0)}
        f.append(merge(merge(base or {}, d), extra(t, s) if extra else None))
    return {"fps": fps, "loop": True, "frames": f}


def hit_clip(base=None, n=3, fps=14, k=1.0):
    frames = [
        {"root_loc": lunge(-0.4 * k, 0.1), "root_rot": lean(-0.32 * k, 0.08), "root_scale": (1.06, 1.06, 0.92), "head_rot": (-0.14, 0, 0.1), "show": SHUT},
        {"root_loc": lunge(-0.28 * k), "root_rot": lean(-0.18 * k, 0.04), "show": SHUT},
        {"root_loc": lunge(-0.1 * k), "root_rot": lean(-0.06 * k)},
        {"root_rot": lean(0.02)},
    ][:n]
    out = []
    for f in frames:
        g = merge(base or {}, f)
        if base and "root_loc" in base and "root_loc" in f:
            g["root_loc"] = tuple(a + b for a, b in zip(base["root_loc"], f["root_loc"]))
        out.append(g)
    return {"fps": fps, "loop": False, "frames": out}


def topple_clip(base=None, fps=12, hover=0.0, crumble=False, spin=0.0):
    """Knock-out: recoil, eyes shut, topple back and sink. Fliers drop from
    their hover height. Crystal units shatter (rig stones fly out)."""
    seq = ((0.0, -0.2, 0.0, 1.0), (0.15, -0.35, 0.1, 1.0), (0.35, -0.6, 0.0, 1.0), (0.6, -0.9, -0.25, 0.98),
           (0.8, -1.1, -0.45, 0.95), (0.92, -1.2, -0.55, 0.9), (1.0, -1.22, -0.6, 0.84))
    f = []
    for p, tilt, z, sc in seq:
        h = hover * (1 - p) ** 1.6
        d = {"root_loc": (0, 0.25 * p, h + z * 0.6 + (0.25 * math.sin(p * math.pi) if hover == 0 else 0)),
             "root_rot": (tilt * 0.55, 0, 0), "yaw": spin * p, "root_scale": sc,
             "armL_rot": (-0.4 * p, 0.9 * p, 0), "armR_rot": (-0.4 * p, -0.9 * p, 0),
             "legL_rot": (-0.5 * p, 0, 0), "legR_rot": (-0.3 * p, 0, 0),
             "head_rot": (-0.25 * p, 0, 0.1 * p), "show": SHUT}
        if crumble:
            d["crumble"] = max(0.0, (p - 0.3) * 1.6)
        f.append(merge(base or {}, d))
    return {"fps": fps, "loop": False, "frames": f}
