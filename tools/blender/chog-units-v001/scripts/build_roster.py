"""Chog Royale animated units, Slice 4: the remaining ten troop cards.

Each unit keeps its original card's cream Chog face mask, round eyes, blush,
spike colours, role equipment and silhouette. Builders and clip generators
come from roster_lib.py, the rig, face, camera, lights, render loop and card
portrait from build_units.py (Slice 3.1, unchanged for Choglings and
Boulderback).

Run headless from this folder:
  blender.exe -b --factory-startup --python build_roster.py -- <out_dir> [unit ...]
Env flags match build_units.py (PREVIEW, PCLIP, PFRAME, VIEWS, CLIPS, NOCARD,
CARDONLY). Every unit sets rig["mirror_geo"], so the rear three-quarter view
mirrors the whole model and the prop stays in the hand that carries the pose.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roster_lib import *  # noqa: E402,F401,F403
from roster_lib import C, M, U, V, bpy, math, random, TAU  # noqa: E402


# ---------------------------------------------------------------- Chaos Archer

def chaos_archer():
    """Chaos Archer (card 02): purple backswept spikes, cheeky Chog grin,
    brown leather vest over a purple tunic, belt and pouch, leg wraps and
    bracers, a purple-fletched quiver on the back and a dark purple recurve
    bow drawn toward screen right."""
    hc, r = V((0, 0, 3.2)), 1.1
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(202)
    purple = (mat("ArcherSpikeLight", "#a466ec", rough=0.55, coat=0.05), mat("ArcherSpike", "#7e3fd0", rough=0.58, coat=0.05),
              mat("ArcherSpikeDeep", "#5a2a9e", rough=0.6, coat=0.05))
    leather = mat("Leather", "#7a4a26", rough=0.62)
    leatherD = mat("LeatherDark", "#4e2e18", rough=0.66)
    tunic = mat("ArcherTunic", "#6a35b8", rough=0.6)
    gold = mat("Buckle", "#f4b731", rough=0.3, metal=0.85)
    bowM = mat("BowWood", "#4b2a72", rough=0.42, coat=0.2)
    bowL = mat("BowWoodLight", "#7446ad", rough=0.42, coat=0.2)
    string = mat("BowString", "#efe6d2", rough=0.5)
    steel = mat("ArrowHead", "#cfd4dc", rough=0.3, metal=0.8)
    shaft = mat("ArrowShaft", "#c28a50", rough=0.55)
    P = {"name": "Archer", "hc": hc, "r": r, "spike_hex": "#7e3fd0",
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(22), "blush": 0.21, "mouth_tilt": -16}}
    chog_legs(rig, P, boots=leatherD)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.5, 0.8), (0.67, 0.95), (0.7, 1.12), (0.68, 1.3)], tunic, ol=0.035)
    lathe(rig, "hips", [(0.71, 1.16), (0.73, 1.4), (0.7, 1.62), (0.64, 1.84), (0.48, 2.08)], leather, ol=0.04)
    lathe(rig, "hips", [(0.75, 1.12), (0.76, 1.26)], leatherD, ol=0.03)
    part(rig, "hips", "cube", (0.12, -0.7, 1.19), (0.2, 0.06, 0.16), gold, ol=0.02, bev=0.02)
    part(rig, "hips", "cube", (0.62, -0.32, 1.02), (0.28, 0.2, 0.3), leather, rot=(0, 0, math.radians(30)), ol=0.03, bev=0.06)
    part(rig, "hips", "torus", (0, 0, 2.08), (0.5, 0.45, 0.4), tunic, ol=0.03, major_radius=1.0, minor_radius=0.22, major_segments=24, minor_segments=8)
    # Quiver on the back with purple-fletched arrows over the left shoulder.
    q0, q1 = V((-0.3, 0.6, 1.15)), V((-1.0, 0.62, 2.42))
    qd = (q1 - q0).normalized()
    lathe(rig, "hips", [(0.2, 0.0), (0.24, 0.1), (0.24, 1.2), (0.27, 1.32), (0.27, 1.44)], leather, origin=q0, axis=qd, sy=1.0, segs=18, ol=0.035, cap=(True, False))
    side = qd.orthogonal().normalized()
    for i, off in enumerate(((-0.08, 0.02), (0.08, -0.05), (0.0, 0.1), (0.12, 0.08))):
        b0 = q1 + side * off[0] + side.cross(qd) * off[1]
        tip = b0 + (qd + side * 0.12 * (i - 1.5)).normalized() * 0.6
        tube(rig, "hips", (b0, tip), 0.03, shaft, segs=6, ol=0.015)
        blade(rig, "hips", tip - qd * 0.1, qd, 0.42, 0.13, purple[1] if i % 2 else purple[0], side, flat=0.25, ol=0.025, verts=8)
    # Bow arm forward toward screen right, draw hand pulled back to the chest.
    aim = V((0.82, -0.57, 0)).normalized()
    grip = V((1.18, -1.0, 1.8))
    nock = grip - aim * 0.85
    elR, elL = V((0.98, -0.45, 1.86)), V((-0.3, -0.62, 1.66))
    chog_arm(rig, "armR", (0.6, 0, 1.88), grip, elbow=elR, mitten=False)
    part(rig, "armR", "sphere", grip, (0.22, 0.22, 0.24), M["cream"], ol=0.05)
    band(rig, "armR", elR, grip - aim * 0.12, 0.205, leather, ol=0.03)
    chog_arm(rig, "armL", (-0.6, 0, 1.88), nock, elbow=elL, mitten=False)
    part(rig, "armL", "sphere", nock + V((0, 0, -0.02)), (0.22, 0.22, 0.22), M["cream"], ol=0.05)
    band(rig, "armL", elL, nock - (nock - elL).normalized() * 0.15, 0.2, leather, ol=0.03)
    # Recurve bow in the vertical plane of the aim, belly toward the target.
    zz = V((0, 0, 1))
    prof = ((-0.04, -1.5), (0.06, -1.36), (0.0, -1.22), (0.15, -0.9), (0.24, -0.45), (0.27, 0.0), (0.24, 0.45), (0.15, 0.9), (0.0, 1.22), (0.06, 1.36), (-0.04, 1.5))
    pts = [grip + aim * u + zz * w for u, w in prof]
    tube(rig, "armR", pts, [0.03, 0.04, 0.05, 0.065, 0.075, 0.085, 0.075, 0.065, 0.05, 0.04, 0.03], bowM, segs=10, ol=0.035)
    tube(rig, "armR", [grip + aim * 0.27 - zz * 0.2, grip + aim * 0.27 + zz * 0.2], 0.1, leatherD, segs=10, ol=0.025)
    for w in (-0.9, 0.9):
        blade(rig, "armR", grip + aim * 0.15 + zz * w, aim, 0.24, 0.09, bowL, zz, flat=0.5, ol=0.02, verts=8)
    top, bot = pts[2], pts[-3]
    tube(rig, "armR", (top, nock, bot), 0.016, string, segs=5, ol=0.0, sets=["draw_default"])
    tube(rig, "armR", (top, grip + aim * 0.02, bot), 0.016, string, segs=5, ol=0.0, sets=["slack"])
    # Nocked arrow: shaft, steel head, purple fletching. Hidden after release.
    tube(rig, "armL", (nock - aim * 0.05, nock + aim * 1.25), 0.036, shaft, segs=6, ol=0.015, sets=["arrow_default"])
    part(rig, "armL", "cone", nock + aim * 1.36, (0.08, 0.08, 0.24), steel, rot=frame_for(aim).to_euler(), ol=0.02, vertices=8, radius1=1.0, radius2=0.0, sets=["arrow_default"])
    for s in (zz, aim.cross(zz)):
        blade(rig, "armL", nock + aim * 0.02, aim, 0.3, 0.09, purple[0], s, flat=0.2, ol=0.02, verts=6, sets=["arrow_default"])
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, purple, arc=125, k=1.08, sweep=0.15)
    return rig


def archer_clips():
    slack = {"draw_default": False, "slack": True}
    loose = {**slack, "arrow_default": False}
    clips = {"idle": idle_clip(fps=8, bob=0.035, sway=0.0, extra=lambda t, s: {"armL_rot": (0, 0, 0.04 * s)})}
    clips["move"] = walk_clip(fps=12, stride=0.7, bounce=0.22, tilt=0.12, arms=0.0, base={"show": loose},
                              extra=lambda t, s: {"armR_rot": (0.35 + 0.08 * s, 0, -0.3), "armL_rot": (0.3 - 0.15 * s, 0, 0.35)})
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.04), "armL_rot": (0, 0, -0.2), "show": slack},
        {"root_rot": lean(-0.1), "armL_rot": (0, 0, 0.06), "head_rot": (-0.04, 0, 0)},
        {"root_rot": lean(-0.14), "root_scale": (1.02, 1.02, 0.98), "armL_rot": (0, 0, 0.16), "head_rot": (-0.06, 0, 0)},
        {"root_loc": lunge(-0.12), "root_rot": lean(-0.2), "armL_rot": (0.2, 0, 0.5), "armR_rot": (-0.08, 0, 0.06), "show": loose},
        {"root_loc": lunge(-0.08), "root_rot": lean(-0.12), "armL_rot": (0.15, 0, 0.42), "armR_rot": (-0.05, 0, 0.03), "show": loose},
        {"root_rot": lean(-0.05), "armL_rot": (0.05, 0, 0.2), "show": loose},
        {"armL_rot": (0, 0, -0.1), "show": slack},
    ]}
    clips["hit"] = hit_clip(base={"show": {"arrow_default": False, "draw_default": False, "slack": True}})
    clips["defeat"] = topple_clip(base={"show": loose})
    return clips


# ---------------------------------------------------------------- Frostshell

def frostshell():
    """Frostshell (card 04): stern Chog face inside a crown of tall ice
    crystals, the body cased in faceted ice plates over a dark undersuit,
    crystal shoulder clusters and a gauntlet, and a large hexagonal ice shield
    carried forward on the screen-right arm. Crystals shatter on defeat."""
    hc, r = V((0, 0, 3.28)), 1.12
    rig = U.make_rig(joints(hc=hc, sh=(0.72, 0, 1.92), leg=(0.38, 0, 0.95)))
    rig["mirror_geo"] = True
    rnd = random.Random(404)
    iceL = mat("IceLight", "#d4f3ff", rough=0.12, spec=0.9, coat=0.7, emit="#d4f3ff", emit_strength=0.3)
    ice = mat("Ice", "#94d6fb", rough=0.14, spec=0.9, coat=0.7, emit="#9ad9ff", emit_strength=0.18)
    iceD = mat("IceDeep", "#4fa7e6", rough=0.16, spec=0.85, coat=0.6, emit="#4fa7e6", emit_strength=0.08)
    suit = mat("FrostSuit", "#2a2f3b", rough=0.62)
    body, brad = (0, 0, 1.55), (0.9, 0.78, 0.9)
    P = {"name": "Frost", "hc": hc, "r": r, "spike_hex": "#6fbff0", "leg_x": 0.38, "leg_r": 0.25, "body": brad, "body_z": 1.55,
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.255, 0.3), "brow": math.radians(32), "blush": 0.2, "mouth_tilt": 4}}
    chog_legs(rig, P, boots=suit)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.6, 0.76), (0.84, 0.92), (0.9, 1.12), (0.92, 1.3)], suit, ol=0.035)
    for th, h, R in ((-0.38, 0.38, 0.5), (0.4, 0.4, 0.48), (0.0, -0.05, 0.48), (-0.8, -0.05, 0.44), (0.82, -0.05, 0.44),
                     (math.pi, 0.3, 0.58), (math.pi - 0.8, 0.0, 0.5), (math.pi + 0.8, 0.0, 0.5), (math.pi, -0.3, 0.52)):
        pc, nn = U.on_body(body, brad, th, h, 0.05)
        U.plate(rig, "hips", pc, nn, R, 0.2, rnd, material=rnd.choice((ice, ice, iceL, iceD)), ol=0.04, crumble=True, body=body)
    # Chest and flank shards standing out of the armour like the card's.
    for th, h, L in ((-0.5, 0.15, 0.55), (0.55, 0.1, 0.5), (-1.2, 0.3, 0.7), (1.25, 0.25, 0.65), (math.pi - 0.4, 0.55, 0.8), (math.pi + 0.45, 0.5, 0.75), (math.pi, 0.1, 0.7)):
        pc, nn = U.on_body(body, brad, th, h, 0.0)
        crystal(rig, "hips", pc, nn + V((0, 0, 0.5)), L, 0.16, rnd.choice((ice, iceL)), twist=rnd.uniform(0, 1), shatter=body)
    for key, sx in (("legL", -1), ("legR", 1)):
        x = sx * 0.38 * 1.05
        U.plate(rig, key, (x, -0.28, 0.5), (sx * 0.2, -1, 0.1), 0.24, 0.12, rnd, material=ice, ol=0.035, crumble=True, body=body)
        crystal(rig, key, (x + sx * 0.12, -0.05, 0.62), (sx * 0.7, -0.2, 0.7), 0.42, 0.11, iceL, shatter=body)
    for key, sx in (("armL", -1), ("armR", 1)):
        sh = V((sx * 0.72, 0, 1.92))
        for dx, dy, dz, L, rad in ((0.25, 0.0, 0.85, 1.35, 0.3), (0.75, -0.1, 0.55, 1.15, 0.26), (0.5, 0.45, 0.6, 1.2, 0.25),
                                   (0.6, -0.5, 0.35, 0.9, 0.22), (0.95, 0.15, 0.1, 0.95, 0.23), (0.05, 0.5, 0.85, 1.05, 0.22), (0.4, -0.3, 0.9, 1.0, 0.22)):
            crystal(rig, key, sh + V((sx * 0.2, 0.05, 0.1)), (sx * dx, dy, dz), L, rad, rnd.choice((ice, iceL, iceD)), twist=rnd.uniform(0, 1), shatter=body)
        U.plate(rig, key, sh + V((sx * 0.22, 0, 0.14)), (sx * 0.6, 0, 1), 0.58, 0.24, rnd, material=iceD, ol=0.04, crumble=True, body=body)
    handL = V((-1.02, -0.18, 1.18))
    chog_arm(rig, "armL", (-0.72, 0, 1.92), handL, r=0.2, material=suit)
    U.plate(rig, "armL", handL + V((-0.1, -0.02, 0.28)), (-1, -0.3, 0.1), 0.26, 0.14, rnd, material=ice, ol=0.035, crumble=True, body=body)
    crystal(rig, "armL", handL + V((-0.15, 0.05, 0.3)), (-0.8, 0.2, 0.5), 0.45, 0.1, iceL, shatter=body)
    handR = V((0.86, -0.8, 1.45))
    chog_arm(rig, "armR", (0.72, 0, 1.92), handR, elbow=V((1.05, -0.32, 1.5)), r=0.2, material=suit)
    face = V((0.3, -0.95, 0.06)).normalized()
    hexo = [(0.0, 1.5), (0.9, 0.9), (0.98, -0.5), (0.0, -1.5), (-0.98, -0.5), (-0.9, 0.9)]
    sc = handR + face * 0.3 + V((0, 0, 0.05))
    slab(rig, "armR", hexo, 0.34, sc, face, (0, 0, 1), ice, ol=0.05, inset=0.8, bev=0.05)
    slab(rig, "armR", [(x * 0.62, y * 0.62) for x, y in hexo], 0.24, sc + face * 0.17, face, (0, 0, 1), iceL, ol=0.03, inset=0.7, bev=0.04)
    for o in [o for o in bpy.data.objects if "_plate" in o.name]:
        for poly in o.data.polygons:
            poly.use_smooth = False
    chog_head(rig, P)
    u, v, back = head_frame()
    for i in range(11):
        th = math.radians(-125 + 250 * i / 10)
        d = u * math.sin(th) + v * math.cos(th)
        L = r * (1.25 + rnd.uniform(-0.1, 0.15)) * (1 - 0.35 * max(0.0, abs(math.degrees(th)) - 85) / 40)
        crystal(rig, "spikes", hc + back * 0.05 + d * (0.62 * r), d + back * 0.25, L, r * 0.2, (iceL, ice)[i % 2], twist=rnd.uniform(0, 1))
    for i in range(9):
        th = math.radians(-135 + 270 * (i + 0.5) / 9)
        d = u * math.sin(th) + v * math.cos(th)
        crystal(rig, "spikes", hc + back * (0.35 * r) + d * (0.45 * r), d + back * 0.55, r * (1.3 + rnd.uniform(-0.1, 0.1)), r * 0.22, (ice, iceD)[i % 2], twist=rnd.uniform(0, 1))
    for i in range(6):
        th = math.radians(-140 + 280 * i / 5)
        d = u * math.sin(th) + v * math.cos(th)
        crystal(rig, "spikes", hc + back * (0.3 * r), back + d * 0.8, r * 1.0, r * 0.2, (iceD, ice)[i % 2], twist=rnd.uniform(0, 1))
    for x in (-0.4, 0.0, 0.4):
        crystal(rig, "spikes", hc + (v * 0.6 + u * x * 0.5) * r, v + back * 0.5 + u * x, r * 0.75, r * 0.18, iceL)
    # Frost burst for the shield slam (the card's slow), impact frames only.
    for i in range(7):
        a = i / 7 * TAU
        crystal(rig, "yaw", (1.3 + math.cos(a) * 0.7, -1.4 + math.sin(a) * 0.45, 0.05), (math.cos(a) * 0.5, math.sin(a) * 0.3, 1), 0.5 + 0.15 * (i % 3), 0.11, (iceL, ice)[i % 2], sets=["frost"])
    return rig


def frost_clips():
    clips = {"idle": idle_clip(fps=6, bob=0.04, sway=0.03)}
    clips["move"] = walk_clip(fps=9, stride=0.5, bounce=0.12, tilt=0.12, arms=0.25,
                              extra=lambda t, s: {"armR_rot": (-0.08 * s, 0, 0), "root_rot": (0.12, 0.06 * s, 0.04 * s),
                                                  "legL_loc": (0, 0, 0.12 * max(0.0, -s)), "legR_loc": (0, 0, 0.12 * max(0.0, s))})
    frost = {"frost": True}
    clips["attack"] = {"fps": 10, "loop": False, "impact": 4, "frames": [
        {"root_rot": lean(-0.06), "armR_rot": (0.2, 0, 0.1)},
        {"root_loc": lunge(-0.1, 0.05), "root_rot": lean(-0.16), "root_scale": (0.98, 0.98, 1.04), "armR_rot": (0.55, 0, 0.25), "head_rot": (-0.08, 0, 0)},
        {"root_loc": lunge(-0.15, 0.12), "root_rot": lean(-0.22), "root_scale": (0.97, 0.97, 1.06), "armR_rot": (0.75, 0, 0.3), "head_rot": (-0.12, 0, 0)},
        {"root_loc": lunge(0.25, 0.04), "root_rot": lean(0.22), "armR_rot": (-0.35, 0, -0.1), "head_rot": (-0.14, 0, 0)},
        {"root_loc": lunge(0.4, -0.04), "root_rot": lean(0.32), "root_scale": (1.06, 1.06, 0.93), "armR_rot": (-0.55, 0, -0.15), "head_rot": (-0.18, 0, 0), "show": frost},
        {"root_loc": lunge(0.3), "root_rot": lean(0.24), "armR_rot": (-0.45, 0, -0.1), "show": frost},
        {"root_loc": lunge(0.1), "root_rot": lean(0.08), "armR_rot": (-0.1, 0, 0)},
    ]}
    clips["hit"] = hit_clip(n=4, fps=12, k=0.6)
    clips["defeat"] = topple_clip(fps=11, crumble=True)
    return clips


# ---------------------------------------------------------------- Rift Runner

def rift_runner():
    """Rift Runner (card 05): teal front spikes over a purple back layer, all
    swept hard back, a long purple scarf streaming behind, a light cream build
    with dark teal shorts, wrist and ankle wraps, fists up in a sprint."""
    hc, r = V((0, -0.05, 3.12)), 1.08
    rig = U.make_rig(joints(hc=hc, sh=(0.56, 0, 1.84), extra={"scarf": ("hips", (0, 0.35, 2.15))}))
    rig["mirror_geo"] = True
    rnd = random.Random(505)
    teal = (mat("RunnerTealLight", "#4fe0d6", rough=0.55, coat=0.05), mat("RunnerTeal", "#1fb2b0", rough=0.58, coat=0.05),
            mat("RunnerTealDeep", "#118a8e", rough=0.6, coat=0.05))
    purple = (mat("RunnerPurple", "#7c3fd0", rough=0.58), mat("RunnerPurpleDeep", "#56299a", rough=0.6))
    shorts = mat("RunnerShorts", "#1f3f4c", rough=0.6)
    wrap = mat("RunnerWrap", "#26323e", rough=0.65)
    scarf = mat("RunnerScarf", "#6e34c4", rough=0.6)
    scarfD = mat("RunnerScarfDeep", "#4c2390", rough=0.62)
    P = {"name": "Runner", "hc": hc, "r": r, "spike_hex": "#1fb2b0", "body": (0.6, 0.54, 0.74), "body_z": 1.48, "leg_r": 0.21,
         "feet": {"legL": (-0.4, 0.18), "legR": (0.38, -0.24)},
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(30), "blush": 0.2, "mouth_tilt": -14}}
    chog_legs(rig, P)
    for key, (fx, fy) in P["feet"].items():
        band(rig, key, (fx, fy, 0.3), (fx, fy, 0.5), 0.235, wrap, ol=0.03)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.45, 0.78), (0.62, 0.92), (0.64, 1.12), (0.63, 1.26)], shorts, ol=0.035)
    lathe(rig, "hips", [(0.66, 1.2), (0.66, 1.3)], wrap, ol=0.025)
    hR, hL = V((0.86, -0.62, 1.6)), V((-0.82, 0.38, 1.4))
    eR, eL = V((0.9, -0.12, 1.42)), V((-0.86, -0.1, 1.5))
    chog_arm(rig, "armR", (0.56, 0, 1.84), hR, elbow=eR, r=0.17, mitten=False)
    chog_arm(rig, "armL", (-0.56, 0, 1.84), hL, elbow=eL, r=0.17, mitten=False)
    for key, h, e in (("armR", hR, eR), ("armL", hL, eL)):
        part(rig, key, "sphere", h, (0.22, 0.22, 0.22), M["cream"], ol=0.05)
        band(rig, key, e + (h - e) * 0.45, h - (h - e).normalized() * 0.12, 0.19, wrap, ol=0.03)
    part(rig, "hips", "torus", (0, 0, 2.18), (0.62, 0.56, 0.6), scarf, ol=0.035, major_radius=1.0, minor_radius=0.3, major_segments=28, minor_segments=10)
    part(rig, "hips", "sphere", (-0.3, 0.42, 2.12), (0.22, 0.2, 0.2), scarfD, ol=0.03)
    # Tail broad side faces up-ish so the high board camera sees cloth, not an edge.
    tail = [V((-0.5, 0.3, 2.1)), V((-1.0, 0.42, 1.98)), V((-1.55, 0.5, 1.94)), V((-2.05, 0.55, 2.04))]
    ribbon(rig, "scarf", tail, [0.55, 0.52, 0.46, 0.36], V((0.75, 0.4, 0.55)), scarf, thick=0.08)
    ribbon(rig, "scarf", [p + V((0.2, 0.05, -0.18)) for p in tail[:3]], [0.4, 0.36, 0.3], V((0.75, 0.4, 0.55)), scarfD, thick=0.07)
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, (purple[0], teal[1], teal[2]), arc=122, k=1.2, tilt=18, sweep=0.22, rear=7, ring2=(teal[0], purple[1]), rear_mats=purple)
    # Long swept crest blades: the card's streaming purple-over-teal mane.
    u, v, back = head_frame(18)
    for x, L, m in ((-0.62, 1.6, purple[0]), (-0.3, 1.85, purple[1]), (0.02, 1.9, purple[0]), (0.32, 1.75, purple[1]), (0.6, 1.45, purple[0])):
        blade(rig, "spikes", hc + (v * 0.5 + back * 0.25 + u * x * 0.6) * r, v * 0.65 + back * 0.8 + u * x * 0.5, r * L, r * 0.5, m, u.cross(v * 0.65 + back * 0.8), flat=0.38, ol=0.05, verts=16)
    return rig


def runner_clips():
    def flutter(t, k=0.12):
        return {"scarf_rot": (k * math.sin(2 * t), 0, 0.1 * math.sin(2 * t + 1))}
    clips = {"idle": idle_clip(n=6, fps=10, bob=0.07, sway=0.08, extra=lambda t, s: {**flutter(t), "root_loc": (0, 0, 0.05 * abs(s))})}
    clips["move"] = walk_clip(n=8, fps=16, stride=1.05, bounce=0.32, tilt=0.32, arms=0.9,
                              extra=lambda t, s: {"scarf_rot": (0.25 + 0.15 * math.sin(2 * t), 0, 0.15 * math.sin(2 * t + 1)), "head_rot": (0.12, 0, -0.05 * s)})
    clips["attack"] = {"fps": 14, "loop": False, "impact": 2, "frames": [
        {"root_loc": lunge(-0.1), "root_rot": lean(-0.12), "armR_rot": (0.5, 0, 0.2), "scarf_rot": (0.1, 0, 0)},
        {"root_loc": lunge(0.45, 0.12), "root_rot": lean(0.3), "armR_rot": (-0.6, 0, -0.1), "armL_rot": (0.4, 0, 0), "legL_rot": (0.5, 0, 0), "scarf_rot": (0.3, 0, 0.1)},
        {"root_loc": lunge(0.75, 0.05), "root_rot": lean(0.42), "root_scale": (1.06, 1.06, 0.94), "armR_rot": (-1.1, 0, -0.2), "armL_rot": (0.6, 0, 0), "legL_rot": (0.6, 0, 0), "head_rot": (-0.1, 0, 0), "scarf_rot": (0.4, 0, 0.15)},
        {"root_loc": lunge(0.55), "root_rot": lean(0.3), "armR_rot": (-0.4, 0, 0), "armL_rot": (-0.7, 0, 0), "scarf_rot": (0.3, 0, 0.05)},
        {"root_loc": lunge(0.25), "root_rot": lean(0.12), "armL_rot": (-0.2, 0, 0), "scarf_rot": (0.15, 0, 0)},
        {"root_loc": lunge(0.05), "scarf_rot": (0.05, 0, 0)},
    ]}
    clips["hit"] = hit_clip()
    clips["defeat"] = topple_clip(fps=13, spin=0.8)
    return clips


# ---------------------------------------------------------------- Sparkcaster

def sparkcaster():
    """Sparkcaster (card 06): golden spikes, cheerful Chog face, black robe
    with gold trim, high collar, gold buttons and a glowing medallion, a black
    cape with a gold edge, and a wooden staff whose claw holds a glowing
    spark orb crackling with lightning."""
    hc, r = V((0, 0, 3.22)), 1.1
    rig = U.make_rig(joints(hc=hc, extra={"orb": ("armR", (0.98, -0.5, 3.62))}))
    rig["mirror_geo"] = True
    rnd = random.Random(606)
    gold3 = (mat("SparkSpikeLight", "#ffe45a", rough=0.5, coat=0.1), mat("SparkSpike", "#ffcc1a", rough=0.52, coat=0.1),
             mat("SparkSpikeDeep", "#e6a400", rough=0.55, coat=0.1))
    robe = mat("SparkRobe", "#1d1a24", rough=0.55)
    robeL = mat("SparkRobeLight", "#2d2836", rough=0.55)
    trim = mat("SparkTrim", "#f2b630", rough=0.3, metal=0.85)
    wood = mat("SparkStaff", "#7a4a24", rough=0.6)
    woodD = mat("SparkStaffDark", "#55331a", rough=0.62)
    orb = mat("SparkOrb", "#fff2a0", rough=0.1, emit="#ffd83a", emit_strength=6.0)
    bolt = mat("SparkBolt", "#fff7c2", rough=0.2, emit="#ffe04a", emit_strength=8.0)
    gem = mat("SparkGem", "#ffd23a", rough=0.08, emit="#ffb400", emit_strength=2.5, coat=0.8)
    P = {"name": "Spark", "hc": hc, "r": r, "spike_hex": "#ffcc1a",
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(22), "blush": 0.21, "mouth_tilt": -14}}
    chog_legs(rig, P)
    chog_body(rig, P)
    # Robe: flared skirt to the shins, fitted chest, gold hem and front trim.
    lathe(rig, "hips", [(0.95, 0.42), (0.86, 0.7), (0.74, 1.1), (0.72, 1.45), (0.66, 1.8), (0.5, 2.08)], robe, ol=0.045, cap=(True, False))
    lathe(rig, "hips", [(0.98, 0.38), (0.98, 0.5)], trim, ol=0.03)
    for sx in (-1, 1):
        tube(rig, "hips", [(sx * 0.12, -0.8, 0.42), (sx * 0.11, -0.7, 1.1), (sx * 0.1, -0.66, 1.5), (sx * 0.08, -0.56, 1.95)], 0.05, trim, segs=8, ol=0.02)
    for z in (1.25, 1.0, 0.75):
        part(rig, "hips", "sphere", (0, -0.74 - 0.03 * (1.25 - z), z), (0.07, 0.04, 0.07), trim, ol=0.015)
    # High collar and glowing medallion.
    lathe(rig, "hips", [(0.5, 1.98), (0.6, 2.12), (0.74, 2.32)], robeL, ol=0.035)
    lathe(rig, "hips", [(0.75, 2.3), (0.77, 2.36)], trim, ol=0.02)
    part(rig, "hips", "cyl", (0, -0.66, 1.66), (0.22, 0.22, 0.06), trim, rot=(math.radians(80), 0, 0), ol=0.025, vertices=20)
    part(rig, "hips", "sphere", (0, -0.7, 1.66), (0.11, 0.06, 0.11), gem, ol=0.0)
    # Cape behind, sweeping out to the left with a gold edge.
    cape = [V((0, 0.45, 2.1)), V((-0.1, 0.75, 1.5)), V((-0.35, 0.95, 0.9)), V((-0.6, 1.05, 0.35))]
    ribbon(rig, "hips", cape, [1.3, 1.5, 1.7, 1.9], V((1, 0.15, 0)), robe, thick=0.08, ol=0.04)
    ribbon(rig, "hips", [p + V((0, 0.06, -0.02)) for p in cape[2:]] + [cape[-1] + V((-0.02, 0.07, -0.1))], [1.75, 1.95, 1.95], V((1, 0.15, 0)), trim, thick=0.05, ol=0.02)
    # Arms in robe sleeves with gold cuffs; staff in the screen-right hand.
    hR, hL = V((0.98, -0.5, 1.5)), V((-0.9, -0.32, 1.28))
    for key, sh, h in (("armR", (0.6, 0, 1.88), hR), ("armL", (-0.6, 0, 1.88), hL)):
        capsule(rig, key, sh, h, 0.22, robe, r1=0.26)
        band(rig, key, h + (V(sh) - h).normalized() * 0.32, h + (V(sh) - h).normalized() * 0.18, 0.28, trim, ol=0.02)
        part(rig, key, "sphere", h, (0.22, 0.22, 0.22), M["cream"], ol=0.05)
    tube(rig, "armR", [(0.98, -0.5, 0.15), (0.98, -0.5, 1.2), (0.99, -0.5, 2.6), (0.98, -0.5, 3.3)], [0.07, 0.08, 0.075, 0.08], wood, segs=10, ol=0.03)
    tube(rig, "armR", [(0.98, -0.5, 3.15), (0.98, -0.5, 3.35)], 0.11, woodD, segs=10, ol=0.02)
    oc = V((0.98, -0.5, 3.62))
    for k in range(3):
        a = k / 3 * TAU + 0.4
        d = V((math.cos(a), math.sin(a), 0))
        tube(rig, "armR", [oc + V((0, 0, -0.32)), oc + d * 0.3 + V((0, 0, -0.18)), oc + d * 0.36 + V((0, 0, 0.08)), oc + d * 0.2 + V((0, 0, 0.28))], [0.06, 0.05, 0.04, 0.015], woodD, segs=8, ol=0.02)
    part(rig, "orb", "sphere", oc, (0.3, 0.3, 0.3), orb, ol=0.0, segments=24, ring_count=12)
    part(rig, "orb", "sphere", oc, (0.42, 0.42, 0.42), glow_mat("SparkHalo", "#fff2a0", "#ffd83a", strength=3.0, alpha=0.25), ol=0.0, segments=24, ring_count=12)
    # Lightning: two small idle crackles, a full burst for the cast.
    def zig(c, d, L, n, sets):
        side = d.orthogonal().normalized()
        pts = [c + d * (L * i / n) + side * (0.1 if i % 2 else -0.1) * (0 < i < n) for i in range(n + 1)]
        tube(rig, "orb", pts, [0.035] * n + [0.01], bolt, segs=6, ol=0.012, sets=sets)
    for a in (0.6, 2.6):
        zig(oc + V((math.cos(a), math.sin(a), 0.3)) * 0.32, V((math.cos(a), math.sin(a), 0.8)).normalized(), 0.45, 3, ["crackle_default"])
    for k in range(6):
        a = k / 6 * TAU
        zig(oc + V((math.cos(a), math.sin(a), 0.2)) * 0.35, V((math.cos(a), math.sin(a), 0.25 * (k % 3 - 1))).normalized(), 0.75, 4, ["sparks"])
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, gold3, arc=128, k=1.12, sweep=0.1)
    return rig


def spark_clips():
    clips = {"idle": idle_clip(fps=8, bob=0.04, sway=0.04, extra=lambda t, s: {"orb_scale": 1 + 0.06 * math.sin(2 * t), "armR_rot": (-0.03 * s, 0, 0)})}
    clips["move"] = walk_clip(fps=11, stride=0.6, bounce=0.2, tilt=0.12, arms=0.35,
                              extra=lambda t, s: {"armR_rot": (-0.1 * s, -0.1, 0), "orb_scale": 1 + 0.05 * math.sin(2 * t)})
    burst = {"sparks": True}
    clips["attack"] = {"fps": 10, "loop": False, "impact": 4, "frames": [
        {"root_rot": lean(-0.05), "armR_rot": (0.15, 0, 0), "orb_scale": 1.05},
        {"root_rot": lean(-0.14), "root_scale": (0.98, 0.98, 1.04), "armR_rot": (0.4, 0, 0.05), "armL_rot": (-0.5, 0.3, 0), "head_rot": (-0.08, 0, 0), "orb_scale": 1.2},
        {"root_rot": lean(-0.2), "root_scale": (0.97, 0.97, 1.05), "armR_rot": (0.55, 0, 0.08), "armL_rot": (-0.9, 0.4, 0), "head_rot": (-0.12, 0, 0), "orb_scale": 1.35, "show": burst},
        {"root_loc": lunge(0.2), "root_rot": lean(0.16), "armR_rot": (-0.35, 0, -0.05), "armL_rot": (-0.4, 0.2, 0), "head_rot": (-0.14, 0, 0), "orb_scale": 1.45, "show": burst},
        {"root_loc": lunge(0.3, -0.02), "root_rot": lean(0.26), "root_scale": (1.04, 1.04, 0.95), "armR_rot": (-0.6, 0, -0.08), "head_rot": (-0.16, 0, 0), "orb_scale": 1.25, "show": burst},
        {"root_loc": lunge(0.18), "root_rot": lean(0.14), "armR_rot": (-0.35, 0, 0), "orb_scale": 0.9},
        {"root_loc": lunge(0.05), "root_rot": lean(0.04), "armR_rot": (-0.1, 0, 0), "orb_scale": 0.95},
        {"orb_scale": 1.0},
    ]}
    clips["hit"] = hit_clip(base={"show": {"crackle_default": False}})
    clips["defeat"] = topple_clip(base={"show": {"crackle_default": False}, "orb_scale": 0.6})
    return clips


# ---------------------------------------------------------------- Chog Guardian

def chog_guardian():
    """Chog Guardian troop (card 07, matching the approved blue defender):
    blue faceted spikes, stern Chog face, thick blue scarf with a knot and
    tail, silver pauldrons, breastplate, gauntlets and greaves, brown belt,
    blue tabard and a riveted round steel shield with a blue field."""
    hc, r = V((0, 0, 3.24)), 1.1
    rig = U.make_rig(joints(hc=hc, sh=(0.66, 0, 1.9), leg=(0.36, 0, 0.95)))
    rig["mirror_geo"] = True
    rnd = random.Random(707)
    blue3 = (mat("GuardianSpikeLight", "#3b86ff", rough=0.38, coat=0.3), mat("GuardianSpike", "#1f63e6", rough=0.38, coat=0.3),
             mat("GuardianSpikeDeep", "#1749b8", rough=0.4, coat=0.3))
    steel = mat("Steel", "#b4bcc7", rough=0.3, metal=0.88)
    steelD = mat("SteelDark", "#737c89", rough=0.36, metal=0.85)
    scarf = mat("Scarf", "#1f5fd6", rough=0.6)
    scarfD = mat("ScarfDeep", "#16459e", rough=0.6)
    leather = mat("Leather", "#7a4a26", rough=0.6)
    brass = mat("Brass", "#e2b04a", rough=0.32, metal=0.85)
    P = {"name": "Guardian", "hc": hc, "r": r, "spike_hex": "#1f63e6", "leg_x": 0.36, "body": (0.74, 0.65, 0.82),
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.255, 0.3), "brow": math.radians(32), "blush": 0.2, "mouth_tilt": -4}}
    chog_legs(rig, P, boots=steelD)
    for key, sx in (("legL", -1), ("legR", 1)):
        part(rig, key, "sphere", (sx * 0.38, -0.2, 0.62), (0.22, 0.16, 0.2), steel, ol=0.03)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.55, 0.78), (0.72, 0.92), (0.77, 1.12), (0.78, 1.24)], steelD, ol=0.035)
    lathe(rig, "hips", [(0.8, 1.2), (0.82, 1.45), (0.79, 1.7), (0.7, 1.92), (0.5, 2.12)], steel, ol=0.045)
    lathe(rig, "hips", [(0.82, 1.1), (0.83, 1.24)], leather, ol=0.03)
    part(rig, "hips", "cube", (0.0, -0.76, 1.17), (0.24, 0.07, 0.18), brass, ol=0.02, bev=0.02)
    ribbon(rig, "hips", [(0, -0.8, 1.08), (0, -0.84, 0.78), (0.02, -0.86, 0.5)], [0.55, 0.5, 0.46], V((1, 0, 0)), scarf, thick=0.06)
    # Scarf: thick wrap with a knot in front and a tail behind.
    part(rig, "hips", "torus", (0, 0, 2.22), (0.72, 0.66, 0.66), scarf, ol=0.035, major_radius=1.0, minor_radius=0.33, major_segments=28, minor_segments=12)
    part(rig, "hips", "sphere", (0.3, -0.66, 2.12), (0.26, 0.2, 0.22), scarfD, ol=0.03)
    ribbon(rig, "hips", [(0.32, -0.72, 2.02), (0.36, -0.8, 1.72), (0.4, -0.84, 1.45)], [0.32, 0.3, 0.26], V((1, 0.1, 0)), scarf, thick=0.08)
    ribbon(rig, "hips", [(0.0, 0.62, 2.15), (-0.15, 0.95, 1.9), (-0.35, 1.2, 1.6), (-0.55, 1.4, 1.35)], [0.5, 0.46, 0.42, 0.36], V((1, 0, 0)), scarf, thick=0.08)
    # Arms: pauldrons, steel gauntlets; shield forward on the screen-right arm.
    hL, hR = V((-0.98, -0.25, 1.22)), V((0.86, -0.72, 1.5))
    eR = V((1.0, -0.25, 1.52))
    chog_arm(rig, "armL", (-0.66, 0, 1.9), hL, r=0.19, mitten=False)
    chog_arm(rig, "armR", (0.66, 0, 1.9), hR, elbow=eR, r=0.19, mitten=False)
    for key, sx, h in (("armL", -1, hL), ("armR", 1, hR)):
        lathe(rig, key, [(0.5, -0.05), (0.52, 0.12), (0.44, 0.3), (0.22, 0.42)], steel, origin=(sx * 0.78, 0.0, 1.96), axis=(sx * 0.45, 0, 1), sy=0.95, ol=0.04, cap=(True, True))
        lathe(rig, key, [(0.54, -0.12), (0.56, -0.02)], steelD, origin=(sx * 0.78, 0.0, 1.96), axis=(sx * 0.45, 0, 1), sy=0.95, ol=0.025)
        part(rig, key, "sphere", h, (0.26, 0.25, 0.25), steel, ol=0.045)
    sf = V((0.3, -0.95, 0.04)).normalized()
    sc = hR + sf * 0.28
    rot = U.orient(sf, (0, 0, 1)).to_euler()
    part(rig, "armR", "cyl", sc, (1.0, 1.0, 0.2), steel, rot=rot, ol=0.05, vertices=40)
    part(rig, "armR", "cyl", sc + sf * 0.08, (0.8, 0.8, 0.12), mat("ShieldBlue", "#2a6ee6", rough=0.45), rot=rot, ol=0.02, vertices=40)
    part(rig, "armR", "sphere", sc + sf * 0.16, (0.28, 0.28, 0.16), steel, rot=rot, ol=0.03)
    up = V((0, 0, 1))
    side = up.cross(sf).normalized()
    for k in range(10):
        a = k / 10 * TAU
        part(rig, "armR", "sphere", sc + sf * 0.11 + (side * math.cos(a) + up * math.sin(a)) * 0.9, (0.055, 0.055, 0.055), steelD, ol=0.0, segments=8, ring_count=6)
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, blue3, arc=128, k=1.1, sweep=0.12)
    return rig


def guardian_clips():
    clips = {"idle": idle_clip(fps=7, bob=0.035, sway=0.03)}
    clips["move"] = walk_clip(fps=11, stride=0.65, bounce=0.18, tilt=0.12, arms=0.4, extra=lambda t, s: {"armR_rot": (-0.1 * s, 0, 0)})
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.06), "armL_rot": (0.4, 0, 0.3)},
        {"root_loc": lunge(-0.1), "root_rot": lean(-0.16), "armL_rot": (0.7, 0, 0.5), "armR_rot": (0.2, 0, 0.1), "head_rot": (-0.08, 0, 0)},
        {"root_loc": lunge(0.25), "root_rot": lean(0.18), "armL_rot": (-0.9, 0, -0.5), "armR_rot": (-0.2, 0, 0), "head_rot": (-0.12, 0, 0)},
        {"root_loc": lunge(0.5, 0.02), "root_rot": lean(0.32), "root_scale": (1.05, 1.05, 0.95), "armL_rot": (-1.45, 0, -0.75), "armR_rot": (-0.45, 0, -0.1), "head_rot": (-0.16, 0, 0)},
        {"root_loc": lunge(0.4), "root_rot": lean(0.26), "armL_rot": (-1.2, 0, -0.6), "armR_rot": (-0.35, 0, 0)},
        {"root_loc": lunge(0.18), "root_rot": lean(0.1), "armL_rot": (-0.4, 0, -0.2), "armR_rot": (-0.1, 0, 0)},
        {"root_loc": lunge(0.04)},
    ]}
    clips["hit"] = hit_clip(n=4, fps=12, k=0.7)
    clips["defeat"] = topple_clip(fps=12)
    return clips


# ---------------------------------------------------------------- wings

def bat_wing(rig, key, sx, w0, mem, bone, size=1.0):
    """Bat wing in the rig's rest pose: arm bone to a wrist, four finger bones
    and a scalloped membrane between them, spread out to the side and up."""
    w0 = V(w0)
    k = size
    wrist = w0 + V((sx * 0.95, 0.2, 0.5)) * k
    tips = [w0 + V(t) * k for t in ((sx * 2.35, 0.3, 1.05), (sx * 2.75, 0.32, 0.12), (sx * 2.2, 0.3, -0.62), (sx * 1.15, 0.25, -0.82))]
    start, end = w0 + V((sx * 0.1, 0.1, 0.3)) * k, w0 + V((sx * 0.15, 0.15, -0.45)) * k
    rim = [start, tips[0]]
    for a, b in zip(tips, tips[1:]):
        rim += [(a + b) / 2 + (wrist - (a + b) / 2) * 0.32, b]
    rim += [(tips[-1] + end) / 2 + (wrist - (tips[-1] + end) / 2) * 0.25, end, start]
    poly(rig, key, [wrist] + rim, mem, ol=0.035, solid=0.05)
    tube(rig, key, [w0, wrist], [0.09 * k, 0.07 * k], bone, segs=8, ol=0.03)
    for t in tips:
        tube(rig, key, [wrist, t], [0.06 * k, 0.02 * k], bone, segs=6, ol=0.025)
    part(rig, key, "cone", tips[0] + V((sx * 0.05, 0, 0.12)) * k, (0.08 * k, 0.08 * k, 0.25 * k), bone, rot=(0, -sx * 0.5, 0), ol=0.02, vertices=8, radius1=1.0, radius2=0.0)


def fairy_wing(rig, key, sx, w0, upper, lower, vein, size=1.0):
    """Rift Sprite wing: a long upper lobe and a small lower lobe, translucent
    and glowing, with violet veins."""
    w0 = V(w0)
    for c_off, rx, rz, tilt, m in (((sx * 1.05, 0.3, 0.45), 1.1, 0.48, sx * 0.38, upper), ((sx * 0.7, 0.25, -0.35), 0.62, 0.3, -sx * 0.45, lower)):
        c = w0 + V(c_off) * size
        pts = []
        for i in range(20):
            a = i / 20 * TAU
            x, z = math.cos(a) * rx * size, math.sin(a) * rz * size
            pts.append(c + V((x * math.cos(tilt) - z * math.sin(tilt), 0.1 * x, x * math.sin(tilt) + z * math.cos(tilt))))
        poly(rig, key, [c] + pts + [pts[0]], m, ol=0.02, solid=0.03)
        tube(rig, key, [w0, c, c + (c - w0) * 0.75], [0.03 * size, 0.025 * size, 0.008], vein, segs=6, ol=0.0)


# ---------------------------------------------------------------- Hexwing

def hexwing():
    """Hexwing (card 08): small purple-spiked Chog with a smug grin, bare cream
    body, purple-tipped claws, a curling purple tail and big purple bat wings.
    Flies: the body hovers over its ground shadow and the wings beat."""
    hc, r = V((0, 0, 3.0)), 1.08
    rig = U.make_rig(joints(hc=hc, sh=(0.55, 0, 1.78), extra={"wingL": ("hips", (-0.35, 0.42, 1.95)), "wingR": ("hips", (0.35, 0.42, 1.95)), "tail": ("hips", (0, 0.5, 1.2))}))
    rig["mirror_geo"] = True
    rnd = random.Random(808)
    purple = (mat("HexSpikeLight", "#a466ec", rough=0.55, coat=0.05), mat("HexSpike", "#7e3fd0", rough=0.58, coat=0.05), mat("HexSpikeDeep", "#5a2a9e", rough=0.6, coat=0.05))
    mem = mat("HexMembrane", "#5a2aa6", rough=0.5, sss=0.1, emit="#4a1c9a", emit_strength=0.12)
    bone = mat("HexBone", "#2e1458", rough=0.5)
    claw = mat("HexClaw", "#4a2384", rough=0.4)
    hexo = mat("HexOrb", "#e0b8ff", rough=0.1, emit="#b46cff", emit_strength=6.0)
    P = {"name": "Hex", "hc": hc, "r": r, "spike_hex": "#7e3fd0", "body": (0.62, 0.56, 0.72), "body_z": 1.45, "leg_r": 0.2,
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(30), "blush": 0.21, "mouth_tilt": -18}}
    chog_legs(rig, P)
    for key, sx in (("legL", -1), ("legR", 1)):
        for kk in (-1, 0, 1):
            part(rig, key, "cone", (sx * 0.37 + kk * 0.15, -0.68, 0.14), (0.06, 0.06, 0.13), claw, rot=(math.radians(-80), 0, 0), ol=0.015, vertices=8, radius1=1.0, radius2=0.0)
    chog_body(rig, P)
    for key, sx in (("armL", -1), ("armR", 1)):
        h = V((sx * 0.82, -0.42, 1.38))
        chog_arm(rig, key, (sx * 0.55, 0, 1.78), h, r=0.16)
        for kk in (-1, 0, 1):
            part(rig, key, "cone", h + V((kk * 0.1, -0.2, -0.12)), (0.045, 0.045, 0.12), claw, rot=(math.radians(-120), 0, 0), ol=0.012, vertices=6, radius1=1.0, radius2=0.0)
    tube(rig, "tail", [(0, 0.5, 1.2), (-0.2, 0.95, 0.95), (-0.55, 1.2, 0.85), (-0.85, 1.25, 1.05), (-0.95, 1.1, 1.3)], [0.13, 0.11, 0.09, 0.07, 0.05], M["cream"], segs=10, ol=0.03)
    part(rig, "tail", "sphere", (-0.95, 1.1, 1.36), (0.16, 0.12, 0.2), purple[1], ol=0.03)
    blade(rig, "tail", (-0.95, 1.1, 1.36), (-0.2, 0, 1), 0.38, 0.18, purple[1], (0, 1, 0), flat=0.4, ol=0.03, verts=8)
    bat_wing(rig, "wingL", -1, (-0.35, 0.42, 1.95), mem, bone, size=1.3)
    bat_wing(rig, "wingR", 1, (0.35, 0.42, 1.95), mem, bone, size=1.3)
    for i in range(5):
        a = i / 5 * TAU
        part(rig, "armR", "ico", V((1.25, -0.9, 1.45)) + V((math.cos(a), 0, math.sin(a))) * 0.12, (0.2, 0.2, 0.2) if i == 0 else (0.08, 0.08, 0.08), hexo, ol=0.0, subdivisions=2, sets=["hex"])
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, purple, arc=125, k=1.05, sweep=0.15)
    return rig


def hex_clips():
    H = 1.0
    clips = {"idle": fly_clip(n=6, fps=12, hover=H, bob=0.16, flap=0.55, bias=-0.1, extra=lambda t, s: {"tail_rot": (0.12 * math.sin(t + 1), 0, 0.15 * s)})}
    clips["move"] = fly_clip(n=6, fps=14, hover=H + 0.1, bob=0.2, flap=0.7, bias=-0.1, tilt=0.28,
                             extra=lambda t, s: {"tail_rot": (0.3, 0, 0.15 * s), "legL_rot": (0.6, 0, 0), "legR_rot": (0.5, 0, 0)})
    hx = {"hex": True}
    w = lambda a: {"wingL_rot": (0, a, 0), "wingR_rot": (0, -a, 0)}  # noqa: E731
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_loc": (0, 0, H + 0.1), "root_rot": lean(-0.08), **w(0.6), "armR_rot": (0.4, 0, 0)},
        {"root_loc": (0, 0.1, H + 0.25), "root_rot": lean(-0.22), **w(1.1), "armR_rot": (0.8, 0, 0.2), "head_rot": (-0.1, 0, 0)},
        {"root_loc": lunge(0.25, H + 0.15), "root_rot": lean(0.15), **w(-0.3), "armR_rot": (-0.6, 0, -0.1), "show": hx},
        {"root_loc": lunge(0.45, H), "root_rot": lean(0.3), **w(-0.8), "armR_rot": (-1.0, 0, -0.2), "head_rot": (-0.12, 0, 0), "show": hx},
        {"root_loc": lunge(0.3, H + 0.05), "root_rot": lean(0.18), **w(-0.2), "armR_rot": (-0.6, 0, 0)},
        {"root_loc": lunge(0.1, H + 0.1), "root_rot": lean(0.05), **w(0.4), "armR_rot": (-0.2, 0, 0)},
        {"root_loc": (0, 0, H), **w(0.6)},
    ]}
    clips["hit"] = hit_clip(base={"root_loc": (0, 0, H), **w(0.9)})
    clips["defeat"] = topple_clip(base={**w(1.0)}, hover=H, spin=0.6)
    return clips


# ---------------------------------------------------------------- Rift Sprites

def rift_sprites():
    """Rift Sprites (card 09): tiny Chogs with spikes shading from cyan at the
    front to violet at the back, a playful grin, glowing translucent fairy
    wings and glowing cyan toes. Fly in a quick, light flutter."""
    hc, r = V((0, 0, 2.95)), 1.08
    rig = U.make_rig(joints(hc=hc, sh=(0.55, 0, 1.76), extra={"wingL": ("hips", (-0.3, 0.42, 1.95)), "wingR": ("hips", (0.3, 0.42, 1.95))}))
    rig["mirror_geo"] = True
    rnd = random.Random(909)
    cyan = (mat("SpriteCyanLight", "#7ff0ff", rough=0.45, coat=0.2, emit="#5fe0ff", emit_strength=0.2), mat("SpriteCyan", "#2fc8f2", rough=0.48, coat=0.2),
            mat("SpriteBlue", "#3f8ef0", rough=0.5, coat=0.2))
    violet = (mat("SpriteViolet", "#8a5cf0", rough=0.5, coat=0.2), mat("SpriteVioletDeep", "#6a3fd0", rough=0.52, coat=0.2))
    up = glow_mat("SpriteWingUp", "#9ff0ff", "#5fd8ff", strength=2.2, alpha=0.72)
    lo = glow_mat("SpriteWingLow", "#c6a8ff", "#9a6cff", strength=2.2, alpha=0.72)
    vein = mat("SpriteVein", "#8a5cf0", rough=0.4, emit="#8a5cf0", emit_strength=1.0)
    toe = mat("SpriteToe", "#bff6ff", rough=0.2, emit="#5fe0ff", emit_strength=4.0)
    P = {"name": "Sprite", "hc": hc, "r": r, "spike_hex": "#2fc8f2", "body": (0.6, 0.55, 0.7), "body_z": 1.44, "leg_r": 0.2,
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.27, 0.32), "brow": math.radians(26), "blush": 0.22, "mouth_tilt": -16}}
    chog_legs(rig, P)
    for key, sx in (("legL", -1), ("legR", 1)):
        part(rig, key, "sphere", (sx * 0.37, -0.66, 0.15), (0.16, 0.12, 0.12), toe, ol=0.02)
    chog_body(rig, P)
    for key, sx in (("armL", -1), ("armR", 1)):
        chog_arm(rig, key, (sx * 0.55, 0, 1.76), (sx * 0.84, -0.3, 1.3), r=0.16)
    fairy_wing(rig, "wingL", -1, (-0.3, 0.42, 1.95), up, lo, vein, size=1.3)
    fairy_wing(rig, "wingR", 1, (0.3, 0.42, 1.95), up, lo, vein, size=1.3)
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, cyan, arc=125, k=1.15, sweep=0.2, ring2=(cyan[2], violet[0]), rear_mats=violet)
    return rig


def sprite_clips():
    H = 0.9
    clips = {"idle": fly_clip(n=6, fps=14, hover=H, bob=0.14, flap=0.5, bias=-0.05)}
    clips["move"] = fly_clip(n=6, fps=16, hover=H + 0.1, bob=0.18, flap=0.6, bias=-0.05, tilt=0.3, extra=lambda t, s: {"legL_rot": (0.55, 0, 0), "legR_rot": (0.45, 0, 0)})
    w = lambda a: {"wingL_rot": (0, a, 0), "wingR_rot": (0, -a, 0)}  # noqa: E731
    clips["attack"] = {"fps": 14, "loop": False, "impact": 2, "frames": [
        {"root_loc": (0, 0.1, H + 0.2), "root_rot": lean(-0.2), **w(0.8), "head_rot": (-0.1, 0, 0)},
        {"root_loc": lunge(0.4, H - 0.1), "root_rot": lean(0.35), **w(-0.4), "armR_rot": (-0.8, 0, 0)},
        {"root_loc": lunge(0.7, H - 0.35), "root_rot": lean(0.55), "root_scale": (1.05, 1.05, 0.95), **w(-0.7), "armR_rot": (-1.2, 0, 0), "armL_rot": (-1.0, 0, 0), "head_rot": (-0.15, 0, 0)},
        {"root_loc": lunge(0.4, H - 0.1), "root_rot": lean(0.25), **w(0.3)},
        {"root_loc": lunge(0.1, H), "root_rot": lean(0.05), **w(0.6)},
    ]}
    clips["hit"] = hit_clip(base={"root_loc": (0, 0, H), **w(0.8)})
    clips["defeat"] = topple_clip(base={**w(1.0)}, hover=H, spin=1.2, fps=14)
    return clips


# ---------------------------------------------------------------- Gale Netter

def gale_netter():
    """Gale Netter (card 10): green spikes, focused Chog face, green tunic
    with leather harness, belt and pouches, brown boots and bracers, a
    bedroll log on the back and a wooden net launcher held in both hands
    with a rope net hanging from its hoop."""
    hc, r = V((0, 0, 3.2)), 1.1
    rig = U.make_rig(joints(hc=hc))
    rig["mirror_geo"] = True
    rnd = random.Random(1010)
    green = (mat("NetterSpikeLight", "#72d858", rough=0.55, coat=0.05), mat("NetterSpike", "#3fb53a", rough=0.58, coat=0.05), mat("NetterSpikeDeep", "#2a8a2a", rough=0.6, coat=0.05))
    tunic = mat("NetterTunic", "#3f8a3a", rough=0.6)
    tunicD = mat("NetterTunicDeep", "#2c6a2c", rough=0.62)
    leather = mat("Leather", "#7a4a26", rough=0.62)
    leatherD = mat("LeatherDark", "#4e2e18", rough=0.66)
    wood = mat("NetterWood", "#9a6232", rough=0.6)
    woodL = mat("NetterWoodLight", "#d8b27a", rough=0.6)
    rope = mat("NetterRope", "#eadcbc", rough=0.7)
    brass = mat("Brass", "#e2b04a", rough=0.32, metal=0.85)
    P = {"name": "Netter", "hc": hc, "r": r, "spike_hex": "#3fb53a",
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.26, 0.31), "brow": math.radians(28), "blush": 0.21, "mouth_tilt": -8}}
    chog_legs(rig, P, boots=leather)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.52, 0.78), (0.7, 0.92), (0.72, 1.15), (0.72, 1.45), (0.67, 1.72), (0.56, 1.95), (0.42, 2.1)], tunic, ol=0.04)
    lathe(rig, "hips", [(0.74, 0.88), (0.76, 1.0)], tunicD, ol=0.025)
    lathe(rig, "hips", [(0.75, 1.15), (0.76, 1.28)], leatherD, ol=0.03)
    part(rig, "hips", "cube", (0.0, -0.73, 1.22), (0.18, 0.06, 0.14), brass, ol=0.02, bev=0.02)
    for x, y in ((0.55, -0.42), (-0.62, -0.25)):
        part(rig, "hips", "cube", (x, y, 1.05), (0.26, 0.2, 0.28), leather, rot=(0, 0, math.atan2(y, x) + math.pi / 2), ol=0.03, bev=0.06)
    # Harness strap across the chest over the left shoulder.
    tube(rig, "hips", [(0.62, -0.42, 1.2), (0.3, -0.66, 1.5), (-0.2, -0.62, 1.85), (-0.5, -0.28, 2.1), (-0.48, 0.3, 2.05), (0.1, 0.66, 1.6), (0.6, 0.45, 1.2)], 0.07, leather, segs=8, ol=0.025)
    # Bedroll log on the back.
    lc = V((-0.3, 0.78, 1.75))
    ax = V((1, 0.15, 0.25)).normalized()
    lathe(rig, "hips", [(0.3, -0.75), (0.32, -0.6), (0.32, 0.6), (0.3, 0.75)], wood, origin=lc, axis=ax, sy=1.0, segs=18, ol=0.04, cap=(True, True))
    for e in (-0.76, 0.76):
        part(rig, "hips", "cyl", lc + ax * e, (0.26, 0.26, 0.02), woodL, rot=U.orient(ax, (0, 0, 1)).to_euler(), ol=0.0, vertices=18)
    for e in (-0.35, 0.35):
        lathe(rig, "hips", [(0.335, e - 0.05), (0.335, e + 0.05)], leatherD, origin=lc, axis=ax, sy=1.0, segs=18, ol=0.02)
    # Net launcher: stock held in both hands, hoop at the front, rope net.
    s0, s1 = V((0.05, -0.85, 1.55)), V((1.6, -1.12, 1.78))
    sd = (s1 - s0).normalized()
    hL, hR = s0 + sd * 0.15, s0 + sd * 0.8
    chog_arm(rig, "armL", (-0.6, 0, 1.88), hL, elbow=V((-0.5, -0.6, 1.5)), mitten=False)
    chog_arm(rig, "armR", (0.6, 0, 1.88), hR, elbow=V((0.95, -0.4, 1.55)), mitten=False)
    for key, h, e in (("armL", hL, V((-0.5, -0.6, 1.5))), ("armR", hR, V((0.95, -0.4, 1.55)))):
        part(rig, key, "sphere", h, (0.22, 0.22, 0.22), M["cream"], ol=0.05)
        band(rig, key, e + (h - e) * 0.3, h - (h - e).normalized() * 0.15, 0.2, leather, ol=0.03)
    tube(rig, "armR", [s0 - sd * 0.15, s1], [0.09, 0.08], wood, segs=10, ol=0.03)
    part(rig, "armR", "cube", s0 + sd * 0.4 + V((0, 0, -0.18)), (0.16, 0.14, 0.36), wood, rot=U.orient(sd, (0, 0, 1)).to_euler(), ol=0.025, bev=0.04)
    hoop = s1 + sd * 0.4 + V((0, 0, -0.05))
    part(rig, "armR", "torus", hoop, (0.48, 0.48, 0.48), wood, rot=(math.radians(12), math.radians(-14), 0), ol=0.025, major_radius=1.0, minor_radius=0.09, major_segments=28, minor_segments=8, sets=["net_default"])
    tube(rig, "armR", [s1, hoop - sd * 0.46], 0.07, wood, segs=8, ol=0.02)
    bag = lathe(rig, "armR", [(0.47, 0.0), (0.44, -0.22), (0.38, -0.46), (0.28, -0.7), (0.16, -0.9), (0.04, -1.04)], rope, origin=hoop, sy=1.0, segs=16, ol=0.0, sets=["net_default"])
    wf = bag.modifiers.new("Net", "WIREFRAME")
    wf.thickness = 0.035
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, green, arc=125, k=1.1, sweep=0.15)
    return rig


def netter_clips():
    clips = {"idle": idle_clip(fps=8, bob=0.035, sway=0.02, extra=lambda t, s: {"armR_rot": (-0.03 * s, 0, 0), "armL_rot": (-0.03 * s, 0, 0)})}
    clips["move"] = walk_clip(fps=12, stride=0.7, bounce=0.2, tilt=0.12, arms=0.0, extra=lambda t, s: {"armR_rot": (0.05 * s, 0, 0), "armL_rot": (0.05 * s, 0, 0)})
    fired = {"net_default": False}
    both = lambda a, z=0.0: {"armR_rot": (a, 0, z), "armL_rot": (a, 0, z)}  # noqa: E731
    clips["attack"] = {"fps": 12, "loop": False, "impact": 3, "frames": [
        {"root_rot": lean(-0.06), **both(0.08)},
        {"root_loc": lunge(-0.08), "root_rot": lean(-0.16), **both(0.25, 0.08), "head_rot": (-0.06, 0, 0)},
        {"root_loc": lunge(0.15), "root_rot": lean(0.12), **both(-0.2, -0.05), "head_rot": (-0.1, 0, 0)},
        {"root_loc": lunge(0.05), "root_rot": lean(-0.08), **both(0.3, 0.05), "root_scale": (1.03, 1.03, 0.97), "show": fired},
        {"root_loc": lunge(-0.05), "root_rot": lean(-0.1), **both(0.22), "show": fired},
        {"root_rot": lean(-0.04), **both(0.1), "show": fired},
        {**both(0.0)},
    ]}
    clips["hit"] = hit_clip()
    clips["defeat"] = topple_clip()
    return clips


# ---------------------------------------------------------------- Riftbreaker

def riftbreaker():
    """Riftbreaker (card 11): black spikes with glowing orange tips, stern
    Chog face, dark armour with brown leather straps, a steel buckle, steel
    knee guards with molten cracks, dark gauntlets glowing orange at the
    knuckles, and a huge molten-cracked stone hammer on the left shoulder."""
    hc, r = V((0, 0, 3.26)), 1.12
    rig = U.make_rig(joints(hc=hc, sh=(0.68, 0, 1.92), leg=(0.38, 0, 0.95)))
    rig["mirror_geo"] = True
    rnd = random.Random(1111)
    dark3 = (mat("BreakerSpikeLight", "#3e3944", rough=0.45, coat=0.2), mat("BreakerSpike", "#25212a", rough=0.48, coat=0.2), mat("BreakerSpikeDeep", "#18151c", rough=0.5, coat=0.2))
    ember = mat("BreakerEmber", "#e0601e", rough=0.4, emit="#ff5a0a", emit_strength=1.2)
    armor = mat("BreakerArmor", "#2b2830", rough=0.42, metal=0.35, coat=0.2)
    armorL = mat("BreakerArmorLight", "#3e3a45", rough=0.4, metal=0.35, coat=0.2)
    leather = mat("Leather", "#7a4a26", rough=0.62)
    steel = mat("Steel", "#9aa2ad", rough=0.32, metal=0.85)
    lava = lava_mat("BreakerHammer", rock="#56504e", glow="#ff5a0a", scale=2.4, width=0.06, strength=3.5)
    glove = lava_mat("BreakerGlove", rock="#2a2630", glow="#ff5a0a", scale=3.2, width=0.035, strength=3.0, rough=0.45)
    knee = lava_mat("BreakerKnee", rock="#8a8f98", glow="#ff5a0a", scale=3.0, width=0.04, strength=3.0, rough=0.35)
    P = {"name": "Breaker", "hc": hc, "r": r, "spike_hex": "#25212a", "leg_x": 0.38, "leg_r": 0.25, "body": (0.78, 0.68, 0.84),
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.255, 0.3), "brow": math.radians(34), "blush": 0.2, "mouth_tilt": 2}}
    chog_legs(rig, P, boots=armor)
    for key, sx in (("legL", -1), ("legR", 1)):
        lathe(rig, key, [(0.3, 0.55), (0.32, 0.8), (0.3, 1.0)], armorL, origin=(sx * 0.38 * 1.04, 0, 0), sy=1.0, segs=18, ol=0.03)
        part(rig, key, "sphere", (sx * 0.4, -0.24, 0.66), (0.26, 0.18, 0.24), knee, ol=0.035)
    chog_body(rig, P)
    lathe(rig, "hips", [(0.6, 0.78), (0.78, 0.92), (0.82, 1.15), (0.83, 1.4), (0.8, 1.68), (0.7, 1.92), (0.5, 2.12)], armor, ol=0.045)
    lathe(rig, "hips", [(0.85, 1.12), (0.86, 1.28)], leather, ol=0.03)
    part(rig, "hips", "cube", (0.0, -0.84, 1.2), (0.3, 0.08, 0.22), steel, ol=0.02, bev=0.03)
    for sx in (-1, 1):
        tube(rig, "hips", [(sx * 0.62, -0.42, 1.3), (sx * 0.3, -0.74, 1.6), (-sx * 0.25, -0.72, 1.9), (-sx * 0.5, -0.3, 2.12)], 0.075, leather, segs=8, ol=0.025)
    part(rig, "hips", "cyl", (0, -0.8, 1.68), (0.16, 0.16, 0.05), steel, rot=(math.radians(80), 0, 0), ol=0.02, vertices=16)
    # Pauldrons and dark gauntlets with glowing knuckles.
    hL, hR = V((-0.66, -0.66, 1.62)), V((0.98, -0.3, 1.18))
    chog_arm(rig, "armL", (-0.68, 0, 1.92), hL, elbow=V((-1.0, -0.3, 1.5)), r=0.2, mitten=False, material=armor)
    chog_arm(rig, "armR", (0.68, 0, 1.92), hR, r=0.2, mitten=False, material=armor)
    for key, sx, h in (("armL", -1, hL), ("armR", 1, hR)):
        lathe(rig, key, [(0.48, -0.05), (0.5, 0.1), (0.42, 0.28), (0.2, 0.4)], armorL, origin=(sx * 0.8, 0.0, 1.98), axis=(sx * 0.45, 0, 1), sy=0.95, ol=0.04, cap=(True, True))
        part(rig, key, "sphere", h, (0.32, 0.3, 0.3), glove, ol=0.045)
    # Hammer: handle from the left hand up over the shoulder, molten head.
    h0, h1 = hL + V((0.3, -0.1, -0.4)), V((-1.85, -0.25, 3.12))
    hd = (h1 - h0).normalized()
    tube(rig, "armL", [h0, h1], [0.085, 0.08], mat("HammerWood", "#5a3a22", rough=0.6), segs=10, ol=0.03)
    for t in (0.0, 0.62):
        tube(rig, "armL", [h0 + hd * (t - 0.1), h0 + hd * (t + 0.1)], 0.11, leather, segs=10, ol=0.02)
    head_axis = hd.cross(V((1, 0, 0))).normalized()
    hc2 = h1 + hd * 0.3
    part(rig, "armL", "cube", hc2, (1.0, 1.0, 1.8), lava, rot=U.orient(head_axis, hd).to_euler(), ol=0.05, bev=0.1, smooth=False)
    for e in (-0.62, 0.62):
        part(rig, "armL", "cube", hc2 + head_axis * e, (1.07, 1.07, 0.14), steel, rot=U.orient(head_axis, hd).to_euler(), ol=0.025, bev=0.03)
    for i in range(6):
        a = i / 6 * TAU
        part(rig, "yaw", "ico", (1.5 + math.cos(a) * 0.8, -1.5 + math.sin(a) * 0.5, 0.2), (0.17, 0.15, 0.13), lava if i % 2 else M["dust"], ol=0.03, subdivisions=1, smooth=False, sets=["chips"])
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, dark3, arc=128, k=1.12, sweep=0.12, ring2=(dark3[1], ember), rear_mats=(dark3[2], dark3[1]))
    return rig


def breaker_clips():
    clips = {"idle": idle_clip(fps=6, bob=0.04, sway=0.02)}
    clips["move"] = walk_clip(fps=9, stride=0.55, bounce=0.14, tilt=0.12, arms=0.0,
                              extra=lambda t, s: {"armR_rot": (0.35 * s, -0.05, 0), "armL_rot": (0.04 * s, 0, 0), "legL_loc": (0, 0, 0.12 * max(0.0, -s)), "legR_loc": (0, 0, 0.12 * max(0.0, s))})
    chips = {"chips": True}
    # Hammer swing as shoulder rotations taking the rest hammer-head direction
    # (from the left shoulder) to targets: wind up behind, over the top, then
    # down onto the ground in front toward screen right where the chips fly.
    rest = V((-1.17, -0.25, 1.2))

    def swing(x, y, z):
        e = rest.rotation_difference(V((x, y, z))).to_euler("XYZ")
        return (e.x, e.y, e.z)
    clips["attack"] = {"fps": 11, "loop": False, "impact": 4, "frames": [
        {"root_rot": lean(-0.06), "armL_rot": swing(-1.25, 0.1, 1.3)},
        {"root_loc": lunge(-0.12, 0.05), "root_rot": lean(-0.2), "root_scale": (0.97, 0.97, 1.05), "armL_rot": swing(-1.1, 0.7, 1.4), "armR_rot": (0.3, 0, 0), "head_rot": (-0.1, 0, 0)},
        {"root_loc": lunge(0.0, 0.1), "root_rot": lean(-0.06), "armL_rot": swing(0.1, -0.3, 2.0), "head_rot": (-0.14, 0, 0)},
        {"root_loc": lunge(0.25, 0.02), "root_rot": lean(0.26), "armL_rot": swing(1.5, -1.4, 0.6), "head_rot": (-0.18, 0, 0)},
        {"root_loc": lunge(0.35, -0.06), "root_rot": lean(0.38), "root_scale": (1.07, 1.07, 0.92), "armL_rot": swing(1.7, -1.3, -1.25), "head_rot": (-0.22, 0, 0), "show": chips},
        {"root_loc": lunge(0.3, -0.04), "root_rot": lean(0.32), "armL_rot": swing(1.7, -1.3, -1.15), "show": chips, "chips_up": 1},
        {"root_loc": lunge(0.15), "root_rot": lean(0.16), "armL_rot": swing(0.6, -1.0, 1.4)},
        {"root_rot": lean(0.04), "armL_rot": swing(-1.0, -0.3, 1.3)},
    ]}
    clips["hit"] = hit_clip(n=4, fps=12, k=0.6)
    clips["defeat"] = topple_clip(fps=11)
    return clips


# ---------------------------------------------------------------- Ember Mauler

def ember_mauler():
    """Ember Mauler (card 12): red-orange spikes, fierce Chog grin, bare
    cream chest under a crossed leather harness with a glowing ember gem, dark
    trousers, brown boots and two enormous magma-rock gauntlets with molten
    cracks. Its swing slams both fists into the ground."""
    hc, r = V((0, 0, 3.26)), 1.12
    rig = U.make_rig(joints(hc=hc, sh=(0.7, 0, 1.92), leg=(0.38, 0, 0.95)))
    rig["mirror_geo"] = True
    rnd = random.Random(1212)
    red3 = (mat("MaulerSpikeLight", "#ff8a3a", rough=0.5, coat=0.1), mat("MaulerSpike", "#ff5a1f", rough=0.52, coat=0.1), mat("MaulerSpikeDeep", "#d8341a", rough=0.55, coat=0.1))
    pants = mat("MaulerPants", "#2e2828", rough=0.65)
    leather = mat("Leather", "#7a4a26", rough=0.62)
    leatherD = mat("LeatherDark", "#4e2e18", rough=0.66)
    steel = mat("Steel", "#9aa2ad", rough=0.32, metal=0.85)
    gem = mat("EmberGem", "#ffb347", rough=0.08, emit="#ff7a1a", emit_strength=4.0, coat=0.8)
    magma = lava_mat("Magma", rock="#2c2426", glow="#ff4a0a", scale=1.8, width=0.08, strength=3.5)
    P = {"name": "Mauler", "hc": hc, "r": r, "spike_hex": "#ff5a1f", "leg_x": 0.38, "leg_r": 0.25, "body": (0.78, 0.68, 0.84),
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.255, 0.3), "brow": math.radians(34), "blush": 0.21, "mouth_tilt": -12}}
    chog_legs(rig, P, boots=leather)
    chog_body(rig, P)
    # Chest definition, trousers, belt, crossed harness with an ember gem.
    for sx in (-1, 1):
        part(rig, "hips", "sphere", (sx * 0.28, -0.6, 1.78), (0.3, 0.12, 0.2), M["creamShade"], ol=0.0)
    lathe(rig, "hips", [(0.58, 0.72), (0.78, 0.88), (0.82, 1.1), (0.82, 1.25)], pants, ol=0.04)
    lathe(rig, "hips", [(0.84, 1.18), (0.85, 1.32)], leatherD, ol=0.03)
    part(rig, "hips", "cube", (0.0, -0.84, 1.25), (0.26, 0.07, 0.18), steel, ol=0.02, bev=0.02)
    for sx in (-1, 1):
        tube(rig, "hips", [(sx * 0.62, -0.42, 1.3), (sx * 0.3, -0.72, 1.55), (-sx * 0.2, -0.74, 1.85), (-sx * 0.48, -0.4, 2.12), (-sx * 0.5, 0.3, 2.05), (-sx * 0.1, 0.7, 1.6), (sx * 0.5, 0.5, 1.3)], 0.08, leather, segs=8, ol=0.025)
    part(rig, "hips", "cyl", (0, -0.79, 1.68), (0.2, 0.2, 0.06), leatherD, rot=(math.radians(80), 0, 0), ol=0.02, vertices=6)
    part(rig, "hips", "sphere", (0, -0.83, 1.68), (0.13, 0.07, 0.15), gem, ol=0.015, segments=6, ring_count=4, smooth=False)
    # Arms down to the huge magma gauntlets at the sides.
    for key, sx in (("armL", -1), ("armR", 1)):
        h = V((sx * 1.3, -0.38, 1.12))
        chog_arm(rig, key, (sx * 0.7, 0, 1.92), h, r=0.22, mitten=False)
        g = 1.3
        U.rock(rig, key, h + V((sx * 0.1, -0.05, 0.05)), (1.0 * g, 0.95 * g, 0.95 * g), rnd, rot=(0.1, sx * 0.2, 0.1), material=magma, crumble=False)
        for kx, kz in ((-0.32, 0.25), (0.0, 0.32), (0.32, 0.22), (0.0, -0.3)):
            U.rock(rig, key, h + V((sx * 0.15 + kx * g, -0.6, kz * g)), (0.42 * g, 0.34 * g, 0.38 * g), rnd, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0), material=magma, crumble=False)
        U.rock(rig, key, h + V((sx * 0.7, 0.05, 0.2)), (0.5 * g, 0.6 * g, 0.55 * g), rnd, rot=(0, sx * 0.3, 0), material=magma, crumble=False)
        U.rock(rig, key, h + V((-sx * 0.05, 0.1, 0.72)), (0.62 * g, 0.62 * g, 0.42 * g), rnd, rot=(0.1, 0, 0), material=magma, crumble=False)
    for i in range(8):
        a = i / 8 * TAU
        part(rig, "yaw", "ico", (1.4 + math.cos(a) * 1.0, -1.4 + math.sin(a) * 0.6, 0.15), (0.16, 0.14, 0.12), magma if i % 2 else mat("EmberSpark", "#ffd08a", emit="#ff7a1a", emit_strength=6.0), ol=0.02, subdivisions=1, smooth=False, sets=["chips"])
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, red3, arc=128, k=1.15, sweep=0.12)
    return rig


def mauler_clips():
    clips = {"idle": idle_clip(fps=6, bob=0.05, sway=0.03, extra=lambda t, s: {"armL_loc": (0, 0, 0.05 * s), "armR_loc": (0, 0, 0.05 * s)})}
    clips["move"] = walk_clip(fps=8, stride=0.5, bounce=0.12, tilt=0.14, arms=0.3,
                              extra=lambda t, s: {"legL_loc": (0, 0, 0.14 * max(0.0, -s)), "legR_loc": (0, 0, 0.14 * max(0.0, s)), "root_rot": (0.14, 0.08 * s, 0.05 * s)})
    up = lambda a: {"armL_rot": (a, 0.1, 0), "armR_rot": (a, -0.1, 0)}  # noqa: E731
    chips = {"chips": True}
    clips["attack"] = {"fps": 11, "loop": False, "impact": 4, "frames": [
        {"root_rot": lean(0.06), **up(-0.4)},
        {"root_rot": lean(-0.16), "root_scale": (0.97, 0.97, 1.05), "head_rot": (-0.14, 0, 0), **up(-2.0)},
        {"root_loc": lunge(-0.12, 0.12), "root_rot": lean(-0.24), "root_scale": (0.96, 0.96, 1.07), "head_rot": (-0.2, 0, 0), **up(-2.6)},
        {"root_loc": lunge(0.2, 0.04), "root_rot": lean(0.26), "head_rot": (-0.2, 0, 0), **up(-1.3)},
        {"root_loc": lunge(0.35, -0.08), "root_rot": lean(0.42), "root_scale": (1.09, 1.09, 0.9), "head_rot": (-0.3, 0, 0), **up(-0.7), "show": chips},
        {"root_loc": lunge(0.3, -0.05), "root_rot": lean(0.36), "root_scale": (1.05, 1.05, 0.94), "head_rot": (-0.26, 0, 0), **up(-0.75), "show": chips, "chips_up": 1},
        {"root_loc": lunge(0.15), "root_rot": lean(0.2), **up(-0.25)},
        {"root_rot": lean(0.06), **up(-0.05)},
    ]}
    clips["hit"] = hit_clip(n=4, fps=12, k=0.6)
    clips["defeat"] = topple_clip(fps=11)
    return clips


# ---------------------------------------------------------------- registry

def spec(build, clips, cell, pivot, card_center, card_scale, card_pose, px=16.0, lift=None, identity=(6.8, 2.7), outlineK=1.5):
    """cell and pivot are authored at 16 px/unit and scale with `px`, which is
    set per unit so the packed sheet lands near 1 sheet px per board px."""
    k = px / 16.0
    cell = tuple(int(round(c * k / 2)) * 2 for c in cell)
    pivot = tuple(int(round(c * k / 2)) * 2 for c in pivot)
    return {"build": build, "clips": clips, "cell": cell, "pivot": pivot, "px": px, "outlineK": outlineK,
            "identityScale": identity[0], "identityLook": identity[1], "lift": lift or {"front": 0.28, "rear": 0.05},
            "card": {"center": card_center, "scale": card_scale, "pitch": 80, "outline": 1.3, "pose": card_pose}}


ROSTER = {
    "chaos_archer": spec(chaos_archer, archer_clips, (220, 200), (100, 160), (0.3, 0, 2.85), 5.6, {"yaw": -0.25, "head_rot": (0.05, -0.06, 0.04)}, px=18.0),
    "frostshell": spec(frostshell, frost_clips, (220, 212), (104, 170), (0.15, 0, 2.85), 5.9, {"yaw": -0.22, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.4, 2.7), px=20.8),
    "rift_runner": spec(rift_runner, runner_clips, (220, 196), (100, 160), (0.0, 0.3, 2.8), 5.6, {"yaw": -0.2, "root_rot": (0.12, 0, 0), "head_rot": (0.08, -0.06, 0.05)}, px=18.0),
    "sparkcaster": spec(sparkcaster, spark_clips, (220, 220), (100, 180), (0.2, 0, 2.9), 5.9, {"yaw": -0.22, "orb_scale": 1.15, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.4, 2.8), px=19.2),
    "chog_guardian": spec(chog_guardian, guardian_clips, (220, 204), (100, 166), (0.15, 0, 2.8), 5.8, {"yaw": -0.22, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.2, 2.7), px=20.0),
    "hexwing": spec(hexwing, hex_clips, (260, 232), (120, 196), (0.0, 0.3, 3.2), 6.6, {"root_loc": (0, 0, 0.6), "wingL_rot": (0, 0.05, 0), "wingR_rot": (0, -0.05, 0), "yaw": -0.2, "head_rot": (0.05, -0.06, 0.04)}, identity=(8.4, 3.4), px=17.0),
    "rift_sprites": spec(rift_sprites, sprite_clips, (240, 220), (110, 186), (0.0, 0.3, 3.0), 5.8, {"root_loc": (0, 0, 0.5), "wingL_rot": (0, 0.1, 0), "wingR_rot": (0, -0.1, 0), "yaw": -0.2, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.6, 3.2), px=13.0),
    "gale_netter": spec(gale_netter, netter_clips, (240, 204), (100, 166), (0.4, 0, 2.7), 5.9, {"yaw": -0.25, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.6, 2.6), px=18.4),
    "riftbreaker": spec(riftbreaker, breaker_clips, (240, 230), (112, 186), (-0.15, 0, 2.95), 6.2, {"yaw": -0.2, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.8, 2.9), px=21.6),
    "ember_mauler": spec(ember_mauler, mauler_clips, (240, 212), (120, 172), (0.0, 0, 2.8), 6.2, {"yaw": -0.18, "head_rot": (0.05, -0.06, 0.04)}, identity=(7.8, 2.7), px=21.6),
}

if __name__ == "__main__":
    U.main({**U.UNITS, **ROSTER})
