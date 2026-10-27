"""Spell props for the battle VFX: the Chaos Comet rock (card 19: dark violet
crystal rock with glowing molten cracks) as six rotation frames, and the Rally
Horn (card 18: curved gold horn with cream bands and a gold bell) as one
three-quarter still. Same lights, outline and materials as the units.

  blender.exe -b --factory-startup --python build_vfx_props.py -- <out_dir>
tools/vfx/build_vfx.cjs packs the renders into public/assets/battle-vfx/v001.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roster_lib import C, U, V, bpy, lava_mat, mat, tube, lathe, frame_for  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else "vfx-props")


def scene(res):
    C.reset_scene()
    C._mats.clear()
    U.M.clear()
    U.OUTLINES.clear()
    U.mats()
    C.setup_world(0.9)
    C.setup_sun(3.4)
    sc = bpy.context.scene
    cam = C.ortho_camera("PropCam", V((0, 0, 0)), 3.0, res, res)
    return sc, cam


def comet():
    sc, cam = scene(256)
    cam.data.ortho_scale = 2.9
    rig = U.make_rig({"root": ("yaw", (0, 0, 0))})
    rnd = random.Random(1919)
    rock = lava_mat("CometRock", rock="#4b2386", glow="#ffb23a", scale=3.0, width=0.055, strength=5.0, rough=0.45)
    facet = mat("CometFacet", "#6a35b8", rough=0.3, coat=0.4, emit="#5a20a8", emit_strength=0.4)
    core = mat("CometGlow", "#ffb860", rough=0.2, emit="#ff8a1e", emit_strength=3.0)
    # Clustered crystal-rock lumps around a glowing core, like the card.
    U.part(rig, "root", "ico", (0, 0, 0), (0.42, 0.42, 0.42), core, ol=0.0, subdivisions=2, smooth=True)
    for i in range(15):
        th, ph = rnd.uniform(0, math.tau), math.acos(rnd.uniform(-1, 1))
        d = V((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
        s = rnd.uniform(0.36, 0.5)
        U.part(rig, "root", "ico", d * 0.46, (s, s * 0.9, s * 0.85), rock if i % 3 else facet,
               rot=(rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3)), ol=0.035, subdivisions=1, smooth=False)
    root = rig["piv"]["yaw"]
    d = os.path.join(OUT, "comet")
    os.makedirs(d, exist_ok=True)
    U.set_outline(1.4)
    for i in range(6):
        root.rotation_euler = (0.4, 0.2 + i / 6 * math.tau, 0.3)
        bpy.context.view_layer.update()
        C.render_to(os.path.join(d, f"{i:02d}.png"))


def horn():
    sc, cam = scene(256)
    cam.data.ortho_scale = 4.2
    rig = U.make_rig({"root": ("yaw", (0, 0, 0))})
    gold = mat("HornGold", "#f4b731", rough=0.24, metal=0.9)
    goldDeep = mat("HornGoldDeep", "#c98a1c", rough=0.3, metal=0.9)
    cream = mat("HornCream", "#f6e6c4", rough=0.45, coat=0.2)
    inner = mat("HornInner", "#7a4a12", rough=0.5)
    # Curved horn: a tapering tube on an arc, cream bands, gold bell and tip.
    pts, rad = [], []
    for k in range(14):
        t = k / 13
        a = math.radians(200 - 150 * t)
        pts.append(V((math.cos(a) * 1.25 + 0.2, 0, math.sin(a) * 0.8 + 0.1 * t)))
        rad.append(0.08 + 0.32 * t ** 1.4)
    tube(rig, "root", pts, rad, gold, segs=20, ol=0.04)
    for k in (5, 7, 9):
        d = (pts[k + 1] - pts[k - 1]).normalized()
        lathe(rig, "root", [(rad[k] * 1.06, -0.13), (rad[k] * 1.1, 0.0), (rad[k + 1] * 1.08, 0.13)], cream, origin=pts[k], axis=d, sy=1.0, segs=20, ol=0.025, cap=(True, True))
        U.part(rig, "root", "torus", pts[k] + d * 0.16, (1, 1, 1), goldDeep, rot=frame_for(d).to_euler(), ol=0.02, major_radius=rad[k + 1] * 1.08, minor_radius=0.04)
    end, d = pts[-1], (pts[-1] - pts[-2]).normalized()
    lathe(rig, "root", [(0.4, 0.0), (0.46, 0.25), (0.62, 0.55), (0.78, 0.72), (0.8, 0.78)], gold, origin=end - d * 0.05, axis=d, sy=1.0, segs=32, ol=0.045)
    U.part(rig, "root", "cyl", end + d * 0.6, (0.66, 0.66, 0.04), inner, rot=frame_for(d).to_euler(), ol=0.0, vertices=32)
    U.part(rig, "root", "torus", end + d * 0.74, (1, 1, 1), goldDeep, rot=frame_for(d).to_euler(), ol=0.03, major_radius=0.78, minor_radius=0.07)
    tip = pts[0]
    U.part(rig, "root", "cone", tip + V((-0.05, 0, -0.15)), (0.12, 0.12, 0.4), gold, rot=(math.radians(160), 0, 0), ol=0.03, vertices=12, radius1=1.0, radius2=0.0)
    root = rig["piv"]["yaw"]
    root.rotation_euler = (math.radians(-10), math.radians(-18), math.radians(-28))
    bpy.context.view_layer.update()
    U.set_outline(1.6)
    out = os.path.join(OUT, "horn")
    os.makedirs(out, exist_ok=True)
    C.render_to(os.path.join(out, "00.png"))


if __name__ == "__main__":
    comet()
    horn()
