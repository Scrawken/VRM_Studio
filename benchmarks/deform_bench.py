"""Blender 4.2 headless: deformation benchmark + appearance renders for one VRM/GLB.
Run:  blender.exe -b --factory-startup -P deform_bench.py -- <model.vrm|glb> <out_dir> <name>
Writes <out_dir>/<name>_deform.json and PNG renders.  Never touches the original (use a temp copy).
"""
import sys, json, math, os, time
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
model, outdir, name = argv[0], argv[1], argv[2]
RENDER_POSES = set(argv[3].split(',')) if len(argv) > 3 else set()
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module='io_scene_vrm') if False else None
t0 = time.time()
if model.lower().endswith('.vrm'):
    try:
        bpy.ops.preferences.addon_enable(module='io_scene_vrm')
    except Exception as e:
        print('addon enable:', e)
    bpy.ops.import_scene.vrm(filepath=model)
    importer = 'io_scene_vrm (VRM add-on)'
else:
    bpy.ops.import_scene.gltf(filepath=model)
    importer = 'io_import_scene_gltf2'
print('imported with', importer, 'in', round(time.time() - t0, 1), 's')

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('armature', arm.name, 'bones', len(arm.data.bones), 'meshes', [m.name for m in meshes])

# ---- humanoid bone map -------------------------------------------------
hb = {}
try:
    ext = arm.data.vrm_addon_extension
    for h in ext.vrm0.humanoid.human_bones:
        if h.node.bone_name:
            hb[h.bone] = h.node.bone_name
except Exception as e:
    print('no vrm ext', e)
if not hb:  # glb path: guess from names
    for b in arm.data.bones:
        n = b.name.lower().replace('_', '').replace('.', '')
        hb[n] = b.name
# normalize keys so GLB names and VRM humanoid ids compare case-insensitively
hb_norm = {k.lower().replace('_', '').replace('.', ''): v for k, v in hb.items()}

print('humanoid bones mapped', len(hb))

def bbox_world():
    pts = []
    for m in meshes:
        pts += [m.matrix_world @ Vector(c) for c in m.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

mn, mx = bbox_world()
height = mx.z - mn.z
print('height', height, 'bbox', tuple(mn), tuple(mx))

# ---- evaluated mesh data ------------------------------------------------
dg = lambda: bpy.context.evaluated_depsgraph_get()

def eval_arrays(obj):
    d = dg()
    eo = obj.evaluated_get(d)
    me = eo.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(n, 3)
    mw = np.array(eo.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.calc_loop_triangles()
    tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', tris)
    tris = tris.reshape(-1, 3)
    edges = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get('vertices', edges)
    edges = edges.reshape(-1, 2)
    eo.to_mesh_clear()
    return co.astype(np.float64), tris, edges

def tri_areas(co, tris):
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)

def signed_volume(co, tris):
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)

def self_intersections(co, tris):
    """pairs of triangles that overlap and share no vertex (BVH, cheap approximation, fine-tolerance ignored)"""
    bvh = BVHTree.FromPolygons([tuple(v) for v in co.tolist()], [tuple(t) for t in tris.tolist()], epsilon=0.0)
    pairs = bvh.overlap(bvh)
    cnt = 0
    for i, j in pairs:
        if i < j and not (set(tris[i].tolist()) & set(tris[j].tolist())):
            cnt += 1
    return cnt

# choose the actual face/body mesh when present; fallback is deterministic
body = next((m for m in meshes if 'faceandbody' in m.name.lower().replace('_', '')), max(meshes, key=lambda m: len(m.data.vertices)))
print('body mesh', body.name)

def snapshot():
    bpy.context.view_layer.update()
    return {m.name: eval_arrays(m) for m in meshes}

rest = snapshot()
body_rest_vol = signed_volume(rest[body.name][0], rest[body.name][1])
rest_areas = tri_areas(*rest[body.name][:2])
body_rest_si = self_intersections(*rest[body.name][:2])
print('rest volume', body_rest_vol, 'rest self-intersections', body_rest_si)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')

FRONT = Vector((0, -1, 0)); UP = Vector((0, 0, 1))

def bone_dir(pb):
    return (pb.tail - pb.head).normalized()  # armature space (pose bone head/tail are armature-space)

def reset_pose():
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()

def rotate_bone(bone_name, axis, deg):
    pb = arm.pose.bones[bone_name]
    h = pb.head.copy()
    R = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, axis.normalized()) @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()
    return h

# (id, humanoid bone, angle, radius(m), function giving axis from rest bone direction)
def side(s):
    return [
        (f'elbow_{s}',    f'{s}LowerArm', 90, 0.07, lambda d: d.cross(FRONT)),
        (f'knee_{s}',     f'{s}LowerLeg', 90, 0.09, lambda d: d.cross(-FRONT)),
        (f'shoulder_abd_{s}', f'{s}UpperArm', 80, 0.10, lambda d: d.cross(UP)),
        (f'hip_flex_{s}', f'{s}UpperLeg', 70, 0.11, lambda d: d.cross(FRONT)),
    ]
POSES = side('left') + [
    ('neck_45', 'neck', 45, 0.07, lambda d: d.cross(FRONT)),
    ('spine_30', 'spine', 30, 0.14, lambda d: d.cross(FRONT)),
]
# also right side for symmetry sanity
POSES += side('right')[:2]

