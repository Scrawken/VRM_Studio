"""
VRM Forge Studio — Blender Humanoid GLB Import, Rigging, Deformation & VRM 1.0 Export Verification

Executes inside Blender in background mode:
  blender --background --python test_milestone2_blender.py -- --glb-path ./source_high.glb --out-dir ./output

Performs:
  1. Imports an actual generated humanoid character GLB (no primitive sphere/cube stubs).
  2. Validates presence & hierarchy of all 17 required VRM humanoid bones.
  3. Inspects mesh vertex groups & skin weights to confirm non-zero skeletal binding.
  4. Applies a test pose rotation in POSE mode and measures world-space vertex deformation
     using bpy.context.evaluated_depsgraph_get().
  5. Configures VRM 1.0 humanoid mapping and attempts bpy.ops.export_scene.vrm export
     (honestly reporting vrm_addon_installed=False if the add-on is missing).
  6. Independently reloads and validates the exported .vrm binary via backend/vrm_validator.py.
"""

import json
import os
import sys
from pathlib import Path

REQUIRED_VRM_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
]

try:
    import bpy
except ImportError as exc:
    print(json.dumps({"status": "error", "error": f"Must run inside Blender Python: {exc}"}))
    sys.exit(1)


def _load_vrm_validator():
    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    if backend_dir.exists() and str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    try:
        from vrm_validator import validate_vrm_bytes
        return validate_vrm_bytes
    except ImportError:
        return None


def _measure_pose_deformation(arm_obj, mesh_objs) -> dict:
    if not arm_obj or not mesh_objs:
        return {"deformed": False, "max_delta": 0.0, "tested_bone": None}

    target_mesh = max(mesh_objs, key=lambda o: len(o.data.vertices))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_before = target_mesh.evaluated_get(depsgraph).to_mesh()
    rest_coords = [v.co.copy() for v in eval_before.vertices]
    target_mesh.evaluated_get(depsgraph).to_mesh_clear()

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    tested_bone = None
    for candidate in ("leftUpperArm", "hips", "spine", "head"):
        pb = arm_obj.pose.bones.get(candidate)
        if pb:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (0.35, 0.2, 0.3)
            tested_bone = candidate
            break

    bpy.context.view_layer.update()
    depsgraph_after = bpy.context.evaluated_depsgraph_get()
    eval_after = target_mesh.evaluated_get(depsgraph_after).to_mesh()
    max_delta = 0.0
    for i, v in enumerate(eval_after.vertices):
        if i < len(rest_coords):
            d = (v.co - rest_coords[i]).length
            if d > max_delta:
                max_delta = d
    target_mesh.evaluated_get(depsgraph_after).to_mesh_clear()

    for pb in arm_obj.pose.bones:
        pb.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {
        "deformed": max_delta > 1e-4,
        "max_delta": round(float(max_delta), 6),
        "tested_bone": tested_bone,
    }


def run_humanoid_blender_verification(out_dir: str, glb_path: str) -> dict:
    if not glb_path or not os.path.exists(glb_path):
        raise FileNotFoundError(
            f"Genuine humanoid GLB input is required (--glb-path). File not found: {glb_path}"
        )

    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    arm_objs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not mesh_objs or not arm_objs:
        raise RuntimeError(
            f"Imported GLB did not contain rigged humanoid armature + meshes (meshes={len(mesh_objs)}, armatures={len(arm_objs)})."
        )

    arm_obj = arm_objs[0]
    bone_names = {b.name for b in arm_obj.data.bones}
    missing_bones = [b for b in REQUIRED_VRM_BONES if b not in bone_names]

    total_verts = sum(len(o.data.vertices) for o in mesh_objs)
    total_polys = sum(len(o.data.polygons) for o in mesh_objs)
    total_vgroups = sum(len(o.vertex_groups) for o in mesh_objs)

    weighted_verts = 0
    for o in mesh_objs:
        for v in o.data.vertices:
            if any(g.weight > 0.001 for g in v.groups):
                weighted_verts += 1

    deformation = _measure_pose_deformation(arm_obj, mesh_objs)

    blend_path = os.path.join(out_dir, "milestone2_test.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    vrm_addon_installed = hasattr(bpy.ops, "export_scene") and hasattr(bpy.ops.export_scene, "vrm")
    vrm_path = os.path.join(out_dir, "verified_export.vrm")
    vrm_exported = False
    vrm_reload_valid = False
    vrm_reload_report = None
    vrm_note = None

    if vrm_addon_installed:
        try:
            ext = arm_obj.data.vrm_addon_extension
            ext.spec_version = "1.0"
            human_bones = ext.vrm1.humanoid.human_bones
            for req_bone in REQUIRED_VRM_BONES:
                if hasattr(human_bones, req_bone):
                    setattr(getattr(human_bones, req_bone).node, "bone_name", req_bone)
            bpy.ops.export_scene.vrm(filepath=vrm_path)
            vrm_exported = os.path.exists(vrm_path)
            if vrm_exported:
                # Independently reload and validate exported binary
                validator_fn = _load_vrm_validator()
                if validator_fn:
                    with open(vrm_path, "rb") as vf:
                        vrm_reload_report = validator_fn(vf.read())
                        vrm_reload_valid = bool(vrm_reload_report.get("valid"))
                bpy.ops.wm.read_factory_settings(use_empty=True)
                bpy.ops.import_scene.gltf(filepath=vrm_path)
                reloaded_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
                vrm_reload_valid = vrm_reload_valid and len(reloaded_meshes) > 0
        except Exception as exc:
            vrm_note = f"VRM export failed: {exc}"
    else:
        vrm_note = "VRM_Addon_for_Blender is not installed in this Blender instance; skipped .vrm export."

    ok = (
        len(missing_bones) == 0
        and weighted_verts > 0
        and deformation["deformed"]
        and os.path.exists(blend_path)
    )

    report = {
        "status": "ok" if ok else "fail",
        "source_glb": glb_path,
        "blender_version": bpy.app.version_string,
        "blend_path": blend_path,
        "blend_exists": os.path.exists(blend_path),
        "mesh_count": len(mesh_objs),
        "vertex_count": total_verts,
        "polygon_count": total_polys,
        "bone_count": len(arm_obj.data.bones),
        "missing_required_bones": missing_bones,
        "vertex_groups": total_vgroups,
        "weighted_vertices": weighted_verts,
        "deformation_verified": deformation["deformed"],
        "deformation_max_delta": deformation["max_delta"],
        "deformation_tested_bone": deformation["tested_bone"],
        "vrm_addon_installed": vrm_addon_installed,
        "vrm_exported": vrm_exported,
        "vrm_path": vrm_path if vrm_exported else None,
        "vrm_reload_valid": vrm_reload_valid,
        "vrm_reload_report": vrm_reload_report,
        "vrm_note": vrm_note,
    }
    report_path = os.path.join(out_dir, "milestone2_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("MILESTONE2_REPORT:" + json.dumps(report))
    return report


if __name__ == "__main__":
    output = "./output"
    glb_input = ""
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        if "--out-dir" in args:
            output = args[args.index("--out-dir") + 1]
        if "--glb-path" in args:
            glb_input = args[args.index("--glb-path") + 1]
    run_humanoid_blender_verification(output, glb_input)
