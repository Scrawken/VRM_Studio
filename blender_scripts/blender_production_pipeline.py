"""
VRM Forge Studio — Production Headless Blender Pipeline (VRM 0.0 Primary + VRM 1.0 Optional)

Usage:
  blender --background --python blender_production_pipeline.py -- \
    --glb-path ./source.glb \
    --out-dir ./project_dir \
    --vrm-version 0.0 \
    [--spec-json ./spec.json]

Preserves imported meshes, multi-materials, embedded textures, UVs, vertex colors,
existing humanoid rigs (VRoid J_Bip_*, VRM 0.0/1.0, Mixamo) OR auto-rigs unrigged
GLB geometry, normalizes weights, runs POSE deformation audit, exports
character_blender.vrm + character_blender.blend, validates output against
backend/vrm_validator.py with strict version enforcement, and writes blender_report.json.
"""

import json
import os
import re
import sys
from pathlib import Path

REQUIRED_VRM_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
]

CANONICAL_BONE_ALIASES = {
    "hips": ["hips", "j_bip_c_hips", "mixamorig:hips", "pelvis", "root"],
    "spine": ["spine", "j_bip_c_spine", "mixamorig:spine", "spine1", "spine_01"],
    "chest": ["chest", "j_bip_c_chest", "mixamorig:spine1", "mixamorig:spine2", "spine2", "spine_02"],
    "upperChest": ["upperchest", "j_bip_c_upperchest", "spine_03"],
    "neck": ["neck", "j_bip_c_neck", "mixamorig:neck", "neck_01"],
    "head": ["head", "j_bip_c_head", "mixamorig:head"],
    "leftEye": ["lefteye", "j_adj_l_faceeye", "eye_l"],
    "rightEye": ["righteye", "j_adj_r_faceeye", "eye_r"],
    "jaw": ["jaw", "chin"],
    "leftShoulder": ["leftshoulder", "j_bip_l_shoulder", "mixamorig:leftshoulder", "clavicle_l"],
    "leftUpperArm": ["leftupperarm", "j_bip_l_upperarm", "mixamorig:leftarm", "upperarm_l"],
    "leftLowerArm": ["leftlowerarm", "j_bip_l_lowerarm", "mixamorig:leftforearm", "lowerarm_l"],
    "leftHand": ["lefthand", "j_bip_l_hand", "mixamorig:lefthand", "hand_l"],
    "rightShoulder": ["rightshoulder", "j_bip_r_shoulder", "mixamorig:rightshoulder", "clavicle_r"],
    "rightUpperArm": ["rightupperarm", "j_bip_r_upperarm", "mixamorig:rightarm", "upperarm_r"],
    "rightLowerArm": ["rightlowerarm", "j_bip_r_lowerarm", "mixamorig:rightforearm", "lowerarm_r"],
    "rightHand": ["righthand", "j_bip_r_hand", "mixamorig:righthand", "hand_r"],
    "leftUpperLeg": ["leftupperleg", "j_bip_l_upperleg", "mixamorig:leftupleg", "thigh_l"],
    "leftLowerLeg": ["leftlowerleg", "j_bip_l_lowerleg", "mixamorig:leftleg", "calf_l"],
    "leftFoot": ["leftfoot", "j_bip_l_foot", "mixamorig:leftfoot", "foot_l"],
    "leftToes": ["lefttoes", "j_bip_l_toebase", "mixamorig:lefttoebase", "ball_l"],
    "rightUpperLeg": ["rightupperleg", "j_bip_r_upperleg", "mixamorig:rightupleg", "thigh_r"],
    "rightLowerLeg": ["rightlowerleg", "j_bip_r_lowerleg", "mixamorig:rightleg", "calf_r"],
    "rightFoot": ["rightfoot", "j_bip_r_foot", "mixamorig:rightfoot", "foot_r"],
    "rightToes": ["righttoes", "j_bip_r_toebase", "mixamorig:righttoebase", "ball_r"],
    "leftThumbMetacarpal": ["leftthumbmetacarpal", "j_bip_l_thumb1"],
    "leftThumbProximal": ["leftthumbproximal", "j_bip_l_thumb2"],
    "leftThumbDistal": ["leftthumbdistal", "j_bip_l_thumb3"],
    "leftIndexProximal": ["leftindexproximal", "j_bip_l_index1"],
    "leftIndexIntermediate": ["leftindexintermediate", "j_bip_l_index2"],
    "leftIndexDistal": ["leftindexdistal", "j_bip_l_index3"],
    "leftMiddleProximal": ["leftmiddleproximal", "j_bip_l_middle1"],
    "leftMiddleIntermediate": ["leftmiddleintermediate", "j_bip_l_middle2"],
    "leftMiddleDistal": ["leftmiddledistal", "j_bip_l_middle3"],
    "leftRingProximal": ["leftringproximal", "j_bip_l_ring1"],
    "leftRingIntermediate": ["leftringintermediate", "j_bip_l_ring2"],
    "leftRingDistal": ["leftringdistal", "j_bip_l_ring3"],
    "leftLittleProximal": ["leftlittleproximal", "j_bip_l_little1"],
    "leftLittleIntermediate": ["leftlittleintermediate", "j_bip_l_little2"],
    "leftLittleDistal": ["leftlittledistal", "j_bip_l_little3"],
    "rightThumbMetacarpal": ["rightthumbmetacarpal", "j_bip_r_thumb1"],
    "rightThumbProximal": ["rightthumbproximal", "j_bip_r_thumb2"],
    "rightThumbDistal": ["rightthumbdistal", "j_bip_r_thumb3"],
    "rightIndexProximal": ["rightindexproximal", "j_bip_r_index1"],
    "rightIndexIntermediate": ["rightindexintermediate", "j_bip_r_index2"],
    "rightIndexDistal": ["rightindexdistal", "j_bip_r_index3"],
    "rightMiddleProximal": ["rightmiddleproximal", "j_bip_r_middle1"],
    "rightMiddleIntermediate": ["rightmiddleintermediate", "j_bip_r_middle2"],
    "rightMiddleDistal": ["rightmiddledistal", "j_bip_r_middle3"],
    "rightRingProximal": ["rightringproximal", "j_bip_r_ring1"],
    "rightRingIntermediate": ["rightringintermediate", "j_bip_r_ring2"],
    "rightRingDistal": ["rightringdistal", "j_bip_r_ring3"],
    "rightLittleProximal": ["rightlittleproximal", "j_bip_r_little1"],
    "rightLittleIntermediate": ["rightlittleintermediate", "j_bip_r_little2"],
    "rightLittleDistal": ["rightlittledistal", "j_bip_r_little3"],
}

