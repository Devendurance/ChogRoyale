"""Final asset characters: the five commander classes and the spawned Burrow
Scrapper, built with roster_lib on the Slice 4 rig (imported by
build_final.py, which runs them with the buildings).

Each commander is a class template shared by every commander of the class,
translated from the original class card, never a specific NFT's traits:
  Bulwark  dark-brown Chog face in a gold Corinthian helmet with a tall red
           crest, black spikes, white and gold armour, round gold-star shield.
  Reaver   red skull face with black X eyes and a stitched grin, purple bucket
           hat with a white skull mark, black spikes, dark wraps, tattered
           dark-red cape, curved red-black dagger.
  Deadeye  cream face behind a rainbow visor, pink blush and a smile, big
           purple spikes, purple tactical hoodie and pouches, glowing magenta
           bow and a pink-fletched quiver.
  Scout    grey bucket hat, red hair, big round glasses, small round mouth,
           black tracksuit with white stripes, black and white sneakers.
  Warden   dark-brown Chog face with a pink bubblegum bubble, star-covered
           dark-blue wizard hat, black spikes, blue robe with gold trim and an
           ivory mantle, a blue spellbook with blue flames.
The Burrow Scrapper (spawned by the Chog Burrow, not a card) is a small
earthy digger: brown spikes, cream face with a determined grin, leather
harness, gloves, backpack and a little spade.
"""
import math
import random

from roster_lib import *  # noqa: F401,F403
from roster_lib import C, M, U, V, bpy, TAU  # noqa: F401

part, capsule = U.part, U.capsule


# ---------------------------------------------------------------- helpers

def head(rig, hc, r, name, back_hex, mask_hex="#ffeacb", face=None, top_max=0.86):
    """Chog head with a mask colour (cream, or the dark brown of the Bulwark
    and Warden class art) and, unless face=False, the card-art face."""
    part(rig, "head", "sphere", hc, (r, r * 0.84, r * 0.97),
         U.facemask_material(name + "Head", back_hex, mask_hex, front_min=0.3, top_max=top_max), ol=0.06, segments=48, ring_count=24)
    if face is not False:
        U.chog_face(rig, "head", hc, r, face or {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(26), "blush": 0.21, "mouth_tilt": -10})


def on_face(hc, r, d, push=0.0):
    return U.on_head(hc, r, d, push)


def bucket_hat(rig, hc, r, crown, band=None, tilt=0.18, lift=0.42, brim=1.42):
    """Bucket hat: a sloping brim and a soft crown, tipped back so the face reads."""
    axis = V((0, math.sin(tilt), math.cos(tilt)))
    o = V(hc) + axis * (r * lift)
    prof = [(0.9 * r, 0.0), (brim * r, -0.2 * r), (brim * r, -0.12 * r), (1.0 * r, 0.06 * r), (0.97 * r, 0.42 * r), (0.82 * r, 0.7 * r), (0.45 * r, 0.82 * r), (0.0, 0.85 * r)]
    lathe(rig, "head", prof, crown, origin=o, axis=axis, sy=0.92, segs=36, ol=0.05)
    if band:
        lathe(rig, "head", [(1.0 * r, 0.08 * r), (0.99 * r, 0.22 * r)], band, origin=o, axis=axis, sy=0.92, segs=36, ol=0.02)
    return o, axis


def star_outline(n, r_out, r_in, rot=math.pi / 2):
    return [(math.cos(i / (2 * n) * TAU + rot) * (r_out if i % 2 == 0 else r_in), math.sin(i / (2 * n) * TAU + rot) * (r_out if i % 2 == 0 else r_in)) for i in range(2 * n)]


def star_shield(rig, pivot, center, normal, r, gold, goldDeep, face):
    """Round shield: deep gold drum, ivory dome, gold rim, raised gold eight-point star."""
    n = V(normal).normalized()
    rot = frame_for(n).to_euler()
    part(rig, pivot, "cyl", V(center) - n * 0.05, (r, r, 0.18), goldDeep, rot=rot, ol=0.05, vertices=40, bev=0.04)
    part(rig, pivot, "sphere", V(center) + n * 0.02, (r * 0.88, r * 0.88, 0.16), face, rot=rot, ol=0.0, segments=40, ring_count=16)
    part(rig, pivot, "torus", V(center) + n * 0.07, (1, 1, 1), gold, rot=rot, ol=0.035, major_radius=r * 0.9, minor_radius=r * 0.12, major_segments=48, minor_segments=12)
    gem_slab(rig, pivot, star_outline(8, r * 0.66, r * 0.26), 0.05, V(center) + n * 0.17, n, (0, 0, 1), (gold, goldDeep), inner=0.4, dome=0.14, ol=0.025)


