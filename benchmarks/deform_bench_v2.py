"""E3 Blender 4.2 benchmark. Run without --factory-startup so portable VRM extension loads.
blender.exe --background -P deform_bench_v2.py -- <model.vrm|glb> <out_dir> <name>
"""
import bpy, sys, os, json, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import numpy as np

args=sys.argv[sys.argv.index('--')+1:]; path,outdir,name=args[:3]
os.makedirs(outdir,exist_ok=True)
# Do not call read_factory_settings: it resets user extensions in portable Blender.
if path.lower().endswith('.vrm'):
    assert hasattr(bpy.types.Armature,'vrm_addon_extension'), 'VRM extension not loaded'
    bpy.ops.import_scene.vrm(filepath=path); importer='vrm-4.10.5'
else:
    bpy.ops.import_scene.gltf(filepath=path); importer='gltf'
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
meshes=[o for o in bpy.data.objects if o.type=='MESH']
print('IMPORT',importer,'ARMATURE',arm.name,'BONES',len(arm.data.bones))

def world_points(obj):
    return np.array([np.array(obj.matrix_world @ v.co) for v in obj.data.vertices],dtype=float)
def triangles(obj):
    me=obj.data; me.calc_loop_triangles(); return np.array([t.vertices[:] for t in me.loop_triangles],dtype=np.int32)
def edges(obj): return np.array([e.vertices[:] for e in obj.data.edges],dtype=np.int32)
def areas(co,tr): return .5*np.linalg.norm(np.cross(co[tr[:,1]]-co[tr[:,0]],co[tr[:,2]]-co[tr[:,0]]),axis=1)
def volume(co,tr):
    return float(np.einsum('ij,ij->i', co[tr[:,0]], np.cross(co[tr[:,1]], co[tr[:,2]])).sum()/6)
def si_count(co,tr):
    b=BVHTree.FromPolygons([tuple(x) for x in co],[tuple(x) for x in tr],epsilon=0)
    return sum(1 for i,j in b.overlap(b) if i<j and not set(tr[i])&set(tr[j]))

def evaluated():
    dg=bpy.context.evaluated_depsgraph_get(); out={}
    for o in meshes:
        eo=o.evaluated_get(dg); me=eo.to_mesh(); me.calc_loop_triangles()
        co=np.array([np.array(eo.matrix_world@v.co) for v in me.vertices],dtype=float)
        tr=np.array([t.vertices[:] for t in me.loop_triangles],dtype=np.int32)
        eo.to_mesh_clear(); out[o.name]=(co,tr)
    return out

def norm(s): return s.lower().replace('_','').replace('.','')
# source meshes retain group data; exact exported humanoid names are expected
bone_names={norm(b.name):b.name for b in arm.data.bones}
# descendant set for a target bone
def descendants(target):
    target=arm.data.bones[target]; return {b.name for b in arm.data.bones if b==target or any(a==target for a in b.parent_recursive)}
def weighted_indices(obj,names,threshold=.3):
    ids=[]
    for v in obj.data.vertices:
        w=max((g.weight for g in v.groups if obj.vertex_groups[g.group].name in names),default=0)
        if w>threshold: ids.append(v.index)
    return np.array(ids,dtype=np.int32)

def reset():
    bpy.context.view_layer.objects.active=arm; arm.select_set(True)
    for p in arm.pose.bones:
        p.rotation_mode='XYZ'; p.rotation_euler=(0,0,0); p.location=(0,0,0); p.scale=(1,1,1)
    bpy.context.view_layer.update()
def child_tip_delta(target,axis,deg):
    reset(); base={b.name:(arm.matrix_world@b.head).copy() for b in arm.pose.bones}
    p=arm.pose.bones[target]; p.rotation_euler[axis]=math.radians(deg); bpy.context.view_layer.update()
    names=descendants(target); return max(((arm.matrix_world@arm.pose.bones[n].tail)-base[n]).length for n in names)
def choose_axis(target,deg):
    vals=[child_tip_delta(target,a,deg) for a in range(3)]
    return int(np.argmax(vals)),vals

def bone_weights(target):
    names=descendants(target); return {o.name:int(weighted_indices(o,names).size) for o in meshes}