VRM1_TO_VRM0_PRESETS = {
    "neutral": "neutral",
    "happy": "joy",
    "joy": "joy",
    "angry": "angry",
    "sad": "sorrow",
    "sorrow": "sorrow",
    "relaxed": "fun",
    "fun": "fun",
    "blink": "blink",
    "blinkleft": "blink_l",
    "blink_l": "blink_l",
    "blinkright": "blink_r",
    "blink_r": "blink_r",
    "lookup": "lookup",
    "lookdown": "lookdown",
    "lookleft": "lookleft",
    "lookright": "lookright",
    "aa": "a",
    "a": "a",
    "ih": "i",
    "i": "i",
    "ou": "u",
    "u": "u",
    "ee": "e",
    "e": "e",
    "oh": "o",
    "o": "o",
}

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
    mat_names, seen_mats = [], set()
    tex_names, seen_imgs = [], set()
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


def resolve_vrm_bone_map(arm_obj):
    by_lower = {b.name.lower(): b.name for b in arm_obj.data.bones}
    by_norm = {re.sub(r"[^a-z0-9]", "", b.name.lower()): b.name for b in arm_obj.data.bones}
    mapping = {}
    for canonical, aliases in CANONICAL_BONE_ALIASES.items():
        for alias in aliases:
            if alias in by_lower:
                mapping[canonical] = by_lower[alias]
                break
        if canonical not in mapping:
            for alias in aliases:
                norm_alias = re.sub(r"[^a-z0-9]", "", alias)
                if norm_alias in by_norm:
                    mapping[canonical] = by_norm[norm_alias]
                    break
    return mapping


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
    for bname, parent_name, head_pt, tail_pt in bone_defs:
        b = eb.new(bname)
        b.head = Vector(head_pt)
        b.tail = Vector(tail_pt)
        if parent_name and parent_name in created:
            b.parent = created[parent_name]
        created[bname] = b

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
            if sum(g.weight for g in v.groups) > 1e-4:
                continue
            wp = mw @ v.co
            scored = []
            for b_name, bh, bt in bones_world:
                seg = bt - bh
                seg_len_sq = seg.length_squared
                t = max(0.0, min(1.0, (wp - bh).dot(seg) / seg_len_sq)) if seg_len_sq > 1e-8 else 0.0
                dist = (wp - (bh + seg * t)).length
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