def rainbow_mat(name):
    """Rainbow visor: a colour ramp across the visor's local X, softly emissive."""
    if name in C._mats:
        return C._mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    nt.links.new(sep.outputs["X"], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    stops = ((0.0, "#ff3b5c"), (0.2, "#ff9a2e"), (0.4, "#ffe23a"), (0.6, "#3ee07a"), (0.8, "#2fb8ff"), (1.0, "#a35af0"))
    els[0].position, els[0].color = stops[0][0], C.hexc(stops[0][1])
    els[1].position, els[1].color = stops[-1][0], C.hexc(stops[-1][1])
    for pos, hx in stops[1:-1]:
        e = els.new(pos)
        e.color = C.hexc(hx)
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.9
    b.inputs["Roughness"].default_value = 0.12
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 0.6
    C._mats[name] = m
    return m


def cmdr_mats():
    return {
        "gold": mat("CGold", "#f4b731", rough=0.26, metal=0.9),
        "goldDeep": mat("CGoldDeep", "#d4901c", rough=0.3, metal=0.9),
        "ivory": mat("CIvory", "#f6f1e6", rough=0.38, coat=0.25),
        "darkSkin": "#5b3826",
        "black": mat("CBlackSpike", "#24202a", rough=0.45, coat=0.2),
        "black2": mat("CBlackSpikeLight", "#3a3442", rough=0.42, coat=0.25),
        "black3": mat("CBlackSpikeDeep", "#18151c", rough=0.48, coat=0.15),
        "skinDark": mat("CSkinDark", "#5b3826", rough=0.5, sss=0.05),
        "red": mat("CCrest", "#e3232c", rough=0.55),
        "redDeep": mat("CCrestDeep", "#b5151f", rough=0.55),
        "leather": mat("CLeather", "#7a4a26", rough=0.6),
        "leatherDark": mat("CLeatherDark", "#4e2e18", rough=0.66),
    }


# ---------------------------------------------------------------- Bulwark

def bulwark():
    """Bulwark (commander class card 21)."""
    K = cmdr_mats()
    hc, r = V((0, -0.02, 3.2)), 1.12
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(2121)
    P = {"leg_x": 0.36, "leg_r": 0.24}
    chog_legs(rig, P, boots=K["gold"])
    chog_body(rig, {"body": (0.72, 0.62, 0.8)})
    # White tunic with gold trim, studs and a belt; white skirt with a gold hem.
    lathe(rig, "hips", [(0.66, 0.78), (0.78, 0.98), (0.78, 1.25), (0.74, 1.55), (0.66, 1.84), (0.5, 2.08)], K["ivory"], ol=0.04)
    lathe(rig, "hips", [(0.8, 1.16), (0.81, 1.3)], K["leather"], ol=0.025)
    part(rig, "hips", "sphere", (0, -0.8, 1.23), (0.18, 0.08, 0.15), K["gold"], ol=0.02)
    lathe(rig, "hips", [(0.83, 0.62), (0.8, 0.95)], K["ivory"], ol=0.03)
    lathe(rig, "hips", [(0.85, 0.6), (0.85, 0.68)], K["gold"], ol=0.015)
    lathe(rig, "hips", [(0.52, 2.0), (0.56, 2.12)], K["gold"], ol=0.02)
    for sx in (-1, 1):
        part(rig, "hips", "sphere", (sx * 0.3, -0.68, 1.75), (0.11, 0.06, 0.11), K["gold"], ol=0.02, segments=16, ring_count=8)
        part(rig, "hips", "cube", (sx * 0.28, -0.74, 1.45), (0.07, 0.05, 0.5), K["gold"], rot=(0, sx * 0.2, 0), ol=0.0, bev=0.02)
    # Gold pauldrons.
    for sx in (-1, 1):
        part(rig, "hips", "sphere", (sx * 0.74, 0.0, 2.02), (0.48, 0.46, 0.34), K["gold"], ol=0.04)
        part(rig, "hips", "torus", (sx * 0.74, 0.0, 1.9), (0.44, 0.42, 0.4), K["goldDeep"], ol=0.015, major_radius=1.0, minor_radius=0.12)
    # Punching arm (character right) and the shield arm (left).
    chog_arm(rig, "armR", (0.6, 0, 1.86), (0.95, -0.3, 1.25), r=0.19, mitten=False, material=K["ivory"])
    band(rig, "armR", (0.88, -0.22, 1.36), (0.95, -0.3, 1.2), 0.21, K["gold"], ol=0.02)
    part(rig, "armR", "sphere", (0.97, -0.34, 1.12), (0.26, 0.25, 0.25), K["skinDark"], ol=0.05)
    chog_arm(rig, "armL", (-0.6, 0, 1.86), (-1.0, -0.42, 1.4), r=0.19, mitten=False, material=K["ivory"])
    part(rig, "armL", "sphere", (-1.02, -0.46, 1.36), (0.24, 0.23, 0.23), K["skinDark"], ol=0.05)
    star_shield(rig, "armL", (-1.22, -0.72, 1.5), (-0.35, -1.0, 0.05), 1.0, K["gold"], K["goldDeep"], K["ivory"])
    # Head: dark-brown face, black spikes fanning out behind the helmet.
    head(rig, hc, r, "Bulwark", "#24202a", K["darkSkin"], {"spread": 0.42, "eye_z": 0.0, "eye": (0.28, 0.33), "brow": math.radians(22), "blush": 0.2, "mouth_tilt": 6})
    spike_fan(rig, hc + V((0, 0.25, -0.15)), r, rnd, (K["black2"], K["black"], K["black3"]), arc=118, k=1.08, sweep=0.25, scalp=False)
    # Corinthian helmet: closed dome above the brow, cheek guards either side
    # of the face opening, a V brow ridge and the striped red crest.
    g = K["gold"]
    lathe(rig, "head", [(r * 1.06, r * 0.18), (r * 1.08, r * 0.45), (r * 0.98, r * 0.78), (r * 0.7, r * 1.0), (r * 0.3, r * 1.1), (0.0, r * 1.12)], g, origin=hc, sy=0.95, segs=40, ol=0.05)
    for a0, a1 in ((0.62, 2.35), (-2.35, -0.62)):
        lathe(rig, "head", [(r * 1.0, -r * 0.72), (r * 1.06, -r * 0.3), (r * 1.08, r * 0.2)], g, origin=hc, sy=0.95, segs=14, ol=0.045, arc=(a0, a1))
    for sx in (-1, 1):
        part(rig, "head", "cube", hc + V((sx * 0.4, -r * 0.98, r * 0.3)), (0.82, 0.2, 0.18), g, rot=(0, -sx * math.radians(16), sx * 0.3), ol=0.04, bev=0.06)
    # Crest: one striped band over the crown, tallest above the top.
    R = r * 1.08
    nseg = 22
    vs, fs, fm = [], [], []
    for i in range(nseg + 1):
        t = i / nseg
        a = math.radians(30 + 140 * t)
        radial = V((0, -math.cos(a), math.sin(a)))
        rin, rout = R * 0.92, R + r * (0.45 + 0.75 * math.sin(math.pi * (0.1 + 0.8 * t)) ** 0.85)
        sweep = V((0, 0.2 * (rout - rin), 0))
        for rr, w, sw in ((rin, 0.26 * r, V()), (rout, 0.44 * r, sweep)):
            for sx in (-1, 1):
                vs.append(tuple(hc + radial * rr + V((sx * w, 0, 0)) + sw))
    for i in range(nseg):
        b0, b1 = i * 4, (i + 1) * 4
        fs += [(b0, b0 + 2, b1 + 2, b1), (b0 + 1, b1 + 1, b1 + 3, b0 + 3), (b0 + 2, b0 + 3, b1 + 3, b1 + 2), (b0, b1, b1 + 1, b0 + 1)]
        fm += [(i // 2) % 2] * 4
    fs += [(0, 1, 3, 2), (nseg * 4, nseg * 4 + 2, nseg * 4 + 3, nseg * 4 + 1)]
    fm += [0, 0]
    crest = C.new_mesh_obj("BulwarkCrest", vs, fs, K["red"])
    crest.data.materials.append(K["redDeep"])
    for poly, mi in zip(crest.data.polygons, fm):
        poly.material_index = mi
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(crest.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(crest.data)
    bm.free()
    sub = crest.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    for p in crest.data.polygons:
        p.use_smooth = True
    U.outline(crest, 0.05)
    U.bind(rig, "head", crest)
    return rig


def bulwark_clips():
    clips = {"idle": idle_clip(fps=6, bob=0.035, sway=0.03)}
    clips["move"] = walk_clip(fps=9, stride=0.55, bounce=0.14, tilt=0.1, arms=0.25, extra=lambda t, s: {"armL_rot": (0.08 * s, 0.1, 0)})
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.08), "armL_rot": (0.3, 0.2, 0.25)},
        {"root_loc": lunge(-0.12), "root_rot": lean(-0.18), "armL_rot": (0.6, 0.3, 0.45), "root_scale": (1.04, 1.04, 0.96)},
        {"root_loc": lunge(0.35, 0.05), "root_rot": lean(0.28), "armL_rot": (-0.5, -0.1, -0.35), "armR_rot": (0.3, 0, 0)},
        {"root_loc": lunge(0.5), "root_rot": lean(0.34), "armL_rot": (-0.7, -0.15, -0.45), "root_scale": (1.06, 1.06, 0.94), "armR_rot": (0.35, 0, 0)},
        {"root_loc": lunge(0.3), "root_rot": lean(0.16), "armL_rot": (-0.3, 0, -0.2)},
        {"root_loc": lunge(0.08), "root_rot": lean(0.04)},
    ]}
    clips["hit"] = hit_clip(n=4, fps=12, k=0.55)
    clips["defeat"] = topple_clip(fps=11)
    # Aegis Wall: shield raised square to the front, braced low.
    brace = {"armL_rot": (-0.2, -0.35, -0.6), "root_scale": (1.05, 1.05, 0.93), "root_rot": lean(-0.06), "head_rot": (0.08, 0, 0)}
    clips["ability"] = {"fps": 10, "loop": False, "frames": [
        {"armL_rot": (0.1, -0.1, -0.2)}, {**brace, "root_scale": (1.08, 1.08, 0.88)}, brace, brace, brace, {**brace, "root_scale": (1.03, 1.03, 0.97)}, {"armL_rot": (0.0, -0.1, -0.2)},
    ]}
    return clips


# ---------------------------------------------------------------- Reaver