def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_cavity = False
    sh.background_type = 'VIEWPORT'; sh.background_color = (0.62, 0.64, 0.68)
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    sc.camera = cam
    return cam

def hide_nonbody(vis):
    pass

def shot(cam, path, center, direction, ortho, up=UP):
    cam.data.ortho_scale = ortho
    cam.data.clip_start = 0.01; cam.data.clip_end = 50
    cam.location = center + direction.normalized() * 5
    rot = (-direction).to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot.to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

cam = setup_render()
cx = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))

# object mode needed for render
def render_view(tag, center, dirv, ortho):
    p = os.path.join(outdir, f'{name}_{tag}.png')
    shot(cam, p, center, dirv, ortho)
    return p

# ---- appearance renders (rest pose) ------------------------------------
reset_pose()
headb = arm.pose.bones[hb['head']] if 'head' in hb else None
hc = (arm.matrix_world @ headb.head) if headb else Vector((0, 0, mx.z - 0.15))
hc.z += 0.06
render_view('front', cx, Vector((0, -1, 0)), height * 1.15)
render_view('side', cx, Vector((1, 0, 0)), height * 1.15)
render_view('face', hc, Vector((0, -1, 0)), 0.42)
render_view('back', cx, Vector((0, 1, 0)), height * 1.15)

# ---- deformation benchmark ---------------------------------------------
results = []
for pid, bone, deg, radius, axf in POSES:
    key = bone.lower().replace('_', '').replace('.', '')
    if key not in hb_norm:
        results.append({'pose': pid, 'error': f'bone {bone} not mapped'}); continue
    reset_pose()
    bname = hb_norm[key]
    pb = arm.pose.bones[bname]
    d = bone_dir(pb)
    axis = axf(d)
    if axis.length < 1e-6:
        results.append({'pose': pid, 'error': 'degenerate axis'}); continue
    h = rotate_bone(bname, axis, deg)
    snap = snapshot()
    hw = np.array(arm.matrix_world @ h)
    r = {'pose': pid, 'bone': bname, 'angle_deg': deg, 'region_radius_m': radius}
    # per-mesh metrics
    allmax = 0.0
    for m in meshes:
        co0, tr0, ed0 = rest[m.name]
        co1 = snap[m.name][0]
        disp = np.linalg.norm(co1 - co0, axis=1)
        allmax = max(allmax, float(disp.max()))
    r['max_vertex_displacement_m_all_meshes'] = allmax
    co0, tr0, ed0 = rest[body.name]
    co1 = snap[body.name][0]
    disp = np.linalg.norm(co1 - co0, axis=1)
    r['body_max_displacement_m'] = float(disp.max())
    inreg = np.linalg.norm(co0 - hw, axis=1) < radius
    r['region_vertices'] = int(inreg.sum())
    em = inreg[ed0[:, 0]] & inreg[ed0[:, 1]]
    if em.sum() > 0:
        l0 = np.linalg.norm(co0[ed0[em, 0]] - co0[ed0[em, 1]], axis=1)
        l1 = np.linalg.norm(co1[ed0[em, 0]] - co1[ed0[em, 1]], axis=1)
        ok = l0 > 1e-6
        ratio = l1[ok] / l0[ok]
        r['edge_stretch_max'] = float(ratio.max()); r['edge_stretch_p99'] = float(np.percentile(ratio, 99))
        r['edge_compress_min'] = float(ratio.min()); r['region_edges'] = int(ok.sum())
    tm = inreg[tr0].all(axis=1)
    a1 = tri_areas(co1, tr0)
    if tm.sum() > 0:
        r['region_area_ratio'] = float(a1[tm].sum() / rest_areas[tm].sum())
        r['region_area_ratio_min_tri'] = float((a1[tm] / np.maximum(rest_areas[tm], 1e-12)).min())
    vol1 = signed_volume(co1, tr0)
    r['body_volume_change_pct'] = 100.0 * (vol1 - body_rest_vol) / abs(body_rest_vol)
    r['degenerate_faces_posed'] = int((a1 < 1e-9).sum())
    r['degenerate_faces_rest'] = int((rest_areas < 1e-9).sum())
    t1 = time.time()
    r['self_intersections_posed'] = self_intersections(co1, tr0)
    r['self_intersections_rest'] = body_rest_si
    results.append(r)
    if pid in RENDER_POSES:
        bpy.ops.object.mode_set(mode='OBJECT')
        side_dir = Vector((1, 0, 0)) if pid.startswith(('elbow', 'knee', 'hip', 'neck', 'spine')) else Vector((0, -1, 0))
        render_view('pose_' + pid, cx, side_dir, height * 1.15)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='POSE')
    print(pid, {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})

summary = {'model': os.path.basename(os.path.dirname(model)) + '/' + os.path.basename(model), 'importer': importer,
           'blender': bpy.app.version_string, 'height_m': height, 'body_mesh': body.name,
           'body_rest_volume': body_rest_vol, 'body_rest_self_intersections': body_rest_si,
           'humanoid_bones_mapped': len(hb), 'poses': results}
json.dump(summary, open(os.path.join(outdir, f'{name}_deform.json'), 'w'), indent=1)
print('DONE', round(time.time() - t0, 1), 's')