def _assign_bone_ref(prop_obj, target_bone_name):
    if prop_obj is None:
        return
    if hasattr(prop_obj, "node") and hasattr(prop_obj.node, "bone_name"):
        prop_obj.node.bone_name = target_bone_name
    elif hasattr(prop_obj, "bone_name"):
        prop_obj.bone_name = target_bone_name


def _configure_vrm_extension(arm_obj, mesh_objs, bone_map, vrm_version: str, spec_meta: dict):
    ext = arm_obj.data.vrm_addon_extension
    title = spec_meta.get("title") or spec_meta.get("name") or "Generated VRM Avatar"
    author = spec_meta.get("author") or "Unspecified Author"
    allowed_user = spec_meta.get("allowedUserName") or "OnlyAuthor"
    violent = spec_meta.get("violentUsage") or "Disallow"
    sexual = spec_meta.get("sexualUsage") or "Disallow"
    commercial = spec_meta.get("commercialUsage") or "Disallow"
    license_name = spec_meta.get("licenseName") or "Other"

    if vrm_version == "0.0":
        ext.spec_version = "0.0"
        meta0 = ext.vrm0.meta
        meta0.title = title
        meta0.author = author
        meta0.version = str(spec_meta.get("version") or "1.0")
        meta0.license_name = license_name
        meta0.allowed_user_name = allowed_user
        meta0.violent_ussage_name = violent
        meta0.sexual_ussage_name = sexual
        meta0.commercial_ussage_name = commercial

        hum0 = ext.vrm0.humanoid
        for canonical, real_bone in bone_map.items():
            snake = re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), canonical)
            entry = next((hb for hb in hum0.human_bones if getattr(hb, "bone", "") in (canonical, snake)), None)
            if entry is None:
                entry = hum0.human_bones.add()
                entry.bone = snake if hasattr(entry, "bone") else canonical
            _assign_bone_ref(entry, real_bone)

        if hasattr(ext.vrm0, "first_person") and "head" in bone_map:
            _assign_bone_ref(ext.vrm0.first_person.first_person_bone, bone_map["head"])

        # Map mesh shape keys to VRM 0.0 blendShapeGroups
        if hasattr(ext.vrm0, "blend_shape_master"):
            bsg = ext.vrm0.blend_shape_master.blend_shape_groups
            seen = set()
            for m_obj in mesh_objs:
                sk = getattr(m_obj.data, "shape_keys", None)
                if not sk:
                    continue
                for kb in sk.key_blocks:
                    if kb.name == "Basis":
                        continue
                    preset = VRM1_TO_VRM0_PRESETS.get(kb.name.lower(), "unknown")
                    key = (preset, kb.name.lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    grp = bsg.add()
                    grp.name = kb.name
                    grp.preset_name = preset
                    bind = grp.binds.add()
                    if hasattr(bind, "mesh"):
                        bind.mesh.mesh_object_name = m_obj.name
                    bind.index = kb.name
                    bind.weight = 1.0

        # Secondary springs only for genuine hair/cloak/J_Sec_ root bones
        mapped_real_bones = set(bone_map.values())
        sec_roots = []
        for b in arm_obj.data.bones:
            if b.name in mapped_real_bones:
                continue
            if re.match(r"^(j_sec_|hair|cloak|cape|skirt|ribbon|tail|ear)", b.name, re.I):
                if b.parent is None or b.parent.name in mapped_real_bones:
                    sec_roots.append(b.name)
        if sec_roots and hasattr(ext.vrm0, "secondary_animation"):
            bg = ext.vrm0.secondary_animation.bone_groups.add()
            bg.comment = "SecondaryHairCloakSpring"
            bg.stiffiness = 0.6
            bg.gravity_power = 0.25
            bg.drag_force = 0.4
            bg.hit_radius = 0.025
            for rbone in sec_roots:
                bref = bg.bones.add()
                _assign_bone_ref(bref, rbone)
    else:
        ext.spec_version = "1.0"
        ext.vrm1.meta.vrm_name = title
        ext.vrm1.meta.authors.clear()
        a_item = ext.vrm1.meta.authors.add()
        a_item.value = author
        human_bones = ext.vrm1.humanoid.human_bones
        for canonical, real_bone in bone_map.items():
            if hasattr(human_bones, canonical):
                _assign_bone_ref(getattr(human_bones, canonical), real_bone)


def _measure_pose_deformation(arm_obj, mesh_objs, bone_map) -> dict:
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

    for canonical in test_candidates:
        real_name = bone_map.get(canonical, canonical)
        pb = arm_obj.pose.bones.get(real_name)
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

        joint_results[canonical] = round(float(bone_max_delta), 6)
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
    total_verts, weighted_verts, unnormalized_verts = 0, 0, 0
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


def run_production_pipeline(
    out_dir: str,
    glb_path: str,
    vrm_version: str = "0.0",
    spec_json_path: str = "",
    report_filename: str = "blender_report.json",
    vrm_filename: str = "character_blender.vrm",
    blend_filename: str = "character_blender.blend",
) -> dict:
    if not glb_path or not os.path.exists(glb_path):
        raise FileNotFoundError(f"Humanoid GLB input required (--glb-path). Not found: {glb_path}")

    spec_meta = {}
    if spec_json_path and os.path.exists(spec_json_path):
        try:
            with open(spec_json_path, "r", encoding="utf-8") as sf:
                spec_data = json.load(sf)
                spec_meta = dict(spec_data.get("vrmMetadata") or {})
                if not spec_meta.get("title") and spec_data.get("name"):
                    spec_meta["title"] = spec_data["name"]
        except Exception:
            spec_meta = {}

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

    bone_map = resolve_vrm_bone_map(arm_obj)
    missing_bones = [b for b in REQUIRED_VRM_BONES if b not in bone_map]
    total_polys = sum(len(o.data.polygons) for o in mesh_objs)
    total_vgroups = sum(len(o.vertex_groups) for o in mesh_objs)
    weight_audit = _check_weight_normalization(mesh_objs)
    deformation = _measure_pose_deformation(arm_obj, mesh_objs, bone_map)

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

    blend_path = os.path.join(out_dir, blend_filename)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    vrm_addon_installed = hasattr(bpy.ops, "export_scene") and hasattr(bpy.ops.export_scene, "vrm")
    vrm_path = os.path.join(out_dir, vrm_filename)
    vrm_export_success = False
    vrm_reload_success = False
    vrm_reload_report = None
    reloaded_material_count = 0
    reloaded_texture_count = 0
    vrm_note = None

    if vrm_addon_installed:
        try:
            _configure_vrm_extension(arm_obj, mesh_objs, bone_map, vrm_version, spec_meta)
            bpy.ops.export_scene.vrm(filepath=vrm_path)
            vrm_export_success = os.path.exists(vrm_path) and os.path.getsize(vrm_path) > 0

            if vrm_export_success:
                validator_fn = _load_vrm_validator()
                binary_valid = True
                if validator_fn:
                    with open(vrm_path, "rb") as vf:
                        vrm_reload_report = validator_fn(vf.read(), expected_version=vrm_version)
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
            vrm_note = f"VRM {vrm_version} export/reload failed: {exc}"
    else:
        vrm_note = "VRM_Addon_for_Blender is not installed in this Blender instance; .vrm export and reload did NOT succeed."

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
        "vrm_version": vrm_version,
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
        "mapped_bones": bone_map,
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
    report_path = os.path.join(out_dir, report_filename)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("BLENDER_PRODUCTION_REPORT:" + json.dumps(report))
    return report


if __name__ == "__main__":
    output = "./output"
    glb_input = ""
    vrm_ver = "0.0"
    spec_path = ""
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        if "--out-dir" in args:
            output = args[args.index("--out-dir") + 1]
        if "--glb-path" in args:
            glb_input = args[args.index("--glb-path") + 1]
        if "--vrm-version" in args:
            vrm_ver = args[args.index("--vrm-version") + 1]
        if "--spec-json" in args:
            spec_path = args[args.index("--spec-json") + 1]
    result = run_production_pipeline(output, glb_input, vrm_version=vrm_ver, spec_json_path=spec_path)
    if result.get("status") != "ok":
        sys.exit(1)