def reaver():
    """Reaver (commander class card 22)."""
    K = cmdr_mats()
    hc, r = V((0, 0, 3.2)), 1.1
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(2222)
    cloth = mat("ReaverCloth", "#2b2228", rough=0.66)
    clothL = mat("ReaverClothLight", "#3d3138", rough=0.62)
    cape = mat("ReaverCape", "#9e1f2c", rough=0.6)
    capeD = mat("ReaverCapeDeep", "#6a1420", rough=0.62)
    wrap = mat("ReaverWrap", "#c9a77a", rough=0.7)
    glove = mat("ReaverGlove", "#1d181c", rough=0.55)
    shoe = mat("ReaverShoe", "#c42a32", rough=0.5)
    skull = mat("ReaverSkull", "#e2473e", rough=0.48, coat=0.1, emit="#e2473e", emit_strength=0.1)
    hat = mat("ReaverHat", "#7d3fd0", rough=0.58)
    hatD = mat("ReaverHatDeep", "#5a2a9e", rough=0.6)
    white = mat("ReaverMark", "#f4ecff", rough=0.5)
    blade = mat("ReaverBlade", "#d12a32", rough=0.25, metal=0.4, coat=0.5, emit="#c4142a", emit_strength=0.5)
    bladeD = mat("ReaverBladeEdge", "#1e1418", rough=0.3, metal=0.6)
    P = {"leg_x": 0.34}
    chog_legs(rig, P, boots=shoe)
    for sx, key in ((-1, "legL"), (1, "legR")):
        band(rig, key, (sx * 0.36, 0, 0.42), (sx * 0.35, 0, 0.82), 0.27, wrap, ol=0.02)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.62, 0.78), (0.74, 0.98), (0.74, 1.28), (0.7, 1.56), (0.62, 1.84), (0.48, 2.06)], cloth, ol=0.04)
    lathe(rig, "hips", [(0.77, 1.12), (0.78, 1.26)], K["leather"], ol=0.025)
    part(rig, "hips", "cube", (0.0, -0.78, 1.19), (0.22, 0.06, 0.15), clothL, ol=0.02, bev=0.02)
    for z in (1.44, 1.7):
        lathe(rig, "hips", [(0.73, z), (0.7, z + 0.07)], clothL, ol=0.012)
    # Tattered dark-red scarf and cape behind, jagged hem.
    part(rig, "hips", "torus", (0, 0, 2.08), (0.6, 0.55, 0.5), cape, ol=0.03, major_radius=1.0, minor_radius=0.26, major_segments=24, minor_segments=8)
    for i, (x, L) in enumerate(((-0.55, 1.5), (-0.25, 1.75), (0.05, 1.6), (0.35, 1.85), (0.6, 1.45))):
        top = V((x * 0.9, 0.45, 2.02))
        pts = [top, top + V((x * 0.25, 0.32, -L * 0.45)), top + V((x * 0.45, 0.5, -L))]
        ribbon(rig, "hips", pts, [0.42, 0.38, 0.12], V((1, 0, 0)), cape if i % 2 else capeD, thick=0.06, ol=0.03)
    # Wrapped forearms, black gloves; dagger in the right hand.
    grip = V((1.0, -0.42, 1.3))
    chog_arm(rig, "armR", (0.6, 0, 1.86), grip, r=0.18, mitten=False, material=cloth)
    band(rig, "armR", (0.86, -0.25, 1.5), grip, 0.2, wrap, ol=0.02)
    part(rig, "armR", "sphere", grip, (0.24, 0.23, 0.23), glove, ol=0.05)
    hand_l = V((-0.92, -0.32, 1.28))
    chog_arm(rig, "armL", (-0.6, 0, 1.86), hand_l, r=0.18, mitten=False, material=cloth)
    band(rig, "armL", (-0.82, -0.2, 1.5), hand_l, 0.2, wrap, ol=0.02)
    part(rig, "armL", "sphere", hand_l, (0.24, 0.23, 0.23), glove, ol=0.05)
    # Curved jagged blade pointing up and forward, dark spine, gold guard.
    up = V((0.35, -0.25, 1.0)).normalized()
    side = up.cross(V((0, -1, 0))).normalized()
    tube(rig, "armR", (grip - up * 0.22, grip + up * 0.18), 0.07, K["leatherDark"], segs=8, ol=0.02)
    part(rig, "armR", "cube", grip + up * 0.22, (0.44, 0.12, 0.08), K["gold"], rot=frame_for(side).to_euler(), ol=0.02, bev=0.02)
    outline2d = [(0.0, 0.0), (0.16, 0.2), (0.2, 0.55), (0.14, 0.75), (0.24, 0.9), (0.12, 1.1), (0.16, 1.3), (-0.02, 1.62), (-0.1, 1.2), (-0.08, 0.8), (-0.12, 0.4), (-0.1, 0.1)]
    slab(rig, "armR", outline2d, 0.06, grip + up * 0.26, V((0, -1, 0)), up, blade, ol=0.035, inset=0.86, bev=0.015)
    tube(rig, "armR", [grip + up * 0.3 - side * 0.08, grip + up * 1.1 - side * 0.06, grip + up * 1.75 + side * 0.0], 0.03, bladeD, segs=6, ol=0.0)
    anchor_tip(rig, "armR", "tip", grip + up * 1.6)
    # Red skull face: X eyes, stitched grin, blush, hat with a skull mark.
    head(rig, hc, r, "Reaver", "#24202a", "#e2473e", face=False, top_max=0.9)
    for sx in (-1, 1):
        p, d = on_face(hc, r, (sx * 0.4, -0.92, 0.05), -0.04)
        yaw = U.yaw_for(d)
        for k in (-1, 1):
            part(rig, "head", "cube", p, (r * 0.36, r * 0.08, r * 0.1), U.M["pupil"], rot=(0, k * math.radians(45), yaw), ol=0.0, bev=0.02)
        bp, bd = on_face(hc, r, (sx * 0.66, -0.72, -0.3), -0.06)
        part(rig, "head", "sphere", bp, (r * 0.16, r * 0.05, r * 0.1), U.M["blush"], rot=(0, 0, U.yaw_for(bd)), ol=0)
    mp, md = on_face(hc, r, (0.0, -0.96, -0.42), -0.03)
    part(rig, "head", "cube", mp, (r * 0.62, r * 0.08, r * 0.2), white, rot=(0, 0, U.yaw_for(md)), ol=0.035, bev=0.03)
    for k in range(-2, 3):
        tp, td = on_face(hc, r, (k * 0.11, -0.97, -0.42), -0.0)
        part(rig, "head", "cube", tp, (r * 0.025, r * 0.06, r * 0.2), U.M["pupil"], rot=(0, 0, U.yaw_for(td)), ol=0.0)
    np_, nd = on_face(hc, r, (0.0, -0.98, -0.16), -0.03)
    part(rig, "head", "cone", np_, (r * 0.07, r * 0.07, r * 0.06), U.M["pupil"], rot=(math.radians(90), 0, U.yaw_for(nd) + math.pi), ol=0.0, vertices=3, radius1=1.0, radius2=0.0)
    spike_fan(rig, hc + V((0, 0.2, -0.05)), r, rnd, (K["black2"], K["black"], K["black3"]), arc=112, k=1.05, sweep=0.2, scalp=False)
    o, axis = bucket_hat(rig, hc, r, hat, band=hatD, tilt=0.16, lift=0.36)
    mark_c = o + V((0.0, -r * 0.86, r * 0.4))
    part(rig, "head", "sphere", mark_c, (r * 0.24, r * 0.05, r * 0.19), white, rot=(math.radians(-14), 0, 0), ol=0.015)
    for sx in (-1, 1):
        for k in (-1, 1):
            part(rig, "head", "cube", mark_c + V((sx * r * 0.09, -0.04, r * 0.03)), (r * 0.08, r * 0.02, r * 0.02), hatD, rot=(0, k * 0.8, 0), ol=0.0)
    return rig


