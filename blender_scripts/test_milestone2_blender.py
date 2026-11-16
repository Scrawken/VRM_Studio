"""
VRM Forge Studio — Milestone 2 Automated Blender Verification Script

Executes inside Blender in background mode:
  blender --background --python test_milestone2_blender.py -- --out-dir ./output

Creates:
  1. Procedural humanoid test mesh
  2. Complete VRM-compatible humanoid armature (hips -> spine -> chest -> neck -> head, arms, legs)
  3. Automatic vertex skinning / weight assignment
  4. Saves verified .blend project file
  5. Writes structured JSON execution report
"""

import json
import os
import sys

try:
    import bpy
    import bmesh
    from mathutils import Vector
except ImportError as exc:
    print(json.dumps({"status": "error", "error": f"Must run inside Blender Python: {exc}"}))
    sys.exit(1)


def run_milestone2_test(out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # 1. Create Armature
    arm_data = bpy.data.armatures.new("VRM_Test_ArmatureData")
    arm_obj = bpy.data.objects.new("VRM_Test_Armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent:
            b.parent = parent
        return b

    hips = bone("hips", (0, 0, 0.94), (0, 0, 1.06))
    spine = bone("spine", (0, 0, 1.06), (0, 0, 1.20), hips)
    chest = bone("chest", (0, 0, 1.20), (0, 0, 1.36), spine)
    neck = bone("neck", (0, 0, 1.36), (0, 0, 1.46), chest)
    bone("head", (0, 0, 1.46), (0, 0, 1.68), neck)

    for side, s in [("left", 1.0), ("right", -1.0)]:
        ua = bone(f"{side}UpperArm", (s * 0.16, 0, 1.34), (s * 0.41, 0, 1.34), chest)
        la = bone(f"{side}LowerArm", (s * 0.41, 0, 1.34), (s * 0.64, 0, 1.34), ua)
        bone(f"{side}Hand", (s * 0.64, 0, 1.34), (s * 0.72, 0, 1.34), la)

        ul = bone(f"{side}UpperLeg", (s * 0.09, 0, 0.92), (s * 0.09, 0, 0.50), hips)
        ll = bone(f"{side}LowerLeg", (s * 0.09, 0, 0.50), (s * 0.09, 0, 0.08), ul)
        bone(f"{side}Foot", (s * 0.09, 0, 0.08), (s * 0.09, -0.10, 0.02), ll)

    bpy.ops.object.mode_set(mode="OBJECT")

    # 2. Create Test Mesh
    mesh_data = bpy.data.meshes.new("VRM_Test_MeshData")
    mesh_obj = bpy.data.objects.new("VRM_Test_Mesh", mesh_data)
    bpy.context.collection.objects.link(mesh_obj)

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.14)
    for v in bm.verts:
        v.co.z += 1.56
    bmesh.ops.create_cube(bm, size=0.28)
    bm.to_mesh(mesh_data)
    bm.free()

    # 3. Skinning & Parent
    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # 4. Save .blend
    blend_path = os.path.join(out_dir, "milestone2_test.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    report = {
        "status": "ok",
        "blender_version": bpy.app.version_string,
        "blend_path": blend_path,
        "blend_exists": os.path.exists(blend_path),
        "vertex_count": len(mesh_data.vertices),
        "bone_count": len(arm_data.bones),
        "vertex_groups": len(mesh_obj.vertex_groups),
    }
    report_path = os.path.join(out_dir, "milestone2_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("MILESTONE2_REPORT:" + json.dumps(report))
    return report


if __name__ == "__main__":
    output = "./output"
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        if "--out-dir" in args:
            output = args[args.index("--out-dir") + 1]
    run_milestone2_test(output)
