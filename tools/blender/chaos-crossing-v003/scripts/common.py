"""Shared Blender setup for Chaos Crossing v003 pre-rendered 2.5D assets.

Camera contract (matches the live Phaser board, seat-0 logical frame):
- Orthographic camera pitched TILT degrees from straight down, looking north (+Y).
- Logical arena point (x, y) maps to world (x, (y - 80) / cos(TILT), 0), so ground
  positions land on the exact master pixel px = 100 + 10x, py = 120 + 10(160 - y).
- Heights project upward on screen by sin(TILT) per unit.
- Local player (low y) is always at the bottom of the image. Every v003 layer is
  camera-space and renders unflipped for both seats.
"""
import math
import bpy
from mathutils import Vector

TILT = math.radians(52.0)
COS = math.cos(TILT)
SIN = math.sin(TILT)
MASTER_PX_PER_UNIT = 10


def wy(y):
    """Logical seat-0 y -> world Y on the ground plane."""
    return (y - 80.0) / COS


def wpos(x, y, z=0.0):
    return Vector((x, wy(y), z))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    ee = sc.eevee
    ee.taa_render_samples = 64
    for attr, val in (("use_raytracing", True), ("use_shadows", True), ("shadow_ray_count", 2), ("shadow_step_count", 8)):
        try:
            setattr(ee, attr, val)
        except (AttributeError, TypeError):
            pass
    try:
        ee.fast_gi_method = "GLOBAL_ILLUMINATION"
    except (AttributeError, TypeError):
        pass
    try:
        ee.ray_tracing_options.resolution_scale = "2"
    except (AttributeError, TypeError):
        pass
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.render.filter_size = 1.2
    return sc


def setup_world(strength=0.75):
    w = bpy.data.worlds.new("SkyFill")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.6, 0.75, 0.98, 1.0)  # soft cool fill
    bg.inputs[1].default_value = strength
    return w


def setup_sun(strength=3.6, warmth=(1.0, 0.91, 0.76)):
    """Warm key from the upper-left of the screen, shadows fall down-right."""
    d = bpy.data.lights.new("Sun", "SUN")
    d.energy = strength
    d.color = warmth
    d.angle = math.radians(3.0)
    d.use_shadow = True
    o = bpy.data.objects.new("Sun", d)
    bpy.context.scene.collection.objects.link(o)
    # Light travels toward +x, -y, -z (from upper-left, slightly behind the board).
    direction = Vector((0.55, -0.35, -0.76)).normalized()
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


def ortho_camera(name, center_world, ortho_scale, res_x, res_y):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new(name)
    cam.type = "ORTHO"
    cam.ortho_scale = ortho_scale
    cam.clip_start = 0.1
    cam.clip_end = 2000
    o = bpy.data.objects.new(name, cam)
    sc.collection.objects.link(o)
    o.rotation_euler = (TILT, 0.0, 0.0)
    view = Vector((0.0, SIN, -COS))
    o.location = Vector(center_world) - view * 400.0
    sc.camera = o
    sc.render.resolution_x = res_x
    sc.render.resolution_y = res_y
    sc.render.resolution_percentage = 100
    sc.render.pixel_aspect_x = 1
    sc.render.pixel_aspect_y = 1
    return o


def arena_camera():
    """1200x1840 master, 10 px/unit, centered on logical (50, 80)."""
    return ortho_camera("ArenaCam", wpos(50, 80), 184.0, 1200, 1840)


SCREEN_UP = Vector((0.0, COS, SIN))


def mount_camera(px_per_unit=20, res=(512, 640), pivot=(256, 560)):
    """Mount master canvas: world origin projects to `pivot` pixels."""
    w, h = res
    up_units = (h / 2 - pivot[1]) / -px_per_unit  # pixels above pivot to centre, as units
    right_units = (w / 2 - pivot[0]) / px_per_unit
    center = Vector((right_units, 0, 0)) + SCREEN_UP * up_units
    return ortho_camera("MountCam", center, max(w, h) / px_per_unit, w, h)


def project(cam_obj, world_point):
    """World point -> (px, py) top-left pixel coordinates of the current render."""
    from bpy_extras.object_utils import world_to_camera_view

    sc = bpy.context.scene
    co = world_to_camera_view(sc, cam_obj, Vector(world_point))
    return (co.x * sc.render.resolution_x, (1.0 - co.y) * sc.render.resolution_y)


# ---------------------------------------------------------------- materials

_mats = {}


def srgb(c):
    def f(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (f(c[0]), f(c[1]), f(c[2]), 1.0)


def hexc(h):
    h = h.lstrip("#")
    return srgb(tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)))


def mat(name, color, rough=0.55, metal=0.0, emit=None, emit_strength=0.0, spec=0.5, coat=0.0, sss=0.0):
    key = name
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = hexc(color) if isinstance(color, str) else color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for nm in ("Specular IOR Level", "Specular"):
        if nm in b.inputs:
            b.inputs[nm].default_value = spec
            break
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    if sss and "Subsurface Weight" in b.inputs:
        b.inputs["Subsurface Weight"].default_value = sss
    if emit is not None:
        b.inputs["Emission Color"].default_value = hexc(emit) if isinstance(emit, str) else emit
        b.inputs["Emission Strength"].default_value = emit_strength
    _mats[key] = m
    return m


def outline_mat():
    if "Outline" in _mats:
        return _mats["Outline"]
    m = bpy.data.materials.new("Outline")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = hexc("#1d1424")
    em.inputs[1].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs[0])
    m.use_backface_culling = True
    _mats["Outline"] = m
    return m


def add_outline(obj, thickness=0.05):
    """Inverted-hull outline, the Chog card art's heavy line translated to 3D."""
    if obj.type != "MESH":
        return
    obj.data.materials.append(outline_mat())
    mod = obj.modifiers.new("Outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(obj.data.materials) - 1


# ---------------------------------------------------------------- primitives


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def new_mesh_obj(name, verts, faces, material=None, coll=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    if material:
        me.materials.append(material)
    return link(o, coll)


def prim(kind, name, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), material=None, coll=None, smooth=True, **kw):
    ops = {
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "ico": bpy.ops.mesh.primitive_ico_sphere_add,
        "cube": bpy.ops.mesh.primitive_cube_add,
        "cyl": bpy.ops.mesh.primitive_cylinder_add,
        "cone": bpy.ops.mesh.primitive_cone_add,
        "torus": bpy.ops.mesh.primitive_torus_add,
        "plane": bpy.ops.mesh.primitive_plane_add,
    }
    ops[kind](location=loc, rotation=rot, **kw)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    if material:
        o.data.materials.append(material)
    if smooth and o.type == "MESH":
        for p in o.data.polygons:
            p.use_smooth = True
    if coll is not None:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    return o


def bevel(obj, width=0.08, segments=3):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    return m


def set_visibility(objs, camera=True, shadow=True):
    for o in objs:
        o.visible_camera = camera
        o.visible_shadow = shadow
        o.hide_render = False


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