def reaver_clips():
    clips = {"idle": idle_clip(fps=8, bob=0.04, sway=0.05, extra=lambda t, s: {"armR_rot": (-0.1 + 0.04 * s, 0, 0)})}
    clips["move"] = walk_clip(fps=13, stride=0.8, bounce=0.24, tilt=0.2, arms=0.55)
    clips["attack"] = {"fps": 14, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.1), "armR_rot": (-1.2, -0.3, 0.3)},
        {"root_loc": lunge(-0.12), "root_rot": lean(-0.2), "armR_rot": (-2.2, -0.4, 0.5), "head_rot": (-0.08, 0, 0)},
        {"root_loc": lunge(0.4, 0.08), "root_rot": lean(0.3), "armR_rot": (0.4, 0.2, -0.4)},
        {"root_loc": lunge(0.6), "root_rot": lean(0.38), "armR_rot": (1.2, 0.3, -0.7), "root_scale": (1.06, 1.06, 0.94)},
        {"root_loc": lunge(0.4), "root_rot": lean(0.2), "armR_rot": (0.8, 0.2, -0.4)},
        {"root_loc": lunge(0.1), "root_rot": lean(0.05), "armR_rot": (0.1, 0, 0)},
    ]}
    clips["hit"] = hit_clip(n=3, fps=14)
    clips["defeat"] = topple_clip(fps=12, spin=0.4)
    # Frenzy Rush: a crouched snarl, then a springing roar with the blade up.
    clips["ability"] = {"fps": 12, "loop": False, "frames": [
        {"root_scale": (1.08, 1.08, 0.88), "root_rot": lean(0.1), "armR_rot": (-0.6, 0, 0.3), "armL_rot": (-0.4, 0, -0.3)},
        {"root_scale": (1.12, 1.12, 0.84), "root_rot": lean(0.18), "armR_rot": (-0.8, 0, 0.4), "armL_rot": (-0.5, 0, -0.4), "head_rot": (0.15, 0, 0)},
        {"root_loc": (0, 0, 0.35), "root_scale": (0.94, 0.94, 1.1), "armR_rot": (-2.6, -0.3, 0.6), "armL_rot": (-1.6, 0.4, -0.5), "head_rot": (-0.25, 0, 0)},
        {"root_loc": (0, 0, 0.25), "armR_rot": (-2.7, -0.3, 0.6), "armL_rot": (-1.8, 0.4, -0.5), "head_rot": (-0.25, 0, 0.05)},
        {"root_loc": (0, 0, 0.05), "root_scale": (1.05, 1.05, 0.95), "armR_rot": (-1.4, -0.2, 0.4), "armL_rot": (-0.8, 0.2, -0.3)},
        {"armR_rot": (-0.3, 0, 0.1)},
    ]}
    return clips


def anchor_tip(rig, pivot, name, loc):
    e = bpy.data.objects.new(f"anchor_{name}", None)
    bpy.context.scene.collection.objects.link(e)
    e.location = V(loc)
    U.bind(rig, pivot, e)
    rig.setdefault("anchors", {})[name] = e


# ---------------------------------------------------------------- Deadeye

def deadeye():
    """Deadeye (commander class card 23)."""
    K = cmdr_mats()
    hc, r = V((0, 0, 3.2)), 1.08
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(2323)
    purple = (mat("DeadeyeSpikeLight", "#a466ec", rough=0.55, coat=0.05), mat("DeadeyeSpike", "#8048d8", rough=0.58, coat=0.05), mat("DeadeyeSpikeDeep", "#5c2cae", rough=0.6, coat=0.05))
    hood = mat("DeadeyeHood", "#6b3ad0", rough=0.6)
    hoodD = mat("DeadeyeHoodDeep", "#47228f", rough=0.62)
    pants = mat("DeadeyePants", "#3b2370", rough=0.62)
    boot = mat("DeadeyeBoot", "#2a1a50", rough=0.55)
    bowM = mat("DeadeyeBow", "#d23cc4", rough=0.3, coat=0.3, emit="#c02cb8", emit_strength=0.6)
    bowL = mat("DeadeyeBowLight", "#ff7af0", rough=0.3, emit="#ff4fe6", emit_strength=1.2)
    arrowM = mat("DeadeyeArrow", "#ffb8f4", rough=0.2, emit="#ff4fe6", emit_strength=2.5)
    pink = mat("DeadeyeFletch", "#ff6ad5", rough=0.5)
    P = {"leg_x": 0.34}
    chog_legs(rig, P, boots=boot)
    for sx, key in ((-1, "legL"), (1, "legR")):
        band(rig, key, (sx * 0.35, 0, 0.5), (sx * 0.35, 0, 0.9), 0.28, pants, ol=0.02)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.62, 0.78), (0.75, 0.98), (0.76, 1.3), (0.72, 1.58), (0.64, 1.86), (0.48, 2.08)], hood, ol=0.04)
    lathe(rig, "hips", [(0.79, 1.12), (0.8, 1.26)], hoodD, ol=0.025)
    part(rig, "hips", "cube", (0.0, -0.8, 1.19), (0.2, 0.06, 0.14), K["gold"], ol=0.02, bev=0.02)
    for sx in (-1, 1):
        part(rig, "hips", "cube", (sx * 0.6, -0.42, 1.0), (0.26, 0.2, 0.28), hoodD, rot=(0, 0, sx * math.radians(25)), ol=0.03, bev=0.05)
        part(rig, "hips", "cube", (sx * 0.38, -0.72, 1.55), (0.2, 0.08, 0.2), hoodD, ol=0.02, bev=0.03)
    part(rig, "hips", "torus", (0, 0.08, 2.08), (0.62, 0.58, 0.6), hood, ol=0.03, major_radius=1.0, minor_radius=0.28, major_segments=24, minor_segments=8)
    # Quiver on the back with pink fletching.
    q0, q1 = V((-0.25, 0.62, 1.15)), V((-0.9, 0.66, 2.4))
    qd = (q1 - q0).normalized()
    lathe(rig, "hips", [(0.2, 0.0), (0.24, 0.1), (0.24, 1.2), (0.27, 1.32)], hoodD, origin=q0, axis=qd, sy=1.0, segs=18, ol=0.035, cap=(True, False))
    qs = qd.orthogonal().normalized()
    for i, off in enumerate((-0.08, 0.06, 0.0)):
        b0 = q1 + qs * off
        blade(rig, "hips", b0, qd + qs * 0.1 * (i - 1), 0.42, 0.13, pink, qs, flat=0.25, ol=0.025, verts=8)
    # Bow arm toward screen right, draw hand at the chest.
    aim = V((0.82, -0.57, 0)).normalized()
    grip = V((1.18, -1.0, 1.8))
    nock = grip - aim * 0.85
    elR, elL = V((0.98, -0.45, 1.86)), V((-0.3, -0.62, 1.66))
    chog_arm(rig, "armR", (0.6, 0, 1.88), grip, elbow=elR, mitten=False, material=hood)
    part(rig, "armR", "sphere", grip, (0.22, 0.22, 0.24), hoodD, ol=0.05)
    chog_arm(rig, "armL", (-0.6, 0, 1.88), nock, elbow=elL, mitten=False, material=hood)
    part(rig, "armL", "sphere", nock + V((0, 0, -0.02)), (0.22, 0.22, 0.22), hoodD, ol=0.05)
    zz = V((0, 0, 1))
    prof = ((-0.04, -1.5), (0.06, -1.36), (0.0, -1.22), (0.15, -0.9), (0.24, -0.45), (0.27, 0.0), (0.24, 0.45), (0.15, 0.9), (0.0, 1.22), (0.06, 1.36), (-0.04, 1.5))
    pts = [grip + (aim * u + zz * w) * 1.12 for u, w in prof]
    tube(rig, "armR", pts, [0.035, 0.045, 0.055, 0.07, 0.08, 0.09, 0.08, 0.07, 0.055, 0.045, 0.035], bowM, segs=10, ol=0.035)
    for w in (-0.95, 0.95):
        blade(rig, "armR", grip + aim * 0.18 + zz * w * 1.12, aim, 0.3, 0.1, bowL, zz, flat=0.5, ol=0.02, verts=8)
    top, bot = pts[2], pts[-3]
    tube(rig, "armR", (top, nock, bot), 0.018, bowL, segs=5, ol=0.0, sets=["draw_default"])
    tube(rig, "armR", (top, grip + aim * 0.02, bot), 0.018, bowL, segs=5, ol=0.0, sets=["slack"])
    tube(rig, "armL", (nock - aim * 0.05, nock + aim * 1.4), 0.045, arrowM, segs=6, ol=0.015, sets=["arrow_default"])
    part(rig, "armL", "cone", nock + aim * 1.52, (0.1, 0.1, 0.28), arrowM, rot=frame_for(aim).to_euler(), ol=0.02, vertices=8, radius1=1.0, radius2=0.0, sets=["arrow_default"])
    anchor_tip(rig, "armR", "tip", grip + aim * 0.5)
    # Head: cream face, smile and blush under the rainbow visor; big purple spikes.
    head(rig, hc, r, "Deadeye", "#8048d8", face={"spread": 0.41, "eye_z": 0.05, "eye": (0.24, 0.28), "brow": math.radians(10), "blush": 0.22, "mouth_tilt": -18})
    vz = hc.z + r * 0.06
    lathe(rig, "head", [(r * 1.04, -r * 0.25), (r * 1.1, -r * 0.05), (r * 1.08, r * 0.18), (r * 1.0, r * 0.3)], rainbow_mat("DeadeyeVisor"), origin=(hc.x, hc.y, vz), sy=0.88, segs=24, ol=0.04, arc=(-1.25, 1.25))
    lathe(rig, "head", [(r * 1.0, -r * 0.27), (r * 1.02, r * 0.32)], mat("DeadeyeVisorBand", "#2a1a50", rough=0.5), origin=(hc.x, hc.y, vz), sy=0.88, segs=16, ol=0.02, arc=(1.25, TAU - 1.25))
    spike_fan(rig, hc, r, rnd, purple, arc=150, k=1.25, sweep=0.12, wid=0.62)
    return rig


