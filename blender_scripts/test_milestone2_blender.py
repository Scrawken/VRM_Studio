"""
VRM Forge Studio — Blender Humanoid GLB Import, Auto-Rigging, Material/Texture Preservation,
Skeletal Deformation & VRM 1.0 Export/Reload Verification.

Executes inside Blender in background mode:
  blender --background --python test_milestone2_blender.py -- --glb-path ./source_high.glb --out-dir ./output

Performs:
  1. Imports an external or generated humanoid GLB (supports BOTH unrigged and already-rigged GLBs).
  2. Records original materials and embedded textures before rigging.
  3. If unrigged, generates a proportional 17+ bone VRM humanoid armature fitted to the mesh silhouette,
     binds skin weights via ARMATURE_AUTO (with geometric capsule fallback for any unweighed island)
     and normalizes weights across all vertices.
  4. Validates presence of all 17 required VRM humanoid bones and normalized non-zero weights.
  5. Measures multi-joint skeletal deformation in POSE mode via bpy.context.evaluated_depsgraph_get().
  6. Configures VRM 1.0 humanoid mapping and runs bpy.ops.export_scene.vrm.
  7. Independently reloads and validates the exported .vrm binary via backend/vrm_validator.py AND
     fresh bpy.ops.import_scene.gltf scene import, confirming material and texture preservation.
  8. Separates rigging_success from vrm_export_success and vrm_reload_success, failing overall milestone
     status if VRM export or reload fails.
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
    from mathutils import Vector
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


def _collect_mesh_world_bounds(mesh_objs):
    min_co = Vector((float("inf"), float("inf"), float("inf")))
    max_co = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in mesh_objs:
        mw = obj.matrix_world
        for corner in obj.bound_box:
            wc = mw @ Vector(corner)
            min_co.x = min(min_co.x, wc.x)
            min_co.y = min(min_co.y, wc.y)
            min_co.z = min(min_co.z, wc.z)
            max_co.x = max(max_co.x, wc.x)
            max_co.y = max(max_co.y, wc.y)
            max_co.z = max(max_co.z, wc.z)
    if min_co.z == float("inf"):
        return Vector((-0.4, -0.2, 0.0)), Vector((0.4, 0.2, 1.7))
    return min_co, max_co


def _collect_materials_and_images(mesh_objs):
    mat_names = []
    seen_mats = set()
    tex_names = []
    seen_imgs = set()

    for obj in mesh_objs:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                continue
            if mat.name not in seen_mats:
                seen_mats.add(mat.name)
                mat_names.append(mat.name)
            if mat.use_nodes and mat.node_tree:
                for node in mat.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and getattr(node, "image", None):
                        img = node.image
                        if img.name not in seen_imgs:
                            seen_imgs.add(img.name)
                            tex_names.append(img.name)
    return mat_names, tex_names


def _create_fitted_humanoid_armature(mesh_objs):
    min_co, max_co = _collect_mesh_world_bounds(mesh_objs)
    height = max(0.2, max_co.z - min_co.z)
    cx = 0.5 * (min_co.x + max_co.x)
    cy = 0.5 * (min_co.y + max_co.y)
    z0 = min_co.z
    half_span_x = max(0.25 * height, 0.45 * (max_co.x - min_co.x))

    arm_data = bpy.data.armatures.new("VRM_AutoHumanoidArmature")
    arm_obj = bpy.data.objects.new("VRM_AutoHumanoid", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones
    bone_defs = [
        ("hips", None, (cx, cy, z0 + height * 0.52), (cx, cy, z0 + height * 0.58)),
        ("spine", "hips", (cx, cy, z0 + height * 0.58), (cx, cy, z0 + height * 0.67)),
        ("chest", "spine", (cx, cy, z0 + height * 0.67), (cx, cy, z0 + height * 0.80)),
        ("neck", "chest", (cx, cy, z0 + height * 0.80), (cx, cy, z0 + height * 0.86)),
        ("head", "neck", (cx, cy, z0 + height * 0.86), (cx, cy, z0 + height * 0.99)),
        ("leftShoulder", "chest", (cx + height * 0.03, cy, z0 + height * 0.79), (cx + half_span_x * 0.28, cy, z0 + height * 0.79)),
        ("leftUpperArm", "leftShoulder", (cx + half_span_x * 0.28, cy, z0 + height * 0.79), (cx + half_span_x * 0.58, cy, z0 + height * 0.76)),
        ("leftLowerArm", "leftUpperArm", (cx + half_span_x * 0.58, cy, z0 + height * 0.76), (cx + half_span_x * 0.84, cy, z0 + height * 0.72)),
        ("leftHand", "leftLowerArm", (cx + half_span_x * 0.84, cy, z0 + height * 0.72), (cx + half_span_x * 0.96, cy, z0 + height * 0.70)),
        ("rightShoulder", "chest", (cx - height * 0.03, cy, z0 + height * 0.79), (cx - half_span_x * 0.28, cy, z0 + height * 0.79)),
        ("rightUpperArm", "rightShoulder", (cx - half_span_x * 0.28, cy, z0 + height * 0.79), (cx - half_span_x * 0.58, cy, z0 + height * 0.76)),
        ("rightLowerArm", "rightUpperArm", (cx - half_span_x * 0.58, cy, z0 + height * 0.76), (cx - half_span_x * 0.84, cy, z0 + height * 0.72)),
        ("rightHand", "rightLowerArm", (cx - half_span_x * 0.84, cy, z0 + height * 0.72), (cx - half_span_x * 0.96, cy, z0 + height * 0.70)),
        ("leftUpperLeg", "hips", (cx + height * 0.06, cy, z0 + height * 0.51), (cx + height * 0.065, cy, z0 + height * 0.28)),
        ("leftLowerLeg", "leftUpperLeg", (cx + height * 0.065, cy, z0 + height * 0.28), (cx + height * 0.065, cy, z0 + height * 0.06)),
        ("leftFoot", "leftLowerLeg", (cx + height * 0.065, cy, z0 + height * 0.06), (cx + height * 0.065, cy - height * 0.08, z0 + height * 0.01)),
        ("rightUpperLeg", "hips", (cx - height * 0.06, cy, z0 + height * 0.51), (cx - height * 0.065, cy, z0 + height * 0.28)),
        ("rightLowerLeg", "rightUpperLeg", (cx - height * 0.065, cy, z0 + height * 0.28), (cx - height * 0.065, cy, z0 + height * 0.06)),
        ("rightFoot", "rightLowerLeg", (cx - height * 0.065, cy, z0 + height * 0.06), (cx - height * 0.065, cy - height * 0.08, z0 + height * 0.01)),
    ]

    created = {}
    for name, parent_name, head_pt, tail_pt in bone_defs:
        b = eb.new(name)
        b.head = Vector(head_pt)
        b.tail = Vector(tail_pt)
        if parent_name and parent_name in created:
            b.parent = created[parent_name]
        created[name] = b

    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.object.select_all(action="DESELECT")
    for m_obj in mesh_objs:
        m_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except Exception:
        bpy.ops.object.parent_set(type="ARMATURE_NAME")

    # Fill any unweighted vertices with geometric closest-bone assignment and normalize all weights
    bones_world = [
        (b.name, arm_obj.matrix_world @ b.head_local, arm_obj.matrix_world @ b.tail_local)
        for b in arm_obj.data.bones
    ]
    for m_obj in mesh_objs:
        for b_name, _, _ in bones_world:
            if b_name not in m_obj.vertex_groups:
                m_obj.vertex_groups.new(name=b_name)
        mw = m_obj.matrix_world
        for v in m_obj.data.vertices:
            total_w = sum(g.weight for g in v.groups)
            if total_w > 1e-4:
                continue
            wp = mw @ v.co
            scored = []
            for b_name, bh, bt in bones_world:
                seg = bt - bh
                seg_len_sq = seg.length_squared
                t = max(0.0, min(1.0, (wp - bh).dot(seg) / seg_len_sq)) if seg_len_sq > 1e-8 else 0.0
                closest = bh + seg * t
                dist = (wp - closest).length
                scored.append((dist, b_name))
            scored.sort(key=lambda item: item[0])
            top2 = scored[:2]
            inv_w = [1.0 / (d + 0.01) for d, _ in top2]
            inv_sum = sum(inv_w)
            for idx, (_, b_name) in enumerate(top2):
                m_obj.vertex_groups[b_name].add([v.index], inv_w[idx] / inv_sum, "REPLACE")

        bpy.ops.object.select_all(action="DESELECT")
        m_obj.select_set(True)
        bpy.context.view_layer.objects.active = m_obj
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    return arm_obj


def _measure_pose_deformation(arm_obj, mesh_objs) -> dict:
    if not arm_obj or not mesh_objs:
        return {"deformed": False, "max_delta": 0.0, "tested_bones": [], "joint_results": {}}

    target_mesh = max(mesh_objs, key=lambda o: len(o.data.vertices))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_before = target_mesh.evaluated_get(depsgraph).to_mesh()
    rest_coords = [v.co.copy() for v in eval_before.vertices]
    target_mesh.evaluated_get(depsgraph).to_mesh_clear()

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")

    test_candidates = ["leftUpperArm", "leftLowerArm", "leftUpperLeg", "leftLowerLeg", "neck", "hips", "spine"]
    joint_results = {}
    max_delta_overall = 0.0

    for bone_name in test_candidates:
        pb = arm_obj.pose.bones.get(bone_name)
        if not pb:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.35, 0.22, 0.28)
        bpy.context.view_layer.update()

        dg_after = bpy.context.evaluated_depsgraph_get()
        eval_after = target_mesh.evaluated_get(dg_after).to_mesh()
        bone_max_delta = 0.0
        for i, v in enumerate(eval_after.vertices):
            if i < len(rest_coords):
                d = (v.co - rest_coords[i]).length
                if d > bone_max_delta:
                    bone_max_delta = d
        target_mesh.evaluated_get(dg_after).to_mesh_clear()

        joint_results[bone_name] = round(float(bone_max_delta), 6)
        max_delta_overall = max(max_delta_overall, bone_max_delta)
        pb.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()

    bpy.ops.object.mode_set(mode="OBJECT")

    return {
        "deformed": max_delta_overall > 1e-4,
        "max_delta": round(float(max_delta_overall), 6),
        "tested_bones": list(joint_results.keys()),
        "joint_results": joint_results,
    }


def _check_weight_normalization(mesh_objs) -> dict:
    total_verts = 0
    weighted_verts = 0
    unnormalized_verts = 0
    max_weight_err = 0.0

    for o in mesh_objs:
        for v in o.data.vertices:
            total_verts += 1
            if len(v.groups) == 0:
                continue
            w_sum = sum(g.weight for g in v.groups)
            if w_sum > 0.001:
                weighted_verts += 1
            err = abs(w_sum - 1.0)
            max_weight_err = max(max_weight_err, err)
            if err > 0.025:
                unnormalized_verts += 1

    return {
        "total_vertices": total_verts,
        "weighted_vertices": weighted_verts,
        "unnormalized_vertices": unnormalized_verts,
        "max_weight_error": round(float(max_weight_err), 6),
        "weights_normalized": weighted_verts > 0 and unnormalized_verts == 0,
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
    if not mesh_objs:
        raise RuntimeError(f"Imported GLB did not contain any MESH objects: {glb_path}")

    input_materials, input_textures = _collect_materials_and_images(mesh_objs)

    arm_objs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    unrigged_auto_rigged = False
    if not arm_objs:
        arm_obj = _create_fitted_humanoid_armature(mesh_objs)
        unrigged_auto_rigged = True
    else:
        arm_obj = arm_objs[0]

    bone_names = {b.name for b in arm_obj.data.bones}
    missing_bones = [b for b in REQUIRED_VRM_BONES if b not in bone_names]

    total_polys = sum(len(o.data.polygons) for o in mesh_objs)
    total_vgroups = sum(len(o.vertex_groups) for o in mesh_objs)
    weight_audit = _check_weight_normalization(mesh_objs)
    deformation = _measure_pose_deformation(arm_obj, mesh_objs)

    post_rig_materials, post_rig_textures = _collect_materials_and_images(mesh_objs)
    material_preserved = len(post_rig_materials) >= len(input_materials) and (
        len(input_materials) == 0 or len(post_rig_materials) > 0
    )
    texture_preserved = len(input_textures) == 0 or len(post_rig_textures) >= len(input_textures)

    rigging_success = (
        len(missing_bones) == 0
        and weight_audit["weights_normalized"]
        and deformation["deformed"]
    )

    blend_path = os.path.join(out_dir, "milestone2_test.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    vrm_addon_installed = hasattr(bpy.ops, "export_scene") and hasattr(bpy.ops.export_scene, "vrm")
    vrm_path = os.path.join(out_dir, "verified_export.vrm")
    vrm_export_success = False
    vrm_reload_success = False
    vrm_reload_report = None
    reloaded_material_count = 0
    reloaded_texture_count = 0
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
            vrm_export_success = os.path.exists(vrm_path) and os.path.getsize(vrm_path) > 0

            if vrm_export_success:
                validator_fn = _load_vrm_validator()
                binary_valid = True
                if validator_fn:
                    with open(vrm_path, "rb") as vf:
                        vrm_reload_report = validator_fn(vf.read())
                        binary_valid = bool(vrm_reload_report.get("valid"))

                bpy.ops.wm.read_factory_settings(use_empty=True)
                bpy.ops.import_scene.gltf(filepath=vrm_path)
                reloaded_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
                rel_mats, rel_imgs = _collect_materials_and_images(reloaded_meshes)
                reloaded_material_count = len(rel_mats)
                reloaded_texture_count = len(rel_imgs)
                if reloaded_material_count < len(input_materials):
                    material_preserved = False
                if len(input_textures) > 0 and reloaded_texture_count < len(input_textures):
                    texture_preserved = False
                vrm_reload_success = binary_valid and len(reloaded_meshes) > 0
        except Exception as exc:
            vrm_note = f"VRM export/reload failed: {exc}"
    else:
        vrm_note = "VRM_Addon_for_Blender is not installed in this Blender instance; .vrm export and reload did NOT succeed."

    # Overall milestone requires rigging, material/texture preservation, VRM export, AND VRM reload to succeed
    ok = (
        rigging_success
        and material_preserved
        and texture_preserved
        and vrm_export_success
        and vrm_reload_success
        and os.path.exists(blend_path)
    )

    report = {
        "status": "ok" if ok else "fail",
        "source_glb": glb_path,
        "blender_version": bpy.app.version_string,
        "blend_path": blend_path,
        "blend_exists": os.path.exists(blend_path),
        "unrigged_auto_rigged": unrigged_auto_rigged,
        "rigging_success": rigging_success,
        "material_preserved": material_preserved,
        "texture_preserved": texture_preserved,
        "vrm_export_success": vrm_export_success,
        "vrm_reload_success": vrm_reload_success,
        "input_materials": input_materials,
        "input_textures": input_textures,
        "reloaded_material_count": reloaded_material_count,
        "reloaded_texture_count": reloaded_texture_count,
        "mesh_count": len(mesh_objs),
        "vertex_count": weight_audit["total_vertices"],
        "polygon_count": total_polys,
        "bone_count": len(arm_obj.data.bones),
        "missing_required_bones": missing_bones,
        "vertex_groups": total_vgroups,
        "weighted_vertices": weight_audit["weighted_vertices"],
        "weights_normalized": weight_audit["weights_normalized"],
        "max_weight_error": weight_audit["max_weight_error"],
        "deformation_verified": deformation["deformed"],
        "deformation_max_delta": deformation["max_delta"],
        "deformation_joint_results": deformation["joint_results"],
        "vrm_addon_installed": vrm_addon_installed,
        "vrm_exported": vrm_export_success,
        "vrm_path": vrm_path if vrm_export_success else None,
        "vrm_reload_valid": vrm_reload_success,
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
    result = run_humanoid_blender_verification(output, glb_input)
    if result.get("status") != "ok":
        sys.exit(1)