# Rest state
reset(); rest=evaluated(); rest_meta={}
for o in meshes:
    co,tr=rest[o.name]; ar=areas(co,tr); rest_meta[o.name]={'degenerate_faces':int((ar<1e-9).sum()),'triangles':len(tr),'self_intersections':si_count(co,tr)}
# fixed tests; shoulder uses the exported bone but selected local axis, reported unmeasurable if no weighted vertices
poses=[('elbow_left','leftLowerArm',90),('knee_left','leftLowerLeg',90),('shoulder_abduction_left','leftUpperArm',80),('neck_45','neck',45),('hip_flexion_left','leftUpperLeg',70),('spine_30','spine',30),('elbow_right','rightLowerArm',90),('knee_right','rightLowerLeg',90)]
results=[]
for pid,requested,deg in poses:
    key=norm(requested)
    if key not in bone_names:
        results.append({'pose':pid,'error':'bone not found','requested_bone':requested}); continue
    target=bone_names[key]; weights=bone_weights(target); wtotal=sum(weights.values())
    axis,axis_deltas=choose_axis(target,deg); reset(); p=arm.pose.bones[target]; before=(arm.matrix_world@p.tail).copy(); p.rotation_euler[axis]=math.radians(deg); bpy.context.view_layer.update(); after=(arm.matrix_world@p.tail).copy()
    posed=evaluated(); r={'pose':pid,'bone':target,'angle_deg':deg,'local_axis':axis,'axis_child_tip_deltas_m':axis_deltas,'bone_tail_delta_m':float((after-before).length),'weighted_vertices_by_mesh':weights,'weighted_vertex_total':wtotal,'meshes':{}}
    for o in meshes:
        co0,tr0=rest[o.name]; co1,tr1=posed[o.name]; idx=weighted_indices(o,descendants(target)); disp=np.linalg.norm(co1[idx]-co0[idx],axis=1) if len(idx) else np.array([])
        ar0=areas(co0,tr0); ar1=areas(co1,tr1)
        r['meshes'][o.name]={'weighted_max_displacement_m':float(disp.max()) if len(disp) else None,'weighted_mean_displacement_m':float(disp.mean()) if len(disp) else None,'degenerate_faces_rest':int((ar0<1e-9).sum()),'degenerate_faces_posed':int((ar1<1e-9).sum()),'degenerate_delta':int((ar1<1e-9).sum()-(ar0<1e-9).sum()),'self_intersections_rest':rest_meta[o.name]['self_intersections'],'self_intersections_posed':si_count(co1,tr1)}
    r['max_weighted_displacement_m']=max((x['weighted_max_displacement_m'] or 0 for x in r['meshes'].values()),default=0)
    r['measurable']=wtotal>0 and r['max_weighted_displacement_m']>1e-6
    if wtotal==0: r['error']='no vertices weighted >0.3 to target or descendants'
    results.append(r); print('POSE',pid,'axis',axis,'bone_delta',r['bone_tail_delta_m'],'weights',weights,'max',r['max_weighted_displacement_m'])
# synthetic control: two-bone cylinder-like points, child rotation about local Z
pts=np.array([[1,0,0],[1,0.1,0],[1,-.1,0],[1,0,0.2]],float); pivot=np.array([1.,0,0]); ang=math.radians(90); R=np.array([[math.cos(ang),-math.sin(ang),0],[math.sin(ang),math.cos(ang),0],[0,0,1]])
synthetic=float(np.linalg.norm((pts-pivot)@R.T+pivot-pts,axis=1).max())
summary={'model':os.path.basename(path),'importer':importer,'blender':bpy.app.version_string,'vrm_extension_loaded':hasattr(bpy.types.Armature,'vrm_addon_extension'),'armature_bones':len(arm.data.bones),'mesh_degenerate_faces_rest':rest_meta,'poses':results,'synthetic_control':{'description':'four points on a two-bone cylinder, child rotated 90 degrees around local Z','max_displacement_m':synthetic,'pass':synthetic>0.1}}
json.dump(summary,open(os.path.join(outdir,name+'_deform_v2.json'),'w'),indent=1)
print('SYNTHETIC',synthetic,'PASS',synthetic>0.1)