def deadeye_clips():
    slack = {"draw_default": False, "slack": True}
    loose = {**slack, "arrow_default": False}
    clips = {"idle": idle_clip(fps=8, bob=0.035, sway=0.0, extra=lambda t, s: {"armL_rot": (0, 0, 0.04 * s)})}
    clips["move"] = walk_clip(fps=12, stride=0.7, bounce=0.2, tilt=0.12, arms=0.0, base={"show": loose},
                              extra=lambda t, s: {"armR_rot": (0.35 + 0.08 * s, 0, -0.3), "armL_rot": (0.3 - 0.15 * s, 0, 0.35)})
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.04), "armL_rot": (0, 0, -0.2), "show": slack},
        {"root_rot": lean(-0.1), "armL_rot": (0, 0, 0.06), "head_rot": (-0.04, 0, 0)},
        {"root_rot": lean(-0.14), "root_scale": (1.02, 1.02, 0.98), "armL_rot": (0, 0, 0.16)},
        {"root_loc": lunge(-0.12), "root_rot": lean(-0.2), "armL_rot": (0.2, 0, 0.5), "show": loose},
        {"root_loc": lunge(-0.08), "root_rot": lean(-0.12), "armL_rot": (0.15, 0, 0.42), "show": loose},
        {"root_rot": lean(-0.05), "armL_rot": (0.05, 0, 0.2), "show": loose},
        {"armL_rot": (0, 0, -0.1), "show": slack},
    ]}
    clips["hit"] = hit_clip(base={"show": {"arrow_default": False, "draw_default": False, "slack": True}})
    clips["defeat"] = topple_clip(base={"show": loose})
    # Piercing Volley: bow lifted high for a rapid triple release.
    hi = {"armR_rot": (-0.55, 0, 0), "armL_rot": (-0.45, 0, 0.1), "head_rot": (-0.15, 0, 0)}
    clips["ability"] = {"fps": 14, "loop": False, "frames": [
        {**hi, "root_rot": lean(-0.1)}, {**hi, "root_rot": lean(-0.16), "armL_rot": (-0.45, 0, 0.3)},
        {**hi, "root_loc": lunge(-0.1), "armL_rot": (-0.3, 0, 0.55), "show": loose}, {**hi, "armL_rot": (-0.45, 0, 0.2)},
        {**hi, "root_loc": lunge(-0.1), "armL_rot": (-0.3, 0, 0.55), "show": loose}, {**hi, "armL_rot": (-0.45, 0, 0.2)},
        {**hi, "root_loc": lunge(-0.12), "armL_rot": (-0.3, 0, 0.6), "show": loose}, {"armL_rot": (0, 0, 0.1), "show": slack},
    ]}
    return clips


# ---------------------------------------------------------------- Scout

