"""Chog Royale final asset production: the four deployable buildings, the five
commanders and the spawned Burrow Scrapper, on the Slice 3.1/4 pipeline.

Buildings keep their original card identities: the Rift Sentry's stone base,
bronze cannon, cyan crystal muzzle and teal-spiked Chog gunner; the Decoy
Totem's carved Chog face, teal spikes, purple plume and cyan chest gem; the
Chog Burrow's low earth-and-stone den with a dark mouth and a cyan crystal
crown; the Rift Mortar's squat stone base, dark angled barrel, gold bands and
purple crystals. Commanders and the Scrapper live in final_chars.py.

Run headless from this folder:
  blender.exe -b --factory-startup --python build_final.py -- <out_dir> [unit ...]
Env flags match build_units.py. Buildings render with NOCARD=1 (the original
2D card art stays the card art), and the Totem and Burrow render VIEWS=front.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roster_lib import *  # noqa: E402,F401,F403
from roster_lib import C, M, U, V, bpy, math, random, TAU  # noqa: E402


def anchor(rig, pivot, name, loc):
    """Named empty bound to a pivot. build_units records its projection at
    idle frame 0 and the attack impact frame."""
    e = bpy.data.objects.new(f"anchor_{name}", None)
    bpy.context.scene.collection.objects.link(e)
    e.location = V(loc)
    U.bind(rig, pivot, e)
    rig.setdefault("anchors", {})[name] = e
    return e


def bmats():
    """Building materials: the cards' cool grey stone, warm gold trim,
    bronze cannon metal, cyan and purple rift crystals, wood and earth."""
    return {
        "stoneA": mat("BStoneLight", "#b9bec8", rough=0.66, coat=0.08),
        "stoneB": mat("BStoneMid", "#9ba1ad", rough=0.7, coat=0.06),
        "stoneC": mat("BStoneDeep", "#7d8390", rough=0.72, coat=0.05),
        "stoneTop": mat("BStoneTop", "#cfd3da", rough=0.62, coat=0.1),
        "gold": mat("BGold", "#f4b731", rough=0.26, metal=0.9),
        "goldDeep": mat("BGoldDeep", "#d4901c", rough=0.3, metal=0.9),
        "bronze": mat("BBronze", "#d99a3c", rough=0.3, metal=0.85, coat=0.2),
        "bronzeDeep": mat("BBronzeDeep", "#a86a24", rough=0.34, metal=0.85),
        "iron": mat("BIron", "#4a4f5c", rough=0.36, metal=0.75, coat=0.15),
        "ironDeep": mat("BIronDeep", "#2b2f39", rough=0.45, metal=0.6),
        "cyan": mat("BCrystalCyan", "#38dcf2", rough=0.08, spec=0.9, coat=0.7, emit="#22c8ee", emit_strength=1.6),
        "cyanDeep": mat("BCrystalCyanDeep", "#139bc8", rough=0.1, spec=0.9, coat=0.7, emit="#1490d0", emit_strength=1.0),
        "cyanCore": mat("BCrystalCyanCore", "#c8fbff", rough=0.05, spec=1.0, emit="#7ff2ff", emit_strength=3.2),
        "purple": mat("BCrystalPurple", "#a35af0", rough=0.08, spec=0.9, coat=0.7, emit="#8c3fe8", emit_strength=1.7),
        "purpleDeep": mat("BCrystalPurpleDeep", "#6a2cc0", rough=0.1, spec=0.9, coat=0.7, emit="#6224c4", emit_strength=1.1),
        "purpleCore": mat("BCrystalPurpleCore", "#f0b8ff", rough=0.05, emit="#d26bff", emit_strength=3.6),
        "wood": mat("BWood", "#9a5f30", rough=0.62),
        "woodDeep": mat("BWoodDeep", "#6e4020", rough=0.66),
        "woodLight": mat("BWoodLight", "#c08a52", rough=0.6),
        "earth": mat("BEarth", "#a8743f", rough=0.85),
        "earthDeep": mat("BEarthDeep", "#7a4f28", rough=0.88),
        "dirt": mat("BDirt", "#8a6038", rough=0.92),
        "hole": mat("BHole", "#1a1012", rough=0.95),
        "teal": mat("TotemSpike", "#14c0cc", rough=0.58, coat=0.05),
        "tealLight": mat("TotemSpikeLight", "#4ee0e4", rough=0.58, coat=0.05),
        "tealDeep": mat("TotemSpikeDeep", "#0c97a6", rough=0.6, coat=0.05),
        "violet": mat("TotemPlume", "#9b4fe0", rough=0.55, coat=0.05),
        "violetLight": mat("TotemPlumeLight", "#c07cf5", rough=0.55, coat=0.05),
        "violetDeep": mat("TotemPlumeDeep", "#6b2fb0", rough=0.58),
        "robe": mat("TotemRobe", "#7a3bc4", rough=0.62),
        "robeDeep": mat("TotemRobeDeep", "#55268f", rough=0.64),
        "rope": mat("TotemRope", "#c99a5b", rough=0.7),
        "horn": mat("TotemHorn", "#e8d7b4", rough=0.5),
        "chipA": mat("BChip", "#8d939f", rough=0.8),
    }


def stone_ring(rig, pivot, rnd, n, radius, z, size, mats3, body, jitter=0.12, rot_jitter=0.25, skip=None):
    """Ring of chunky bevelled masonry blocks around a building base."""
    for i in range(n):
        a = i / n * TAU + rnd.uniform(-jitter, jitter)
        if skip and skip(a):
            continue
        c = V((math.sin(a) * radius, -math.cos(a) * radius, z + rnd.uniform(-0.04, 0.04)))
        s = tuple(d * rnd.uniform(0.9, 1.08) for d in size)
        U.rock(rig, pivot, c, s, rnd, rot=(rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), -a + rnd.uniform(-rot_jitter, rot_jitter)),
               material=rnd.choice(mats3), ol=0.045, body=body, taper=0.08)


def dirt_chips(rig, pivot, at, n=6, mats2=None, spread=(1.0, 0.6)):
    """Small debris pieces hidden outside the frames that show them (deploy
    eruptions, burrow spawns). apply_chips() in build_units animates the set
    named `chips`, so these use their own set and pose offsets."""
    out = []
    for i in range(n):
        a = i / n * TAU
        o = part(rig, pivot, "ico", (at[0] + math.cos(a) * spread[0] * 0.5, at[1] + math.sin(a) * spread[1] * 0.5, at[2]), (0.21, 0.18, 0.15),
                 mats2[i % len(mats2)], ol=0.025, subdivisions=1, smooth=False, sets=["debris"])
        out.append(o)
    return out


def ease_out(p):
    return 1 - (1 - p) ** 3


def overshoot(p, k=0.12):
    """0 -> 1 with a small overshoot past 1 around p = 0.75."""
    return ease_out(p) + k * math.sin(math.pi * min(1.0, p / 0.85)) * (p > 0.4)


def deploy_clip(n=8, fps=12, depth=1.0, extra=None):
    """Building emergence: rises out of the ground with a squash-and-settle,
    debris kicked out on the first frames."""
    f = []
    for i in range(n):
        p = i / (n - 1)
        s = overshoot(p)
        sq = 1 + 0.12 * math.sin(math.pi * p) * (1 - p)
        d = {"root_loc": (0, 0, -depth * (1 - ease_out(p)) ** 2), "root_scale": (max(0.25, s) * sq, max(0.25, s) * sq, max(0.25, s) / sq),
             "show": {"debris": i < n - 2}, "debris_k": p}
        if extra:
            d = merge(d, extra(p, i))
        f.append(d)
    return {"fps": fps, "loop": False, "frames": f}


def wreck_clip(n=9, fps=12, sink=0.5, extra=None):
    """Destruction: a jolt, then the masonry and crystals fly apart and the
    remains sink, eyes shut on Chog-faced buildings."""
    f = []
    for i in range(n):
        p = i / (n - 1)
        d = {"root_loc": (0, 0, -sink * p * p), "root_rot": (0.06 * math.sin(p * 9) * (1 - p), 0, 0.04 * math.sin(p * 7) * (1 - p)),
             "root_scale": (1 + 0.06 * (1 - p) * (p < 0.3), 1 + 0.06 * (1 - p) * (p < 0.3), 1 - 0.25 * p * p),
             "crumble": max(0.0, (p - 0.12) * 1.12), "show": SHUT}
        if extra:
            d = merge(d, extra(p, i))
        f.append(d)
    return {"fps": fps, "loop": False, "frames": f}


def jolt_clip(n=3, fps=12, k=1.0, extra=None):
    f = []
    for i, (a, s) in enumerate(((1.0, 0.94), (-0.5, 0.98), (0.15, 1.0))[:n]):
        d = {"root_rot": (0.07 * a * k, 0, -0.05 * a * k), "root_scale": (1 + (1 - s) * 0.6, 1 + (1 - s) * 0.6, s), "show": SHUT if i < 2 else {}}
        if extra:
            d = merge(d, extra(i))
        f.append(d)
    return {"fps": fps, "loop": False, "frames": f}


# ---------------------------------------------------------------- Rift Sentry

SENTRY_AIM = V((0.72, -0.68, 0.14)).normalized()


def rift_sentry():
    """Rift Sentry (card 13): a teal-spiked Chog gunner with a stern grin and
    blush sits behind a stubby bronze cannon whose muzzle holds a big faceted
    cyan crystal lens, on a dark iron gimbal and gold yoke, over a stepped
    cool-grey stone base banded in gold with cyan crystals set in front."""
    B = bmats()
    hc, r = V((-0.42, 0.42, 2.98)), 0.86
    rig = U.make_rig({
        "root": ("yaw", (0, 0, 0)),
        "base": ("root", (0, 0, 0.5)),
        "turret": ("base", (0, 0, 1.38)),
        "head": ("turret", (-0.42, 0.42, 2.2)),
        "spikes": ("head", tuple(hc)),
        "barrel": ("turret", (0.02, -0.12, 1.92)),
        "armL": ("turret", (-0.75, 0.2, 1.95)),
        "armR": ("turret", (0.25, 0.2, 1.95)),
    })
    rig["mirror_geo"] = True
    rnd = random.Random(1313)
    body = (0, 0, 0.7)
    stones = (B["stoneA"], B["stoneB"], B["stoneC"])
    # Stepped base: a lower ring of chunky blocks, an upper ring, a core and a gold band.
    stone_ring(rig, "base", rnd, 9, 1.42, 0.36, (1.05, 0.8, 0.72), stones, body)
    stone_ring(rig, "base", rnd, 7, 1.0, 0.98, (0.95, 0.66, 0.6), stones, body)
    part(rig, "base", "cyl", (0, 0, 0.72), (1.25, 1.25, 1.2), B["stoneC"], ol=0.03, vertices=24)
    part(rig, "base", "cyl", (0, 0, 1.3), (1.08, 1.08, 0.12), B["stoneTop"], ol=0.035, vertices=28, bev=0.04)
    part(rig, "base", "torus", (0, 0, 1.24), (1.12, 1.12, 1.0), B["gold"], ol=0.03, major_radius=1.0, minor_radius=0.075, major_segments=36, minor_segments=8)
    for a in (-0.6, 0.0, 0.6, 2.4, 3.14, 3.9):
        part(rig, "base", "cube", (math.sin(a) * 1.13, -math.cos(a) * 1.13, 1.24), (0.16, 0.12, 0.2), B["goldDeep"], rot=(0, 0, -a), ol=0.02, bev=0.03)
    # Cyan crystals set into the front of the base (card 13's dominant gem front-right).
    crystal(rig, "base", (0.38, -1.5, 0.2), (0.14, -0.45, 1.0), 1.45, 0.46, B["cyan"], ol=0.05, twist=0.3, shatter=body)
    crystal(rig, "base", (-0.95, -1.12, 0.28), (-0.45, -0.4, 1.0), 0.72, 0.24, B["cyanDeep"], ol=0.04, twist=0.1, shatter=body)
    crystal(rig, "base", (1.3, -0.62, 0.3), (0.55, -0.25, 1.0), 0.62, 0.22, B["cyanDeep"], ol=0.04, twist=0.5, shatter=body)
    crystal(rig, "base", (-1.42, 0.1, 0.32), (-0.7, 0.1, 1.0), 0.66, 0.24, B["cyan"], ol=0.04, twist=0.2, shatter=body)
    # Gimbal and yoke.
    part(rig, "turret", "cyl", (0, 0, 1.44), (0.78, 0.78, 0.26), B["ironDeep"], ol=0.035, vertices=24, bev=0.04)
    part(rig, "turret", "torus", (0, 0, 1.56), (0.74, 0.74, 0.8), B["gold"], ol=0.02, major_radius=1.0, minor_radius=0.07)
    side = V((-SENTRY_AIM.y, SENTRY_AIM.x, 0)).normalized()
    breech = V((0.02, -0.12, 1.92))
    for sx in (-1, 1):
        part(rig, "turret", "cube", breech + side * sx * 0.52 + V((0, 0, -0.24)), (0.16, 0.36, 0.62), B["gold"],
             rot=(0, 0, math.atan2(side.y, side.x)), ol=0.03, bev=0.04)
    # Chog gunner behind the cannon: small cream body, the head on top.
    part(rig, "turret", "sphere", (-0.42, 0.42, 2.0), (0.62, 0.56, 0.56), M["cream"], ol=0.05)
    P = {"name": "Sentry", "hc": hc, "r": r, "spike_hex": "#14c0cc",
         "face": {"spread": 0.41, "eye_z": 0.02, "eye": (0.27, 0.32), "brow": math.radians(30), "blush": 0.22, "mouth_tilt": -14}}
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, (B["tealLight"], B["teal"], B["tealDeep"]), arc=140, k=1.12, sweep=0.1)
    # Mitten hands on the breech handles.
    for key, off in (("armL", -0.48), ("armR", 0.48)):
        hand = breech + side * off * 0.92 + V((0, 0.22, 0.24))
        capsule(rig, key, hand + V((0, 0.35, 0.05)), hand, 0.15, M["cream"], r1=0.14)
        part(rig, key, "sphere", hand, (0.22, 0.21, 0.21), M["cream"], ol=0.045)
    # Cannon: dark breech ball with a cyan gem, bronze barrel, gold bands and
    # the big faceted cyan crystal lens in a gold muzzle ring.
    a = SENTRY_AIM
    part(rig, "barrel", "sphere", breech, (0.58, 0.58, 0.55), mat("BGunmetal", "#7a7f8c", rough=0.4, metal=0.6, coat=0.2), ol=0.045)
    part(rig, "barrel", "ico", breech + V((0, 0, 0.56)), (0.19, 0.19, 0.22), B["cyan"], ol=0.02, subdivisions=1, smooth=False)
    # Stubby, thick barrel like the card, flaring into the lens mount.
    L = 1.3
    lathe(rig, "barrel", [(0.46, 0.0), (0.5, 0.25), (0.47, 0.7), (0.52, L - 0.22), (0.62, L - 0.1), (0.66, L)], B["bronze"],
          origin=breech + a * 0.2, axis=a, sy=1.0, segs=28, ol=0.05, cap=(True, False))
    for t, rr in ((0.32, 0.53), (0.86, 0.52)):
        part(rig, "barrel", "torus", breech + a * (0.2 + t), (1, 1, 1), B["bronzeDeep"], rot=frame_for(a).to_euler(), ol=0.02,
             major_radius=rr, minor_radius=0.07, major_segments=28, minor_segments=8)
    mz = breech + a * (0.2 + L)
    part(rig, "barrel", "torus", mz, (1, 1, 1), B["gold"], rot=frame_for(a).to_euler(), ol=0.04, major_radius=0.68, minor_radius=0.15,
         major_segments=36, minor_segments=10)
    oct8 = [(math.cos(k / 8 * TAU) * 0.66, math.sin(k / 8 * TAU) * 0.66) for k in range(8)]
    gem_slab(rig, "barrel", oct8, 0.34, mz + a * 0.02, a, (0, 0, 1), (B["cyan"], B["cyanCore"], B["cyanDeep"]), inner=0.55, dome=0.38, ol=0.045)
    anchor(rig, "barrel", "muzzle", mz + a * 0.4)
    dirt_chips(rig, "root", (0, -0.6, 0.15), 6, (B["dirt"], B["chipA"]), spread=(2.6, 1.6))
    return rig


def sentry_clips():
    a = SENTRY_AIM
    clips = {"idle": idle_clip(n=6, fps=6, bob=0.0, sway=0.0, extra=lambda t, s: {
        "head_loc": (0, 0, 0.03 * s), "barrel_rot": (0.015 * s, 0, 0), "root_scale": 1.0, "hips_loc": (0, 0, 0)})}
    clips["deploy"] = deploy_clip(n=8, fps=12, depth=1.1, extra=lambda p, i: {"head_loc": (0, 0, -0.5 * (1 - ease_out(p)))})
    rec = lambda k: tuple(-a[j] * 0.6 * k for j in range(3))  # noqa: E731
    clips["attack"] = {"fps": 14, "loop": False, "impact": 1, "frames": [
        {"barrel_loc": rec(0.15), "head_rot": (-0.04, 0, 0)},
        {"barrel_loc": rec(1.0), "barrel_rot": (0.1, 0, 0.05), "turret_rot": (0.06, 0, 0), "root_scale": (1.05, 1.05, 0.93), "head_rot": (0.14, 0, 0.04), "base_scale": (1.03, 1.03, 0.95)},
        {"barrel_loc": rec(0.75), "barrel_rot": (0.05, 0, 0.02), "turret_rot": (0.03, 0, 0), "root_scale": (1.02, 1.02, 0.98), "head_rot": (0.08, 0, 0)},
        {"barrel_loc": rec(0.4)},
        {"barrel_loc": rec(0.15)},
        {"barrel_loc": rec(0.0)},
    ]}
    clips["hit"] = jolt_clip(extra=lambda i: {"barrel_rot": (0.06 * (1 - i / 2), 0, 0)})
    clips["defeat"] = wreck_clip(n=9, fps=12, sink=0.6, extra=lambda p, i: {
        "turret_rot": (0, 0.5 * p * p, 0), "turret_loc": (0.6 * p * p, 0, -0.8 * p * p), "barrel_rot": (0.3 * p, 0, 0)})
    return clips


# ---------------------------------------------------------------- Decoy Totem

def decoy_totem():
    """Decoy Totem (card 14): a carved wooden post dressed as a Chog: cream
    face with angry brows and blush, a wide teal spike crown, a wooden headband
    with two little horns and a tall purple feather plume, a crossbeam with
    cream mitten hands, a purple tabard with rope cross-straps and a big cyan
    chest gem, standing on a ring of grey stones with cyan crystals."""
    B = bmats()
    hc, r = V((0, -0.05, 2.95)), 0.96
    rig = U.make_rig({
        "root": ("yaw", (0, 0, 0)),
        "base": ("root", (0, 0, 0.3)),
        "body": ("root", (0, 0, 0.6)),
        "head": ("body", (0, 0, 2.3)),
        "spikes": ("head", tuple(hc)),
        "plume": ("head", (0, 0.15, 3.8)),
        "beam": ("body", (0, 0.18, 1.92)),
    })
    rnd = random.Random(1414)
    body = (0, 0, 0.4)
    stones = (B["stoneA"], B["stoneB"], B["stoneC"])
    stone_ring(rig, "base", rnd, 7, 0.86, 0.2, (0.7, 0.55, 0.42), stones, body)
    for (x, y, dx, L, rad, m) in ((-0.62, -0.78, -0.4, 0.62, 0.2, B["cyan"]), (0.66, -0.74, 0.45, 0.66, 0.21, B["cyan"]), (0.02, -0.98, 0.0, 0.5, 0.17, B["cyanDeep"]),
                                  (-0.95, 0.15, -0.7, 0.5, 0.17, B["cyanDeep"]), (0.95, 0.2, 0.7, 0.5, 0.17, B["cyanDeep"])):
        crystal(rig, "base", (x, y, 0.12), (dx, y * 0.4, 1.0), L, rad, m, ol=0.04, twist=rnd.uniform(0, 1), shatter=body)
    # Carved pole and tabard.
    part(rig, "body", "cyl", (0, 0, 1.1), (0.42, 0.42, 1.7), B["wood"], ol=0.045, vertices=18, bev=0.04)
    for z in (0.5, 0.75):
        part(rig, "body", "torus", (0, 0, z), (0.44, 0.44, 0.6), B["woodDeep"], ol=0.015, major_radius=1.0, minor_radius=0.09)
    lathe(rig, "body", [(0.5, 0.95), (0.62, 1.15), (0.6, 1.5), (0.55, 1.85), (0.46, 2.1)], B["robe"], ol=0.04)
    lathe(rig, "body", [(0.64, 0.92), (0.68, 1.02)], B["robeDeep"], ol=0.02)
    for sx in (-1, 1):
        pts = [V((sx * 0.42, -0.44, 2.02)), V((0, -0.64, 1.55)), V((-sx * 0.5, -0.52, 1.08))]
        d = (pts[2] - pts[0]).normalized()
        ribbon(rig, "body", pts, 0.14, V((d.z, 0.0, -d.x)), B["rope"], thick=0.06, ol=0.02)
    gem = [(0, 0.34), (0.24, 0.0), (0, -0.4), (-0.24, 0.0)]
    gem_slab(rig, "body", gem, 0.14, (0, -0.66, 1.55), (0, -1, 0.15), (0, 0.15, 1), (B["cyan"], B["cyanCore"], B["cyanDeep"]), inner=0.5, dome=0.16, ol=0.035)
    # Outstretched crossbeam arms with cream mitten hands, in front of the
    # spikes at shoulder height (the card's signature T silhouette), and two
    # angled wooden back planks rising behind the head.
    part(rig, "beam", "cube", (0, -0.12, 1.78), (3.1, 0.34, 0.34), B["woodLight"], ol=0.05, bev=0.07)
    for sx in (-1, 1):
        part(rig, "beam", "cube", (sx * 0.62, -0.12, 1.78), (0.13, 0.4, 0.42), B["woodDeep"], ol=0.02, bev=0.03)
        part(rig, "beam", "sphere", (sx * 1.7, -0.2, 1.84), (0.34, 0.3, 0.31), M["cream"], ol=0.05)
        part(rig, "beam", "sphere", (sx * 1.58, -0.44, 2.0), (0.13, 0.12, 0.14), M["cream"], ol=0.035)
        part(rig, "body", "cube", (sx * 0.95, 0.42, 2.6), (0.42, 0.18, 1.7), B["wood"], rot=(0, sx * math.radians(38), 0), ol=0.045, bev=0.05)
        part(rig, "body", "cube", (sx * 1.35, 0.42, 3.05), (0.3, 0.2, 0.36), B["woodDeep"], rot=(0, sx * math.radians(38), 0), ol=0.03, bev=0.04)
    # Head, face, headband, horns, spikes and the purple plume.
    P = {"name": "Totem", "hc": hc, "r": r, "spike_hex": "#14c0cc",
         "face": {"spread": 0.41, "eye_z": 0.0, "eye": (0.26, 0.31), "brow": math.radians(32), "blush": 0.22, "mouth_tilt": -16}}
    chog_head(rig, P)
    spike_fan(rig, hc, r, rnd, (B["tealLight"], B["teal"], B["tealDeep"]), arc=150, k=1.14, wid=0.64)
    part(rig, "head", "torus", hc + V((0, 0.08, 0.66)), (0.82, 0.76, 0.7), B["wood"], ol=0.03, major_radius=1.0, minor_radius=0.16)
    for sx in (-1, 1):
        blade(rig, "head", hc + V((sx * 0.62, 0.02, 0.72)), (sx * 0.5, 0.1, 1.0), 0.62, 0.16, B["horn"], (0, 1, 0), flat=0.7, ol=0.035, verts=10)
    # Broad feathers sweeping toward the viewer's left like the card's plume.
    for i, (x, tilt, L, w) in enumerate(((-0.3, -1.25, 1.75, 0.46), (-0.12, -0.8, 2.0, 0.5), (0.08, -0.42, 1.9, 0.48), (0.26, -0.12, 1.55, 0.42), (0.42, 0.18, 1.1, 0.36))):
        base = V((x * 0.8, 0.12, 3.72))
        dv = V((tilt, 0.25, 1.0))
        blade(rig, "plume", base, dv, L, w, (B["violet"], B["violetLight"], B["violetDeep"], B["violet"], B["violetLight"])[i], (0, 1, 0.1), flat=0.3, ol=0.045, verts=14)
    dirt_chips(rig, "root", (0, -0.4, 0.12), 6, (B["dirt"], B["chipA"]), spread=(2.2, 1.4))
    return rig


def totem_clips():
    clips = {"idle": idle_clip(n=6, fps=6, bob=0.0, sway=0.0, extra=lambda t, s: {
        "body_rot": (0, 0.025 * s, 0), "beam_rot": (0, 0.05 * math.sin(t + 0.6), 0), "plume_rot": (0.06 * math.sin(t + 1.1), 0.08 * s, 0),
        "head_rot": (0.03 * math.sin(t + 0.8), 0.04 * s, 0)})}
    clips["deploy"] = deploy_clip(n=8, fps=12, depth=1.5, extra=lambda p, i: {"plume_rot": (0, 0.3 * (1 - p), 0), "beam_rot": (0, 0.4 * (1 - p) * math.sin(p * 9), 0)})
    # Lure: the decoy waggles its arms and head and flashes its gem.
    lure = []
    for i in range(6):
        t = i / 6 * TAU
        s = math.sin(t)
        lure.append({"beam_rot": (0, 0.22 * s, 0), "body_rot": (0, 0.06 * s, 0), "head_rot": (0.05, 0.12 * math.sin(t + 0.5), 0.06 * s),
                     "plume_rot": (0.1 * math.sin(t + 1.0), 0.14 * s, 0), "root_scale": (1 + 0.03 * abs(s), 1 + 0.03 * abs(s), 1 - 0.03 * abs(s))})
    clips["attack"] = {"fps": 10, "loop": False, "impact": 1, "frames": lure}
    clips["hit"] = jolt_clip(extra=lambda i: {"plume_rot": (0.15 * (1 - i / 2), 0, 0)})
    clips["defeat"] = wreck_clip(n=9, fps=12, sink=0.4, extra=lambda p, i: {"body_rot": (-0.9 * p * p, 0.5 * p * p, 0), "body_loc": (0, 0.4 * p * p, -0.3 * p * p)})
    return clips


# ---------------------------------------------------------------- Chog Burrow

def chog_burrow():
    """Chog Burrow (card 15): a low rounded earth den, an arch of grey stones
    around a dark front mouth, a wooden post beside it, chunky stones in the
    earth and a crown of cyan crystals with one tall central spire. No tall
    tower profile."""
    B = bmats()
    rig = U.make_rig({
        "root": ("yaw", (0, 0, 0)),
        "mound": ("root", (0, 0, 0.0)),
        "crystals": ("mound", (0, 0.25, 1.7)),
    })
    rnd = random.Random(1515)
    body = (0, 0.1, 0.5)
    stones = (B["stoneA"], B["stoneB"], B["stoneC"])
    # Earth dome (above ground only) and a dirt apron.
    lathe(rig, "mound", [(1.95, 0.0), (1.93, 0.35), (1.82, 0.78), (1.58, 1.2), (1.2, 1.55), (0.66, 1.78), (0.0, 1.86)], B["earth"],
          origin=(0, 0.15, 0), sy=0.9, segs=36, ol=0.05, cap=(True, False))
    part(rig, "mound", "torus", (0, 0.1, 0.04), (2.0, 1.8, 0.6), B["dirt"], ol=0.03, major_radius=1.0, minor_radius=0.16, major_segments=36, minor_segments=8)
    # Dark mouth on the front face, tilted back with the dome's slope, framed
    # by an arch of stones and a sill.
    mc, mn = V((0.12, -1.7, 0.0)), V((0.08, -1.0, 0.42))
    arch = [(math.cos(k / 14 * math.pi) * 0.78, math.sin(k / 14 * math.pi) * 0.92) for k in range(15)]
    slab(rig, "mound", arch, 0.24, mc, mn, (0, 0.38, 1), B["hole"], ol=0.03, inset=0.92, bev=0.02)
    up = V((0, 0.38, 1)).normalized()
    for k in range(9):
        a = math.pi * (1 - k / 8)
        c = mc + V((math.cos(a) * 0.98, 0, 0)) + up * (math.sin(a) * 1.08) - mn.normalized() * 0.05
        U.rock(rig, "mound", c, (0.52, 0.46, 0.44) if k not in (0, 8) else (0.62, 0.52, 0.52), rnd, rot=(0.4, 0, -a + math.pi / 2), material=stones[k % 3], ol=0.045, body=body, taper=0.1)
    U.rock(rig, "mound", mc + V((0, -0.2, 0.06)), (1.4, 0.45, 0.2), rnd, material=B["stoneC"], ol=0.04, body=body, taper=0.06)
    # Stones set in the earth around the dome.
    for th, h, s in ((-2.0, 0.2, 0.55), (2.1, 0.25, 0.5), (-1.3, 0.55, 0.46), (1.35, 0.5, 0.48), (2.7, 0.3, 0.5), (-2.7, 0.35, 0.48), (0.85, 0.82, 0.4), (-0.8, 0.86, 0.42), (-1.75, 0.15, 0.5), (1.8, 0.12, 0.5)):
        p, n = U.on_body((0, 0.15, 0.0), (1.9, 1.7, 1.84), th, h, 0.02)
        U.rock(rig, "mound", p, (s, s * 0.85, s * 0.7), rnd, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, TAU)), material=rnd.choice(stones), ol=0.04, body=body)
    # Wooden post left of the mouth.
    part(rig, "mound", "cyl", (-1.12, -1.25, 0.42), (0.17, 0.17, 0.84), B["wood"], rot=(0.15, -0.1, 0), ol=0.035, vertices=10, bev=0.03)
    part(rig, "mound", "cyl", (-1.12, -1.3, 0.62), (0.19, 0.19, 0.1), B["woodDeep"], rot=(0.15, -0.1, 0), ol=0.02, vertices=10)
    # Crystal crown: a tall central spire and a ring of tilted shards.
    crystal(rig, "crystals", (0.0, 0.25, 1.6), (0.0, 0.08, 1.0), 1.85, 0.5, B["cyan"], ol=0.05, twist=0.2, shatter=body)
    for (x, y, dx, dy, L, rad, m) in ((-0.62, 0.15, -0.55, -0.1, 1.3, 0.4, B["cyanDeep"]), (0.66, 0.2, 0.55, -0.05, 1.35, 0.4, B["cyan"]),
                                      (-0.28, -0.42, -0.25, -0.5, 1.15, 0.36, B["cyan"]), (0.36, -0.38, 0.3, -0.5, 1.1, 0.35, B["cyanDeep"]),
                                      (0.12, 0.72, 0.05, 0.55, 1.0, 0.33, B["cyanDeep"]), (-0.95, -0.05, -0.85, -0.2, 0.85, 0.29, B["cyan"]),
                                      (1.0, -0.05, 0.85, -0.2, 0.85, 0.29, B["cyan"])):
        crystal(rig, "crystals", (x, y, 1.5 - 0.3 * abs(x)), (dx, dy, 1.0), L, rad, m, ol=0.045, twist=rnd.uniform(0, 1), shatter=body)
    for (th, h) in ((-1.95, 0.1), (1.9, 0.12), (2.6, 0.2), (-0.95, 0.35), (1.0, 0.3)):
        p, n = U.on_body((0, 0.15, 0.0), (1.9, 1.7, 1.84), th, h, 0.0)
        crystal(rig, "mound", p, n + V((0, 0, 0.8)), 0.7, 0.24, B["cyan"], ol=0.04, twist=rnd.uniform(0, 1), shatter=body)
    anchor(rig, "mound", "mouth", mc + V((0, -0.25, 0.5)))
    dirt_chips(rig, "root", (0.12, -1.95, 0.3), 7, (B["dirt"], B["earthDeep"], B["chipA"]), spread=(2.0, 1.0))
    return rig


def burrow_clips():
    clips = {"idle": idle_clip(n=6, fps=6, bob=0.0, sway=0.0, extra=lambda t, s: {
        "crystals_loc": (0, 0, 0.035 * s), "crystals_scale": 1 + 0.02 * math.sin(t + 0.5), "root_scale": 1.0})}
    clips["deploy"] = deploy_clip(n=8, fps=12, depth=1.0, extra=lambda p, i: {"crystals_scale": max(0.05, overshoot(max(0.0, (p - 0.35) / 0.65), 0.2))})
    spawn = []
    for i, (bulge, cs, deb) in enumerate(((0.0, 1.0, 0.0), (0.08, 1.08, 0.15), (0.13, 1.2, 0.45), (0.06, 1.25, 0.75), (-0.03, 1.12, 1.0), (0.0, 1.04, 1.2), (0.0, 1.0, 1.3))):
        spawn.append({"mound_scale": (1 + bulge * 0.6, 1 + bulge * 0.6, 1 - bulge * 0.4 if i < 2 else 1 + bulge), "crystals_scale": cs,
                      "show": {"debris": 0.1 < deb < 1.25}, "debris_k": deb, "debris_mouth": True})
    clips["attack"] = {"fps": 12, "loop": False, "impact": 2, "frames": spawn}
    clips["hit"] = jolt_clip(k=0.6, extra=lambda i: {"crystals_rot": (0.08 * (1 - i / 2), 0, 0)})
    clips["defeat"] = wreck_clip(n=9, fps=12, sink=0.3, extra=lambda p, i: {"mound_scale": (1 + 0.12 * p, 1 + 0.12 * p, max(0.35, 1 - 0.6 * p * p))})
    return clips


# ---------------------------------------------------------------- Rift Mortar

MORTAR_PITCH = math.radians(44)
MORTAR_AIM = (V((0.86, -0.5, 0)).normalized() * math.cos(MORTAR_PITCH) + V((0, 0, math.sin(MORTAR_PITCH)))).normalized()


def rift_mortar():
    """Rift Mortar (card 16): a squat stepped base of grey stone blocks with
    gold bands and glowing purple crystals, gold trunnions, and an oversized
    dark gunmetal barrel tilted up toward screen right with a thick muzzle
    ring, a gold band and a deep indigo bore glowing magenta."""
    B = bmats()
    piv = V((0.0, 0.12, 1.55))
    rig = U.make_rig({
        "root": ("yaw", (0, 0, 0)),
        "base": ("root", (0, 0, 0.5)),
        "barrel": ("base", tuple(piv)),
    })
    rig["mirror_geo"] = True
    rnd = random.Random(1616)
    body = (0, 0, 0.7)
    stones = (B["stoneA"], B["stoneB"], B["stoneC"])
    # Squat base: two rings of blocks around a core, a top slab and gold bands.
    stone_ring(rig, "base", rnd, 8, 1.48, 0.4, (1.15, 0.9, 0.8), stones, body, jitter=0.05)
    stone_ring(rig, "base", rnd, 6, 1.02, 1.05, (1.0, 0.7, 0.62), stones, body, jitter=0.05)
    part(rig, "base", "cyl", (0, 0, 0.74), (1.3, 1.3, 1.25), B["stoneC"], ol=0.03, vertices=24)
    part(rig, "base", "cyl", (0, 0, 1.36), (1.1, 1.1, 0.12), B["stoneTop"], ol=0.035, vertices=28, bev=0.04)
    for z, rr in ((0.72, 1.62), (1.3, 1.15)):
        part(rig, "base", "torus", (0, 0, z), (rr, rr, 1.0), B["gold"], ol=0.025, major_radius=1.0, minor_radius=0.07, major_segments=40, minor_segments=8)
    # Purple crystals in the front corners and sides.
    for (x, y, dx, dy, L, rad, m) in ((-0.95, -1.28, -0.45, -0.55, 1.25, 0.42, B["purple"]), (0.72, -1.4, 0.35, -0.6, 1.05, 0.36, B["purpleDeep"]),
                                      (1.52, -0.35, 0.8, -0.2, 0.95, 0.34, B["purple"]), (-1.52, 0.2, -0.8, 0.1, 0.9, 0.33, B["purpleDeep"]),
                                      (-0.15, -1.58, -0.05, -0.65, 0.7, 0.27, B["purple"])):
        crystal(rig, "base", (x, y, 0.28), (dx, dy, 1.0), L, rad, m, ol=0.045, twist=rnd.uniform(0, 1), shatter=body)
    # Trunnion yoke.
    side = V((-MORTAR_AIM.y, MORTAR_AIM.x, 0)).normalized()
    for sx in (-1, 1):
        part(rig, "base", "cube", piv + side * sx * 0.92 + V((0, 0, -0.32)), (0.26, 0.6, 0.85), B["stoneA"], rot=(0, 0, math.atan2(side.y, side.x)), ol=0.035, bev=0.06)
        part(rig, "barrel", "cyl", piv + side * sx * 0.82, (0.24, 0.24, 0.3), B["gold"], rot=frame_for(side).to_euler(), ol=0.03, vertices=16, bev=0.03)
    # Barrel: thick breech, waisted body, flared muzzle, gold bands, glowing bore.
    a = MORTAR_AIM
    o0 = piv - a * 0.55
    L = 2.35
    lathe(rig, "barrel", [(0.62, 0.0), (0.74, 0.18), (0.78, 0.55), (0.7, 1.2), (0.72, 1.75), (0.86, 2.05), (0.92, L)], B["iron"],
          origin=o0, axis=a, sy=1.0, segs=32, ol=0.05, cap=(True, False))
    part(rig, "barrel", "sphere", o0, (0.62, 0.62, 0.62), B["ironDeep"], ol=0.04)
    for t, rr, m in ((0.62, 0.8, B["gold"]), (1.85, 0.8, B["gold"]), (1.15, 0.73, B["ironDeep"])):
        part(rig, "barrel", "torus", o0 + a * t, (1, 1, 1), m, rot=frame_for(a).to_euler(), ol=0.025, major_radius=rr, minor_radius=0.08, major_segments=32, minor_segments=8)
    mz = o0 + a * L
    part(rig, "barrel", "torus", mz, (1, 1, 1), B["ironDeep"], rot=frame_for(a).to_euler(), ol=0.04, major_radius=0.86, minor_radius=0.16, major_segments=36, minor_segments=10)
    part(rig, "barrel", "cyl", mz - a * 0.25, (0.72, 0.72, 0.05), B["purpleCore"], rot=frame_for(a).to_euler(), ol=0.0, vertices=28)
    part(rig, "barrel", "cyl", mz - a * 0.12, (0.76, 0.76, 0.05), B["purpleDeep"], rot=frame_for(a).to_euler(), ol=0.0, vertices=28)
    crystal(rig, "barrel", o0 + a * 1.2 + V((0, 0, 0.62)), (0.2, -0.1, 1.0), 0.5, 0.18, B["purple"], ol=0.03, twist=0.4)
    anchor(rig, "barrel", "muzzle", mz + a * 0.15)
    dirt_chips(rig, "root", (0, -0.6, 0.15), 6, (B["dirt"], B["chipA"]), spread=(2.8, 1.6))
    return rig


def mortar_clips():
    a = MORTAR_AIM
    clips = {"idle": idle_clip(n=6, fps=6, bob=0.0, sway=0.0, extra=lambda t, s: {"barrel_rot": (0.02 * s, 0, 0), "root_scale": 1.0})}
    clips["deploy"] = deploy_clip(n=8, fps=12, depth=1.1, extra=lambda p, i: {"barrel_rot": (-0.5 * (1 - ease_out(p)), 0, 0)})
    kick = lambda k: tuple(-a[j] * 0.45 * k for j in range(3))  # noqa: E731
    clips["attack"] = {"fps": 14, "loop": False, "impact": 1, "frames": [
        {"barrel_loc": kick(0.1), "barrel_rot": (0.03, 0, 0), "base_scale": (1.0, 1.0, 1.0)},
        {"barrel_loc": kick(1.0), "barrel_rot": (-0.12, 0, 0), "base_scale": (1.05, 1.05, 0.92), "root_scale": (1.03, 1.03, 0.95)},
        {"barrel_loc": kick(0.85), "barrel_rot": (-0.08, 0, 0), "base_scale": (1.03, 1.03, 0.95)},
        {"barrel_loc": kick(0.55), "barrel_rot": (-0.03, 0, 0), "base_scale": (1.01, 1.01, 0.99)},
        {"barrel_loc": kick(0.25), "barrel_rot": (0.01, 0, 0)},
        {"barrel_loc": kick(0.08)},
        {"barrel_loc": kick(0.0)},
    ]}
    clips["hit"] = jolt_clip(extra=lambda i: {"barrel_rot": (0.07 * (1 - i / 2), 0, 0)})
    clips["defeat"] = wreck_clip(n=9, fps=12, sink=0.55, extra=lambda p, i: {"barrel_rot": (-0.9 * p * p, 0, 0.3 * p), "barrel_loc": (0.5 * p * p, 0.2 * p, -0.9 * p * p)})
    return clips


# ---------------------------------------------------------------- debris pose

_pose = U.pose


def pose_with_debris(rig, p):
    """Debris pieces fly out from their rest positions along an arc while
    `debris_k` runs 0..1 (deploy eruptions, burrow spawns)."""
    _pose(rig, p)
    k = p.get("debris_k")
    objs = rig["sets"].get("debris", [])
    if k is None or not objs:
        return
    sx = -1 if U.VIEW[0] == "rear" and not rig.get("mirror_geo") else 1
    for i, o in enumerate(objs):
        rest = rig.setdefault("_debris_rest", {}).setdefault(o.name, o.location.copy())
        a = i / len(objs) * TAU
        mouth = p.get("debris_mouth")
        d = V((math.cos(a) * (0.5 if mouth else 1.0), (-0.9 if mouth else math.sin(a)) - (0.15 * (i % 3) if mouth else 0), 0))
        if mouth:
            d.x += (i - len(objs) / 2) * 0.22
        o.location = rest + V((sx * d.x * 1.2 * k, d.y * 1.0 * k, 1.4 * k - 1.5 * k * k + 0.1))
    bpy.context.view_layer.update()


U.pose = pose_with_debris


# ---------------------------------------------------------------- registry

def bspec(build, clips, cell, pivot, px, identity=(7.6, 2.0), lift=None):
    k = px / 16.0
    cell = tuple(int(round(c * k / 2)) * 2 for c in cell)
    pivot = tuple(int(round(c * k / 2)) * 2 for c in pivot)
    return {"build": build, "clips": clips, "cell": cell, "pivot": pivot, "px": px, "outlineK": 1.5,
            "identityScale": identity[0], "identityLook": identity[1], "lift": lift or {"front": 0.22, "rear": 0.05},
            "card": {"center": (0, 0, 2.0), "scale": 6.5, "pitch": 80, "outline": 1.3, "pose": {}}}


BUILDINGS = {
    "rift_sentry": bspec(rift_sentry, sentry_clips, (200, 204), (100, 136), px=27.0, identity=(7.4, 2.2)),
    "decoy_totem": bspec(decoy_totem, totem_clips, (200, 214), (100, 160), px=26.0, identity=(7.6, 2.6)),
    "chog_burrow": bspec(chog_burrow, burrow_clips, (210, 196), (105, 124), px=28.0, identity=(7.8, 1.3)),
    "rift_mortar": bspec(rift_mortar, mortar_clips, (210, 220), (100, 146), px=30.0, identity=(7.8, 2.2)),
}

FINAL = dict(BUILDINGS)

if __name__ == "__main__":
    try:
        import final_chars  # noqa: E402

        FINAL.update(final_chars.CHARS)
    except ImportError:
        pass
    U.main(FINAL)