def scout():
    """Scout (commander class card 24)."""
    K = cmdr_mats()
    hc, r = V((0, 0, 3.15)), 1.08
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(2424)
    suit = mat("ScoutSuit", "#202027", rough=0.6)
    suitL = mat("ScoutSuitLight", "#30303a", rough=0.58)
    stripe = mat("ScoutStripe", "#f2f2f2", rough=0.5)
    sole = mat("ScoutSole", "#f4f1ea", rough=0.5)
    hat = mat("ScoutHat", "#a9afb8", rough=0.6)
    hatD = mat("ScoutHatDeep", "#80868f", rough=0.62)
    reds = (mat("ScoutHairLight", "#ff4a3a", rough=0.5), mat("ScoutHair", "#e3261f", rough=0.52), mat("ScoutHairDeep", "#b41712", rough=0.55))
    frame = mat("ScoutGlasses", "#141218", rough=0.3, coat=0.4)
    lens = mat("ScoutLens", "#f1f7ff", rough=0.08, spec=0.9, coat=0.6, emit="#ffffff", emit_strength=0.15)
    P = {"leg_x": 0.33}
    chog_legs(rig, P, boots=suit)
    for sx, key in ((-1, "legL"), (1, "legR")):
        x = sx * 0.33
        band(rig, key, (x, 0, 0.38), (x * 1.02, 0, 0.92), 0.27, suit, ol=0.025)
        tube(rig, key, [(x + sx * 0.27, -0.02, 0.42), (x + sx * 0.27, -0.02, 0.9)], 0.035, stripe, segs=6, ol=0.0)
        fx = x * 1.08
        part(rig, key, "sphere", (fx, -0.17, 0.12), (0.37, 0.5, 0.12), sole, ol=0.04)
        part(rig, key, "sphere", (fx, -0.2, 0.2), (0.34, 0.46, 0.15), suit, ol=0.04)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.62, 0.78), (0.74, 0.98), (0.74, 1.3), (0.7, 1.58), (0.62, 1.86), (0.46, 2.08)], suit, ol=0.04)
    lathe(rig, "hips", [(0.5, 2.0), (0.55, 2.16)], suitL, ol=0.02)
    tube(rig, "hips", [(0.0, -0.74, 0.95), (0.0, -0.76, 1.4), (0.0, -0.7, 1.84)], 0.022, stripe, segs=6, ol=0.0)
    for sx in (-1, 1):
        tube(rig, "hips", [(sx * 0.66, -0.3, 1.0), (sx * 0.72, -0.25, 1.5), (sx * 0.62, -0.2, 1.9)], 0.03, stripe, segs=6, ol=0.0)
    hand_r, hand_l = V((0.92, -0.3, 1.22)), V((-0.92, -0.3, 1.22))
    for key, sh, hand, sx in (("armR", (0.6, 0, 1.86), hand_r, 1), ("armL", (-0.6, 0, 1.86), hand_l, -1)):
        chog_arm(rig, key, sh, hand, r=0.18, mitten=False, material=suit)
        tube(rig, key, [V(sh) + V((sx * 0.14, -0.05, 0.05)), hand + V((sx * 0.14, -0.02, 0.14))], 0.03, stripe, segs=6, ol=0.0)
        part(rig, key, "sphere", hand, (0.23, 0.22, 0.22), M["cream"], ol=0.05)
    # Head: cream face, big round glasses, small round mouth, blush; red hair
    # sweeping out from under a grey bucket hat.
    head(rig, hc, r, "Scout", "#e3261f", face=False)
    for sx in (-1, 1):
        p, d = on_face(hc, r, (sx * 0.42, -0.92, 0.05), 0.04)
        yaw = U.yaw_for(d)
        part(rig, "head", "torus", p, (1, 1, 1.0), frame, rot=(math.radians(90), 0, yaw), ol=0.0, major_radius=r * 0.3, minor_radius=r * 0.055, major_segments=28, minor_segments=8)
        part(rig, "head", "cyl", p - d * 0.01, (r * 0.29, r * 0.29, r * 0.02), lens, rot=(math.radians(90), 0, yaw), ol=0.0, vertices=28)
        ep = p + d * (r * 0.02) + V((sx * -0.03 * r, 0, -0.02 * r))
        part(rig, "head", "sphere", ep, (r * 0.08, r * 0.03, r * 0.09), U.M["pupil"], rot=(0, 0, yaw), ol=0.0, segments=12, ring_count=6)
        bp, bd = on_face(hc, r, (sx * 0.7, -0.68, -0.36), -0.06)
        part(rig, "head", "sphere", bp, (r * 0.16, r * 0.05, r * 0.1), U.M["blush"], rot=(0, 0, U.yaw_for(bd)), ol=0)
        tp, td = on_face(hc, r, (sx * 0.86, -0.5, 0.05), 0.02)
        tube(rig, "head", [tp, tp + V((sx * 0.25, 0.35, 0.0))], 0.035, frame, segs=6, ol=0.0)
    bp_, bd_ = on_face(hc, r, (0.0, -0.95, 0.06), 0.06)
    tube(rig, "head", [bp_ + V((-0.13, 0, 0)), bp_ + V((0.13, 0, 0))], 0.04, frame, segs=6, ol=0.0)
    mp, md = on_face(hc, r, (0.0, -0.97, -0.44), -0.02)
    part(rig, "head", "torus", mp, (1, 1, 1), U.M["mouth"], rot=(math.radians(90), 0, U.yaw_for(md)), ol=0.0, major_radius=r * 0.07, minor_radius=r * 0.025)
    # Red hair: swept spikes on both sides and the back, under the hat.
    u, v, back = head_frame(16)
    for sx in (-1, 1):
        for k, (dz, L) in enumerate(((0.25, 0.95), (-0.05, 1.05), (-0.35, 0.8))):
            base = hc + V((sx * r * 0.85, r * 0.05, r * dz))
            blade(rig, "spikes", base, V((sx * 1.0, 0.45, 0.1 + dz * 0.4)), r * L, r * 0.36, reds[k % 3], V((0, 0, 1)), flat=0.4, ol=0.045, verts=12)
    for k in range(5):
        a = math.radians(-60 + 30 * k)
        base = hc + V((math.sin(a) * r * 0.5, r * 0.7, r * 0.05))
        blade(rig, "spikes", base, V((math.sin(a) * 0.8, 1.0, -0.1)), r * 0.85, r * 0.4, reds[k % 3], V((0, 0, 1)), flat=0.4, ol=0.045, verts=12)
    bucket_hat(rig, hc, r, hat, band=hatD, tilt=0.14, lift=0.4, brim=1.38)
    return rig


def scout_clips():
    clips = {"idle": idle_clip(fps=8, bob=0.04, sway=0.05)}
    clips["move"] = walk_clip(fps=15, stride=0.9, bounce=0.3, tilt=0.22, arms=0.8)
    clips["attack"] = {"fps": 16, "loop": False, "impact": 2, "frames": [
        {"root_rot": lean(-0.1), "armR_rot": (0.6, 0, 0.2)},
        {"root_loc": lunge(0.3), "root_rot": lean(0.25), "armR_rot": (-1.2, -0.3, -0.2), "armL_rot": (0.5, 0, 0)},
        {"root_loc": lunge(0.5), "root_rot": lean(0.34), "armR_rot": (-1.5, -0.4, -0.3), "armL_rot": (0.6, 0, 0), "root_scale": (1.05, 1.05, 0.95)},
        {"root_loc": lunge(0.25), "root_rot": lean(0.14), "armR_rot": (-0.6, -0.1, 0)},
        {"root_loc": lunge(0.05), "armR_rot": (0.0, 0, 0)},
    ]}
    clips["hit"] = hit_clip(n=3, fps=14)
    clips["defeat"] = topple_clip(fps=12)
    # Shadow Step: a low crouch, then a long forward dash that blurs past.
    clips["ability"] = {"fps": 14, "loop": False, "frames": [
        {"root_scale": (1.08, 1.08, 0.86), "root_rot": lean(0.2), "armL_rot": (0.8, 0.2, 0), "armR_rot": (0.8, -0.2, 0)},
        {"root_loc": lunge(0.4, 0.15), "root_rot": lean(0.5), "armL_rot": (1.2, 0.3, 0), "armR_rot": (1.2, -0.3, 0), "legL_rot": (0.8, 0, 0), "legR_rot": (-0.7, 0, 0)},
        {"root_loc": lunge(0.75, 0.2), "root_rot": lean(0.55), "armL_rot": (1.3, 0.3, 0), "armR_rot": (1.3, -0.3, 0), "legL_rot": (-0.7, 0, 0), "legR_rot": (0.8, 0, 0)},
        {"root_loc": lunge(0.5, 0.05), "root_rot": lean(0.3), "root_scale": (1.05, 1.05, 0.95)},
        {"root_loc": lunge(0.15), "root_rot": lean(0.08)},
    ]}
    return clips


# ---------------------------------------------------------------- Warden

def warden():
    """Warden (commander class card 25)."""
    K = cmdr_mats()
    hc, r = V((0, 0, 3.15)), 1.1
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(2525)
    robe = mat("WardenRobe", "#23387e", rough=0.6)
    robeD = mat("WardenRobeDeep", "#172660", rough=0.62)
    mantle = mat("WardenMantle", "#f3ecdc", rough=0.45, coat=0.2)
    hatM = mat("WardenHat", "#1f3277", rough=0.58)
    hatD = mat("WardenHatDeep", "#152457", rough=0.6)
    gum = mat("WardenGum", "#ff8fc6", rough=0.25, coat=0.6, emit="#ff7ab8", emit_strength=0.25)
    book = mat("WardenBook", "#20408f", rough=0.5)
    page = mat("WardenPage", "#f6ecd2", rough=0.6)
    flame = glow_mat("WardenFlame", "#7fd8ff", "#3ab8ff", strength=3.0, alpha=0.75)
    P = {"leg_x": 0.32}
    chog_legs(rig, P)
    chog_body(rig, P)
    # Long blue robe to the ankles, gold hem and front trim, ivory mantle.
    lathe(rig, "hips", [(0.86, 0.32), (0.84, 0.6), (0.78, 1.0), (0.74, 1.4), (0.68, 1.75), (0.52, 2.06)], robe, ol=0.045)
    lathe(rig, "hips", [(0.88, 0.3), (0.87, 0.42)], K["gold"], ol=0.02)
    for sx in (-1, 1):
        tube(rig, "hips", [(sx * 0.12, -0.84, 0.36), (sx * 0.12, -0.8, 1.0), (sx * 0.1, -0.7, 1.7), (sx * 0.08, -0.52, 2.04)], 0.05, K["gold"], segs=8, ol=0.015)
    lathe(rig, "hips", [(0.78, 1.18), (0.79, 1.3)], K["leather"], ol=0.02)
    lathe(rig, "hips", [(0.86, 1.3), (0.9, 1.62), (0.78, 1.9), (0.58, 2.12)], mantle, ol=0.04, arc=(1.0, TAU - 1.0))
    lathe(rig, "hips", [(0.9, 1.29), (0.91, 1.36)], K["gold"], ol=0.015, arc=(1.0, TAU - 1.0))
    for i, (x, L) in enumerate(((-0.5, 1.3), (0.0, 1.45), (0.5, 1.3))):
        top = V((x, 0.62, 1.95))
        ribbon(rig, "hips", [top, top + V((x * 0.2, 0.28, -L * 0.5)), top + V((x * 0.3, 0.38, -L))], [0.62, 0.66, 0.5], V((1, 0, 0)), mantle if i != 1 else robeD, thick=0.06, ol=0.03)
    # Book in the right hand with blue flames, free hand at the chest.
    hand_r = V((0.95, -0.55, 1.42))
    chog_arm(rig, "armR", (0.6, 0, 1.86), hand_r, r=0.2, mitten=False, material=robe)
    band(rig, "armR", (0.86, -0.42, 1.5), hand_r, 0.24, K["gold"], ol=0.02, flare=1.15)
    part(rig, "armR", "sphere", hand_r, (0.22, 0.21, 0.21), M["cream"], ol=0.05)
    hand_l = V((-0.62, -0.62, 1.5))
    chog_arm(rig, "armL", (-0.6, 0, 1.86), hand_l, r=0.2, mitten=False, material=robe)
    part(rig, "armL", "sphere", hand_l, (0.22, 0.21, 0.21), M["cream"], ol=0.05)
    bc = hand_r + V((0.12, -0.18, 0.28))
    for sx in (-1, 1):
        nrm = V((sx * 0.45, -0.7, 0.55)).normalized()
        slab(rig, "armR", [(-0.3, -0.22), (0.3, -0.22), (0.3, 0.22), (-0.3, 0.22)], 0.06, bc + V((sx * 0.27, 0.02, 0)), nrm, (0, 0, 1), book, ol=0.03, inset=0.96, bev=0.01)
        slab(rig, "armR", [(-0.27, -0.2), (0.27, -0.2), (0.27, 0.2), (-0.27, 0.2)], 0.05, bc + V((sx * 0.26, -0.03, 0.02)), nrm, (0, 0, 1), page, ol=0.0, inset=0.98, bev=0.0)
    for i, (x, L) in enumerate(((-0.12, 0.7), (0.05, 0.9), (0.2, 0.62))):
        blade(rig, "armR", bc + V((x, -0.08, 0.1)), V((x * 0.6, 0.05, 1.0)), L, 0.16, flame, (1, 0, 0), flat=0.5, ol=0.0, verts=10, sets=["flame_default"])
    anchor_tip(rig, "armR", "tip", bc + V((0.05, -0.1, 0.5)))
    # Head: dark-brown face, bubblegum bubble, black spikes, star wizard hat.
    head(rig, hc, r, "Warden", "#24202a", K["darkSkin"], {"spread": 0.42, "eye_z": 0.08, "eye": (0.28, 0.33), "brow": math.radians(14), "blush": 0.2, "mouth_tilt": 0})
    gp, gd = on_face(hc, r, (0.12, -0.96, -0.42), 0.12)
    part(rig, "head", "sphere", gp + gd * 0.14, (r * 0.34, r * 0.3, r * 0.32), gum, ol=0.04, sets=["gum_default"])
    spike_fan(rig, hc + V((0, 0.18, -0.1)), r, rnd, (K["black2"], K["black"], K["black3"]), arc=110, k=1.02, sweep=0.2, scalp=False)
    axis = V((0, 0.12, 1)).normalized()
    o = hc + axis * (r * 0.5)
    lathe(rig, "head", [(r * 0.5, -0.02), (r * 1.55, -0.14), (r * 1.55, -0.06), (r * 0.95, 0.06)], hatM, origin=o, axis=axis, sy=0.94, segs=40, ol=0.05)
    path = [o + V((0, 0, 0.0)), o + V((0, 0.05, r * 0.7)), o + V((-0.05, 0.25, r * 1.35)), o + V((-0.3, 0.55, r * 1.85)), o + V((-0.65, 0.85, r * 2.05))]
    tube(rig, "head", path, [r * 0.96, r * 0.7, r * 0.45, r * 0.22, r * 0.05], hatM, segs=24, ol=0.05)
    lathe(rig, "head", [(r * 0.97, 0.04), (r * 0.95, 0.2)], K["gold"], origin=o, axis=axis, sy=0.94, segs=36, ol=0.02)
    for (t, ang, s) in ((0.12, -0.45, 0.42), (0.18, 0.6, 0.36), (0.42, 0.05, 0.36), (0.58, -0.8, 0.28), (0.66, 0.65, 0.24), (0.84, -0.1, 0.2)):
        k = t * (len(path) - 1)
        i0 = min(int(k), len(path) - 2)
        f = k - i0
        c = path[i0].lerp(path[i0 + 1], f)
        rad = [r * 0.96, r * 0.7, r * 0.45, r * 0.22, r * 0.05]
        rr = rad[i0] + (rad[i0 + 1] - rad[i0]) * f
        n = V((math.sin(ang), -math.cos(ang), 0.1)).normalized()
        gem_slab(rig, "head", star_outline(5, s, s * 0.45), 0.04, c + n * (rr * 0.98), n, (0, 0.1, 1), (K["gold"], K["goldDeep"]), inner=0.4, dome=0.06, ol=0.015)
    for (x, z, s) in ((-1.2, -0.08, 0.3), (1.1, -0.1, 0.28), (0.2, -0.12, 0.24)):
        n = V((x * 0.1, -0.2, 1.0)).normalized()
        gem_slab(rig, "head", star_outline(5, s, s * 0.45), 0.04, o + V((x * r * 0.95, -0.6 if x > 0 else 0.0, z)), n, (0, 1, 0), (K["gold"], K["goldDeep"]), inner=0.4, dome=0.06, ol=0.015)
    return rig


def warden_clips():
    clips = {"idle": idle_clip(fps=7, bob=0.035, sway=0.03, extra=lambda t, s: {"armR_loc": (0, 0, 0.03 * s)})}
    clips["move"] = walk_clip(fps=10, stride=0.45, bounce=0.16, tilt=0.1, arms=0.25)
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.06), "armR_rot": (0.2, 0, 0.1)},
        {"root_rot": lean(-0.14), "armR_rot": (0.4, 0, 0.2), "armL_rot": (-0.4, 0, -0.2), "head_rot": (-0.06, 0, 0)},
        {"root_loc": lunge(0.15), "root_rot": lean(0.16), "armR_rot": (-0.5, -0.1, -0.1), "armL_rot": (-0.9, 0.2, 0.2)},
        {"root_loc": lunge(0.25), "root_rot": lean(0.24), "armR_rot": (-0.8, -0.2, -0.2), "armL_rot": (-1.1, 0.3, 0.3), "root_scale": (1.03, 1.03, 0.97)},
        {"root_loc": lunge(0.12), "root_rot": lean(0.1), "armR_rot": (-0.3, 0, 0)},
        {"armR_rot": (0.0, 0, 0)},
    ]}
    clips["hit"] = hit_clip(n=3, fps=12, base={"show": {"gum_default": False}})
    clips["defeat"] = topple_clip(fps=11, base={"show": {"gum_default": False, "flame_default": False}})
    # Null Field: book raised overhead, free arm spread, a lift on the toes.
    up = {"armR_rot": (-2.2, -0.2, 0.3), "armL_rot": (-1.4, 0.5, -0.4), "head_rot": (-0.2, 0, 0)}
    clips["ability"] = {"fps": 10, "loop": False, "frames": [
        {"armR_rot": (-0.8, 0, 0.1), "armL_rot": (-0.5, 0.2, -0.1)},
        {**up, "root_loc": (0, 0, 0.12)}, {**up, "root_loc": (0, 0, 0.2), "root_scale": (0.97, 0.97, 1.04)}, {**up, "root_loc": (0, 0, 0.18)},
        {**up, "root_loc": (0, 0, 0.1)}, {"armR_rot": (-0.6, 0, 0.1), "armL_rot": (-0.3, 0, 0)},
    ]}
    return clips


# ---------------------------------------------------------------- Burrow Scrapper

def burrow_scrapper():
    """Burrow Scrapper (spawned by the Chog Burrow)."""
    hc, r = V((0, 0, 3.15)), 1.12
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(1717)
    browns = (mat("ScrapSpikeLight", "#b8784a", rough=0.58, coat=0.05), mat("ScrapSpike", "#9a5f34", rough=0.6, coat=0.05), mat("ScrapSpikeDeep", "#734222", rough=0.62))
    leather = mat("ScrapLeather", "#8a5530", rough=0.6)
    leatherD = mat("ScrapLeatherDeep", "#5a3518", rough=0.64)
    shorts = mat("ScrapShorts", "#3a2a24", rough=0.66)
    buckle = mat("ScrapBuckle", "#d8b25a", rough=0.3, metal=0.8)
    steel = mat("ScrapSpade", "#a9b0ba", rough=0.3, metal=0.85)
    steelD = mat("ScrapSpadeDeep", "#6e7580", rough=0.34, metal=0.8)
    wood = mat("ScrapHandle", "#a26a3a", rough=0.6)
    P = {"leg_x": 0.34}
    chog_legs(rig, P)
    for sx, key in ((-1, "legL"), (1, "legR")):
        band(rig, key, (sx * 0.35, 0, 0.6), (sx * 0.35, 0, 0.95), 0.28, shorts, ol=0.02)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.66, 0.78), (0.74, 0.95), (0.74, 1.12)], shorts, ol=0.035)
    lathe(rig, "hips", [(0.77, 1.08), (0.78, 1.22)], leatherD, ol=0.025)
    part(rig, "hips", "cube", (0.1, -0.78, 1.15), (0.2, 0.06, 0.14), buckle, ol=0.02, bev=0.02)
    for sx in (-1, 1):
        pts = [V((sx * 0.42, -0.5, 1.98)), V((0, -0.72, 1.52)), V((-sx * 0.55, -0.55, 1.18))]
        d = (pts[2] - pts[0]).normalized()
        ribbon(rig, "hips", pts, 0.16, V((d.z, 0.0, -d.x)), leather, thick=0.06, ol=0.02)
    part(rig, "hips", "sphere", (0, -0.7, 1.55), (0.1, 0.05, 0.1), buckle, ol=0.015)
    # Backpack with a flap and a side pouch.
    part(rig, "hips", "cube", (0, 0.72, 1.5), (1.0, 0.55, 0.9), leather, ol=0.045, bev=0.16)
    part(rig, "hips", "cube", (0, 0.72, 1.92), (1.04, 0.6, 0.18), leatherD, rot=(0.12, 0, 0), ol=0.03, bev=0.06)
    part(rig, "hips", "cube", (-0.6, 0.5, 1.25), (0.3, 0.36, 0.44), leatherD, ol=0.03, bev=0.08)
    # Gloved hands; the spade in the right.
    grip = V((0.95, -0.4, 1.25))
    chog_arm(rig, "armR", (0.6, 0, 1.86), grip, r=0.18, mitten=False)
    part(rig, "armR", "sphere", grip, (0.27, 0.26, 0.26), leather, ol=0.05)
    band(rig, "armR", (0.86, -0.3, 1.38), grip, 0.22, leatherD, ol=0.02)
    hand_l = V((-0.92, -0.32, 1.22))
    chog_arm(rig, "armL", (-0.6, 0, 1.86), hand_l, r=0.18, mitten=False)
    part(rig, "armL", "sphere", hand_l, (0.27, 0.26, 0.26), leather, ol=0.05)
    dirv = V((0.45, -0.55, 0.7)).normalized()
    tube(rig, "armR", (grip - dirv * 0.35, grip + dirv * 0.55), 0.07, wood, segs=8, ol=0.025)
    spade = [(0.0, 0.0), (0.26, 0.08), (0.3, 0.42), (0.18, 0.72), (0.0, 0.86), (-0.18, 0.72), (-0.3, 0.42), (-0.26, 0.08)]
    slab(rig, "armR", spade, 0.06, grip + dirv * 0.55, V((0.2, -1.0, -0.1)), dirv, steel, ol=0.035, inset=0.86, bev=0.02)
    part(rig, "armR", "cube", grip + dirv * 0.55, (0.3, 0.1, 0.12), steelD, rot=frame_for(dirv).to_euler(), ol=0.02, bev=0.02)
    # Head: cream face with a determined grin, earthy brown spike crown.
    head(rig, hc, r, "Scrapper", "#9a5f34", face={"spread": 0.4, "eye_z": 0.02, "eye": (0.26, 0.3), "brow": math.radians(32), "blush": 0.22, "mouth_tilt": -16})
    spike_fan(rig, hc, r, rnd, browns, arc=150, k=1.15, sweep=0.1)
    return rig


def scrapper_clips():
    clips = {"idle": idle_clip(fps=8, bob=0.04, sway=0.04)}
    clips["move"] = walk_clip(fps=14, stride=0.8, bounce=0.34, tilt=0.18, arms=0.6, extra=lambda t, s: {"armR_rot": (-0.3 + 0.3 * s, -0.2, 0)})
    clips["attack"] = {"fps": 14, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.08), "armR_rot": (-1.0, -0.2, 0.2)},
        {"root_loc": lunge(-0.12), "root_rot": lean(-0.18), "armR_rot": (-2.0, -0.3, 0.3), "head_rot": (-0.08, 0, 0)},
        {"root_loc": lunge(0.35, 0.1), "root_rot": lean(0.28), "armR_rot": (0.0, 0.1, -0.2)},
        {"root_loc": lunge(0.5), "root_rot": lean(0.36), "armR_rot": (0.8, 0.2, -0.3), "root_scale": (1.06, 1.06, 0.94)},
        {"root_loc": lunge(0.3), "root_rot": lean(0.18), "armR_rot": (0.4, 0.1, -0.1)},
        {"root_loc": lunge(0.08), "armR_rot": (-0.2, 0, 0)},
    ]}
    clips["hit"] = hit_clip(n=3, fps=14)
    clips["defeat"] = topple_clip(fps=13)
    return clips


# ---------------------------------------------------------------- registry

def cspec(build, clips, cell, pivot, px, identity=(7.0, 2.8), lift=None):
    k = px / 16.0
    cell = tuple(int(round(c * k / 2)) * 2 for c in cell)
    pivot = tuple(int(round(c * k / 2)) * 2 for c in pivot)
    return {"build": build, "clips": clips, "cell": cell, "pivot": pivot, "px": px, "outlineK": 1.5,
            "identityScale": identity[0], "identityLook": identity[1], "lift": lift or {"front": 0.28, "rear": 0.05},
            "card": {"center": (0, 0, 2.6), "scale": 6.0, "pitch": 80, "outline": 1.3, "pose": {}}}


CHARS = {
    "commander_bulwark": cspec(bulwark, bulwark_clips, (240, 230), (116, 182), px=20.0, identity=(7.6, 2.9)),
    "commander_reaver": cspec(reaver, reaver_clips, (250, 230), (116, 182), px=20.0, identity=(7.6, 2.9)),
    "commander_deadeye": cspec(deadeye, deadeye_clips, (240, 230), (104, 182), px=20.0, identity=(7.6, 2.9)),
    "commander_scout": cspec(scout, scout_clips, (230, 220), (110, 176), px=20.0, identity=(7.4, 2.8)),
    "commander_warden": cspec(warden, warden_clips, (240, 256), (116, 196), px=20.0, identity=(8.2, 3.3)),
    "burrow_scrapper": cspec(burrow_scrapper, scrapper_clips, (220, 200), (104, 160), px=16.0, identity=(6.8, 2.7)),
}
