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

import hashlib
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

VRM0_HUMANOID_BONES = {
    "hips", "spine", "chest", "upperChest", "neck", "head", "leftEye", "rightEye", "jaw",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
    "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
    "leftThumbProximal", "leftThumbIntermediate", "leftThumbDistal",
    "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
    "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
    "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
    "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
    "rightThumbProximal", "rightThumbIntermediate", "rightThumbDistal",
    "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
    "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
    "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
    "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal",
}

VRM1_TO_VRM0_BONES = {
    "leftThumbMetacarpal": "leftThumbProximal",
    "leftThumbProximal": "leftThumbIntermediate",
    "rightThumbMetacarpal": "rightThumbProximal",
    "rightThumbProximal": "rightThumbIntermediate",
}

VRM0_BLEND_SHAPE_PRESETS = {
    "unknown", "neutral", "a", "i", "u", "e", "o", "blink",
    "joy", "angry", "sorrow", "fun",
    "lookup", "lookdown", "lookleft", "lookright",
    "blink_l", "blink_r",
}

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
    "surprised": "unknown",
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


# Resolved metadata (spec.json "vrmMetadata", written by resolveEffectiveVrmMetadata) is applied VERBATIM:
# no field-level defaults ('Other', 'OnlyAuthor', author names) are applied here. A missing key is left
# at the add-on's own default and reported in meta_missing_fields. Source/sample licence data is never
# hard-coded in this script.
VRM0_META_FIELDS = [
    ("title", "title"), ("author", "author"), ("version", "version"),
    ("contactInformation", "contact_information"), ("reference", "reference"),
    ("otherLicenseUrl", "other_license_url"), ("otherPermissionUrl", "other_permission_url"),
    ("licenseName", "license_name"), ("allowedUserName", "allowed_user_name"),
    ("violentUsage", "violent_ussage_name"), ("sexualUsage", "sexual_ussage_name"),
    ("commercialUsage", "commercial_ussage_name"),
]


def _meta_apply(ext, vrm_version, spec_meta, info):
    def setp(obj, attr, key, value):
        try:
            setattr(obj, attr, value)
        except Exception as exc:
            info["meta_apply_errors"].append(f"{key}: {exc}")

    if vrm_version == "0.0":
        meta0 = ext.vrm0.meta
        for key, attr in VRM0_META_FIELDS:
            if key not in spec_meta or spec_meta[key] is None:
                info["meta_missing_fields"].append(key)
                continue
            if hasattr(meta0, attr):
                setp(meta0, attr, key, str(spec_meta[key]))
        return

    meta1 = ext.vrm1.meta
    ext.spec_version = "1.0"

    def has(key):
        if key not in spec_meta or spec_meta[key] is None:
            info["meta_missing_fields"].append(key)
            return False
        return True

    if has("title"):
        setp(meta1, "vrm_name", "title", str(spec_meta["title"]))
    if has("version"):
        setp(meta1, "version", "version", str(spec_meta["version"]))
    if has("author"):
        meta1.authors.clear()
        meta1.authors.add().value = str(spec_meta["author"])
    if has("sourceAttribution"):
        setp(meta1, "copyright_information", "sourceAttribution", str(spec_meta["sourceAttribution"]))
    if has("contactInformation"):
        setp(meta1, "contact_information", "contactInformation", str(spec_meta["contactInformation"]))
    if spec_meta.get("reference"):
        meta1.references.clear()
        meta1.references.add().value = str(spec_meta["reference"])
    if has("otherLicenseUrl") and spec_meta["otherLicenseUrl"]:
        setp(meta1, "other_license_url", "otherLicenseUrl", str(spec_meta["otherLicenseUrl"]))
    if has("allowedUserName"):
        setp(meta1, "avatar_permission", "allowedUserName", {
            "Everyone": "everyone", "ExplicitlyLicensedPerson": "onlySeparatelyLicensedPerson",
        }.get(spec_meta["allowedUserName"], "onlyAuthor"))
    if has("violentUsage"):
        setp(meta1, "allow_excessively_violent_usage", "violentUsage", spec_meta["violentUsage"] == "Allow")
    if has("sexualUsage"):
        setp(meta1, "allow_excessively_sexual_usage", "sexualUsage", spec_meta["sexualUsage"] == "Allow")
    if has("commercialUsage"):
        setp(meta1, "commercial_usage", "commercialUsage",
             "corporation" if spec_meta["commercialUsage"] == "Allow" else "personalNonProfit")
    if has("allowRedistribution"):
        setp(meta1, "allow_redistribution", "allowRedistribution", bool(spec_meta["allowRedistribution"]))
    if has("modification"):
        setp(meta1, "modification", "modification", spec_meta["modification"])
    if spec_meta.get("otherPermissionUrl"):
        info["meta_apply_errors"].append("VRM 1.0 has no field for otherPermissionUrl (dropped)")


def _vec_blender_from_vrm0(v):
    """VRM 0.0 -> add-on gravity_dir axes (the add-on exporter writes y=gd[2], z=gd[1])."""
    return (float(v[0]), float(v[2]), float(v[1]))


def _create_collider_empty(arm_obj, bone_name, col_def, name):
    """Create the sphere empty the add-on exports as a collider (it reads bpy_object, not offset/radius)."""
    from mathutils import Matrix, Vector
    off = col_def.get("offset", [0.0, 0.0, 0.0])
    # add-on exporter writes vrm = (-x, z, -y) of (world_pos - bone_head); invert that here
    delta = Vector((-float(off[0]), -float(off[2]), float(off[1])))
    pbone = arm_obj.pose.bones[bone_name]
    head_world = (arm_obj.matrix_world @ pbone.matrix).to_translation()
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = max(0.0, float(col_def.get("radius", 0.0)))
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = arm_obj
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = Matrix.Translation(head_world + delta)
    return obj


def _export_springs_vrm0(arm_obj, ext, bone_map, blender_context, info):
    import uuid as _uuid
    sec_anim = ext.vrm0.secondary_animation
    mapped_real_bones = set(bone_map.values())
    arm_bone_names = {b.name for b in arm_obj.data.bones}
    preserved_cgs = blender_context.get("preservedVrmColliderGroups") or []
    preserved_sgs = blender_context.get("preservedVrmSprings") or []
    info.update({
        "colliders_skipped": [], "collider_groups_created": 0, "colliders_created": 0,
        "springs_created": 0, "springs_skipped": [], "spring_warnings": [],
    })

    src_index_to_uuid = {}
    for src_i, cg_def in enumerate(preserved_cgs):
        node_name = cg_def.get("nodeName")
        if not node_name or node_name not in arm_bone_names:
            info["colliders_skipped"].append({
                "source_index": src_i, "nodeName": node_name,
                "reason": "node name is not a bone of the exported armature",
                "collider_count": len(cg_def.get("colliders", [])),
            })
            continue
        cg = sec_anim.collider_groups.add()
        cg.uuid = str(_uuid.uuid4())
        _assign_bone_ref(cg, node_name)
        src_index_to_uuid[src_i] = cg.uuid
        info["collider_groups_created"] += 1
        for ci, col_def in enumerate(cg_def.get("colliders", [])):
            col = cg.colliders.add()
            col.bpy_object = _create_collider_empty(arm_obj, node_name, col_def, f"vrm_collider_{src_i}_{ci}")
            info["colliders_created"] += 1

    def make_group(sg_def, root_bones, comment):
        bg = sec_anim.bone_groups.add()
        bg.comment = comment
        bg.stiffiness = max(0.0, float(sg_def.get("stiffiness", 0.6)))
        bg.gravity_power = float(sg_def.get("gravityPower", 0.25))
        gd = sg_def.get("gravityDir")
        if gd is not None:
            bg.gravity_dir = _vec_blender_from_vrm0(gd)
        bg.drag_force = max(0.0, float(sg_def.get("dragForce", 0.4)))
        bg.hit_radius = max(0.0, float(sg_def.get("hitRadius", 0.025)))
        for rbone in root_bones:
            _assign_bone_ref(bg.bones.add(), rbone)
        return bg

    if preserved_sgs:
        for si, sg_def in enumerate(preserved_sgs):
            root_bones = []
            for bn in sg_def.get("boneNames", []):
                if bn not in arm_bone_names:
                    info["spring_warnings"].append(f"spring {si}: bone '{bn}' not in armature")
                elif bn in mapped_real_bones:
                    info["spring_warnings"].append(f"spring {si}: bone '{bn}' is a humanoid bone, excluded")
                else:
                    root_bones.append(bn)
            if not root_bones:
                info["springs_skipped"].append({"index": si, "comment": sg_def.get("comment"), "reason": "no usable root bones"})
                continue
            bg = make_group(sg_def, root_bones, str(sg_def.get("comment") or "PreservedSpring"))
            center = sg_def.get("centerNodeName")
            if center:
                if center in arm_bone_names:
                    _assign_bone_ref(bg.center, center)
                else:
                    info["spring_warnings"].append(f"spring {si}: center '{center}' not in armature, center dropped")
            if sg_def.get("colliderGroupIndices") is not None:
                wanted = list(sg_def.get("colliderGroupIndices") or [])
            else:
                names = sg_def.get("colliderGroupNodeNames") or []
                wanted = [i for i, c in enumerate(preserved_cgs) if c.get("nodeName") in names]
            for ci in wanted:
                u = src_index_to_uuid.get(ci)
                if u is None:
                    info["spring_warnings"].append(f"spring {si}: collider group {ci} was not exported (unresolved node)")
                    continue
                bg.collider_groups.add().collider_group_uuid = u
            info["springs_created"] += 1
    else:
        sec_roots = []
        for b in arm_obj.data.bones:
            if b.name in mapped_real_bones:
                continue
            if re.match(r"^(j_sec_|hair|cloak|cape|skirt|ribbon|tail|ear)", b.name, re.I):
                if b.parent is None or b.parent.name in mapped_real_bones:
                    sec_roots.append(b.name)
        if sec_roots:
            make_group({"gravityDir": [0.0, -1.0, 0.0]}, sec_roots, "SecondaryHairCloakSpring")
            info["springs_created"] += 1


VRM1_PRESET_ATTR = {
    "happy": "happy", "joy": "happy", "angry": "angry", "sad": "sad", "sorrow": "sad",
    "relaxed": "relaxed", "fun": "relaxed", "surprised": "surprised", "neutral": "neutral",
    "aa": "aa", "a": "aa", "ih": "ih", "i": "ih", "ou": "ou", "u": "ou", "ee": "ee", "e": "ee",
    "oh": "oh", "o": "oh", "blink": "blink", "blinkleft": "blink_left", "blink_l": "blink_left",
    "blinkright": "blink_right", "blink_r": "blink_right", "lookup": "look_up",
    "lookdown": "look_down", "lookleft": "look_left", "lookright": "look_right",
}


def _shape_key_has_delta(kb, eps=1e-7):
    basis = kb.relative_key
    try:
        for a, b in zip(kb.data, basis.data):
            if abs(a.co.x - b.co.x) > eps or abs(a.co.y - b.co.y) > eps or abs(a.co.z - b.co.z) > eps:
                return True
    except Exception:
        return False
    return False


def _bind_vrm1_expressions(ext, mesh_objs, info):
    """Populate ext.vrm1.expressions.preset.<name>.morph_target_binds from shape keys.

    Binds every mesh that carries the key with a non-zero delta; all-zero keys are skipped (the validators
    treat those as empty). Add-on API: expression.morph_target_binds.add() -> .node.mesh_object_name, .index
    (shape key name), .weight (0..1).
    """
    preset = ext.vrm1.expressions.preset
    bound, skipped = {}, []
    for m_obj in mesh_objs:
        sk = getattr(m_obj.data, "shape_keys", None)
        if not sk:
            continue
        for kb in sk.key_blocks:
            if kb.name == sk.reference_key.name:
                continue
            attr = VRM1_PRESET_ATTR.get(kb.name.lower())
            if attr is None:
                skipped.append({"mesh": m_obj.name, "key": kb.name, "reason": "not a VRM 1.0 preset name"})
                continue
            if not _shape_key_has_delta(kb):
                skipped.append({"mesh": m_obj.name, "key": kb.name, "reason": "all-zero delta on this mesh"})
                continue
            expr = getattr(preset, attr, None)
            if expr is None:
                skipped.append({"mesh": m_obj.name, "key": kb.name, "reason": f"add-on has no preset '{attr}'"})
                continue
            bind = expr.morph_target_binds.add()
            bind.node.mesh_object_name = m_obj.name
            bind.index = kb.name
            bind.weight = 1.0
            bound.setdefault(attr, []).append(m_obj.name)
    info["vrm1_expressions_bound"] = bound
    info["vrm1_expressions_skipped"] = skipped
    if not bound:
        info["vrm1_expressions_warning"] = "no shape key produced a non-empty VRM 1.0 expression"


def _gravity_vrm0_to_addon_vrm1(gd):
    """VRM 0.0 gravityDir -> add-on spring_bone1 joint.gravity_dir property.

    0.0 -> 1.0 negates x and z (0.0 faces -Z); the add-on exporter writes (p0, p2, -p1),
    so the property is p = (x1, -z1, y1).
    """
    x1, y1, z1 = -float(gd[0]), float(gd[1]), -float(gd[2])
    return (x1, -z1, y1)


def _spring_chain(arm_obj, root, mapped_real_bones, explicit=None):
    if explicit:
        names = [n for n in explicit if n in arm_obj.data.bones and n not in mapped_real_bones]
        if names:
            return names
    out = []
    queue = [arm_obj.data.bones[root]]
    while queue:
        b = queue.pop(0)
        if b.name in mapped_real_bones:
            continue
        out.append(b.name)
        queue.extend(b.children)
    return out


def _export_springs_vrm1(arm_obj, ext, bone_map, blender_context, info):
    """Source VRM 0.0 springs/colliders -> VRMC_springBone via ext.spring_bone1 (sphere colliders only)."""
    import uuid as _uuid
    sb = ext.spring_bone1
    mapped_real_bones = set(bone_map.values())
    arm_bone_names = {b.name for b in arm_obj.data.bones}
    cgs = blender_context.get("preservedVrmColliderGroups") or []
    sgs = blender_context.get("preservedVrmSprings") or []
    info.update({
        "colliders_skipped": [], "collider_groups_created": 0, "colliders_created": 0,
        "springs_created": 0, "springs_skipped": [], "spring_warnings": [], "joints_created": 0,
    })
    src_to_group_uuid = {}
    for src_i, cg_def in enumerate(cgs):
        node_name = cg_def.get("nodeName")
        if not node_name or node_name not in arm_bone_names:
            info["colliders_skipped"].append({
                "source_index": src_i, "nodeName": node_name,
                "reason": "node name is not a bone of the exported armature",
                "collider_count": len(cg_def.get("colliders", [])),
            })
            continue
        group = sb.collider_groups.add()
        group.uuid = _uuid.uuid4().hex
        group.vrm_name = f"ColliderGroup{src_i}_{node_name}"
        for ci, col_def in enumerate(cg_def.get("colliders", [])):
            col = sb.colliders.add()
            col.uuid = _uuid.uuid4().hex
            col.node.bone_name = node_name
            col.shape_type = col.SHAPE_TYPE_SPHERE.identifier
            col.bpy_object = _create_collider_empty(arm_obj, node_name, col_def, f"vrm1_collider_{src_i}_{ci}")
            group.colliders.add().collider_uuid = col.uuid
            info["colliders_created"] += 1
        src_to_group_uuid[src_i] = group.uuid
        info["collider_groups_created"] += 1

    if not sgs:
        sec_roots = [
            b.name for b in arm_obj.data.bones
            if b.name not in mapped_real_bones
            and re.match(r"^(j_sec_|hair|cloak|cape|skirt|ribbon|tail|ear)", b.name, re.I)
            and (b.parent is None or b.parent.name in mapped_real_bones)
        ]
        if sec_roots:
            sgs = [{"comment": "SecondaryHairCloakSpring", "gravityDir": [0.0, -1.0, 0.0], "boneNames": sec_roots}]

    for si, sg in enumerate(sgs):
        roots = []
        for bn in sg.get("boneNames", []):
            if bn not in arm_bone_names:
                info["spring_warnings"].append(f"spring {si}: bone '{bn}' not in armature")
            elif bn in mapped_real_bones:
                info["spring_warnings"].append(f"spring {si}: bone '{bn}' is a humanoid bone, excluded")
            else:
                roots.append(bn)
        if not roots:
            info["springs_skipped"].append({"index": si, "comment": sg.get("comment"), "reason": "no usable root bones"})
            continue
        gd = _gravity_vrm0_to_addon_vrm1(sg.get("gravityDir") or [0.0, -1.0, 0.0])
        # One VRM spring per root so every joint chain stays linear (branches would be ambiguous).
        for ri, root in enumerate(roots):
            spring = sb.springs.add()
            base = str(sg.get("comment") or "PreservedSpring")
            spring.vrm_name = base if len(roots) == 1 else f"{base}.{ri}"
            explicit = sg.get("chainBoneNames") if len(roots) == 1 else None
            for bn in _spring_chain(arm_obj, root, mapped_real_bones, explicit):
                j = spring.joints.add()
                j.node.bone_name = bn
                j.hit_radius = max(0.0, float(sg.get("hitRadius", 0.025)))
                j.stiffness = max(0.0, float(sg.get("stiffiness", 0.6)))
                j.gravity_power = max(0.0, float(sg.get("gravityPower", 0.25)))
                j.gravity_dir = gd
                j.drag_force = max(0.0, float(sg.get("dragForce", 0.4)))
                info["joints_created"] += 1
            center = sg.get("centerNodeName")
            if center:
                if center in arm_bone_names:
                    spring.center.bone_name = center
                else:
                    info["spring_warnings"].append(f"spring {si}: center '{center}' not in armature, center dropped")
            if sg.get("colliderGroupIndices") is not None:
                wanted = list(sg.get("colliderGroupIndices") or [])
            else:
                names = sg.get("colliderGroupNodeNames") or []
                wanted = [i for i, c in enumerate(cgs) if c.get("nodeName") in names]
            for ci in wanted:
                u = src_to_group_uuid.get(ci)
                if u is None:
                    info["spring_warnings"].append(f"spring {si}: collider group {ci} was not exported (unresolved node)")
                    continue
                spring.collider_groups.add().collider_group_uuid = u
            info["springs_created"] += 1
    info["spring_warnings"].append(
        "VRM 1.0: one spring per root bone (descendants as joints); the add-on drops a center that is not an "
        "ancestor of the first joint; only sphere colliders are produced"
    )


def _configure_vrm_extension(
    arm_obj,
    mesh_objs,
    bone_map,
    vrm_version: str,
    spec_meta: dict,
    blender_context: dict = None,
):
    ext = arm_obj.data.vrm_addon_extension
    blender_context = blender_context or {}
    export_info = {"meta_missing_fields": [], "meta_apply_errors": []}
    _meta_apply(ext, vrm_version, spec_meta, export_info)

    if vrm_version == "0.0":
        ext.spec_version = "0.0"
        hum0 = ext.vrm0.humanoid
        seen_vrm0_bones = set()
        seen_real_bones = set()
        for canonical, real_bone in bone_map.items():
            vrm0_bone = VRM1_TO_VRM0_BONES.get(canonical, canonical)
            if vrm0_bone not in VRM0_HUMANOID_BONES:
                continue
            if vrm0_bone in seen_vrm0_bones or real_bone in seen_real_bones:
                continue
            seen_vrm0_bones.add(vrm0_bone)
            seen_real_bones.add(real_bone)
            entry = next((hb for hb in hum0.human_bones if getattr(hb, "bone", "") == vrm0_bone), None)
            if entry is None:
                entry = hum0.human_bones.add()
                if hasattr(entry, "bone"):
                    entry.bone = vrm0_bone
            _assign_bone_ref(entry, real_bone)

        if hasattr(ext.vrm0, "first_person") and "head" in bone_map:
            _assign_bone_ref(ext.vrm0.first_person.first_person_bone, bone_map["head"])

        # Map mesh shape keys to VRM 0.0 blendShapeGroups using official lowercase enums & 0..100 weights
        if hasattr(ext.vrm0, "blend_shape_master"):
            bsg = ext.vrm0.blend_shape_master.blend_shape_groups
            # One group per (preset, key name) with a bind on EVERY mesh that carries that key. Binding only
            # the first mesh found (bpy.data.objects is name-sorted, so e.g. EyesMesh precedes FaceAndBodyMesh)
            # attached expressions to a mesh where the key is all-zero and failed validation.
            groups = {}
            for m_obj in mesh_objs:
                sk = getattr(m_obj.data, "shape_keys", None)
                if not sk:
                    continue
                for kb in sk.key_blocks:
                    if kb.name == "Basis":
                        continue
                    preset = VRM1_TO_VRM0_PRESETS.get(kb.name.lower(), "unknown")
                    if preset not in VRM0_BLEND_SHAPE_PRESETS:
                        preset = "unknown"
                    key = (preset, kb.name.lower())
                    entry = groups.setdefault(key, (kb.name, preset, []))
                    entry[2].append(m_obj.name)
            for _key, (kb_name, preset, mesh_names) in groups.items():
                grp = bsg.add()
                grp.name = kb_name
                grp.preset_name = preset
                for mesh_name in mesh_names:
                    bind = grp.binds.add()
                    if hasattr(bind, "mesh"):
                        bind.mesh.mesh_object_name = mesh_name
                    bind.index = kb_name
                    bind.weight = 100

        # Secondary springs & colliders: preserve source physics (reported, never silently skipped)
        if hasattr(ext.vrm0, "secondary_animation"):
            _export_springs_vrm0(arm_obj, ext, bone_map, blender_context, export_info)
    else:
        _bind_vrm1_expressions(ext, mesh_objs, export_info)
        human_bones = ext.vrm1.humanoid.human_bones
        unassigned = []
        for canonical, real_bone in bone_map.items():
            # The add-on's VRM 1.0 human bone properties are snake_case (left_upper_leg), not camelCase.
            attr = re.sub(r"(?<!^)(?=[A-Z])", "_", canonical).lower()
            if hasattr(human_bones, attr):
                _assign_bone_ref(getattr(human_bones, attr), real_bone)
            else:
                unassigned.append(canonical)
        if unassigned:
            export_info["vrm1_unassigned_bones"] = unassigned
        _export_springs_vrm1(arm_obj, ext, bone_map, blender_context, export_info)
    return export_info


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


VRM_EXTENSION_PROPERTY = "vrm_addon_extension"


def _vrm_extension_registered():
    """True/False when the VRM add-on's Armature property is (not) registered; None if undeterminable.

    hasattr(bpy.ops.export_scene, "vrm") is NOT a valid test: bpy.ops resolves any attribute
    lazily, so it is True even when the add-on is disabled or was unregistered by a factory reset.
    """
    types_mod = getattr(bpy, "types", None)
    armature_type = getattr(types_mod, "Armature", None) if types_mod is not None else None
    if armature_type is None or not hasattr(armature_type, "bl_rna"):
        return None
    try:
        return VRM_EXTENSION_PROPERTY in armature_type.bl_rna.properties
    except Exception:
        return None


def _enabled_addon_names():
    try:
        return [str(k) for k in bpy.context.preferences.addons.keys()]
    except Exception:
        return []


def ensure_vrm_addon(preferred_names=()):
    """Make sure the VRM add-on is registered; re-enable it if a factory reset removed it.

    Returns (registered, detail). Enabling uses default_set=True so the add-on gets a preferences entry (the VRM exporter asserts
    "No add-on preferences" without it); persistent=False and --background mean nothing is written to the
    user's saved preferences. Add-on preference values return to defaults after read_factory_settings.
    """
    state = _vrm_extension_registered()
    if state is None:
        return True, "bpy.types unavailable; add-on registration not verifiable here"
    if state:
        return True, "registered"
    try:
        import addon_utils
    except Exception as exc:  # pragma: no cover - only outside Blender
        return False, f"addon_utils unavailable: {exc}"
    names = [n for n in preferred_names if "vrm" in n.lower()]
    try:
        for mod in addon_utils.modules():
            n = getattr(mod, "__name__", "")
            if "vrm" in n.lower() and n not in names:
                names.append(n)
    except Exception:
        pass
    errors = []
    for name in names:
        try:
            addon_utils.enable(name, default_set=True, persistent=False)
        except Exception as exc:
            errors.append(f"{name}: {exc}")
        if _vrm_extension_registered():
            return True, f"enabled {name}"
    if not names:
        detail = "VRM add-on not found among installed add-ons"
    else:
        detail = "could not register VRM add-on (" + "; ".join(errors or ["no error reported"]) + ")"
    return False, detail


def _reset_scene(addon_names=()):
    """Factory reset to an empty scene, then restore the VRM add-on that the reset unregisters."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return ensure_vrm_addon(addon_names)


def _pick_armature(arm_objs, mesh_objs):
    """Choose the deforming armature: most bound meshes, then most matched vertex groups, then most bones."""
    def score(arm):
        bound = 0
        matched = 0
        bone_names = {b.name for b in arm.data.bones}
        for m in mesh_objs:
            mods = [
                md for md in getattr(m, "modifiers", [])
                if getattr(md, "type", "") == "ARMATURE" and getattr(md, "object", None) is arm
            ]
            parented = getattr(m, "parent", None) is arm
            if mods or parented:
                bound += 1
            try:
                matched += sum(1 for vg in getattr(m, "vertex_groups", []) if vg.name in bone_names)
            except Exception:
                pass
        return (bound, matched, len(arm.data.bones))
    scored = [(score(a), a) for a in arm_objs]
    best = max(scored, key=lambda t: t[0])[1]
    info = [
        {"name": a.name, "bound_meshes": sc[0], "matched_vertex_groups": sc[1], "bone_count": sc[2]}
        for sc, a in scored
    ]
    return best, info


def _run_production_pipeline_impl(
    stage: dict,
    out_dir: str,
    glb_path: str,
    vrm_version: str = "0.0",
    spec_json_path: str = "",
    report_filename: str = "blender_report.json",
    vrm_filename: str = "character_blender.vrm",
    blend_filename: str = "character_blender.blend",
    run_id: str = "",
) -> dict:
    if not glb_path or not os.path.exists(glb_path):
        raise FileNotFoundError(f"Humanoid GLB input required (--glb-path). Not found: {glb_path}")

    spec_meta = {}
    blender_context = {}
    input_notes = []
    if not spec_json_path:
        input_notes.append("no --spec-json: VRM meta left at add-on defaults (no licence data supplied)")
    elif not os.path.exists(spec_json_path):
        input_notes.append(f"--spec-json not found: {spec_json_path}")
    if spec_json_path and os.path.exists(spec_json_path):
        try:
            with open(spec_json_path, "r", encoding="utf-8") as sf:
                spec_data = json.load(sf)
                # Used verbatim: spec.json vrmMetadata is the resolved metadata (see the VRM metadata
                # contract in src/shared/types.ts). No field-level defaults are added here.
                spec_meta = dict(spec_data.get("vrmMetadata") or {})
        except Exception as exc:
            spec_meta = {}
            input_notes.append(f"spec.json unreadable ({exc}); VRM meta left at add-on defaults")
        ctx_path = Path(spec_json_path).with_name("blender_context.json")
        if ctx_path.exists():
            try:
                with open(ctx_path, "r", encoding="utf-8") as cf:
                    blender_context = json.load(cf)
            except Exception as exc:
                blender_context = {}
                input_notes.append(f"blender_context.json unreadable ({exc}); springs/colliders not preserved")

    os.makedirs(out_dir, exist_ok=True)
    prior_addons = _enabled_addon_names()
    stage["name"] = "import"
    _reset_scene(prior_addons)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if not mesh_objs:
        raise RuntimeError(f"Imported GLB did not contain any MESH objects: {glb_path}")

    input_materials, input_textures = _collect_materials_and_images(mesh_objs)
    arm_objs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    unrigged_auto_rigged = False
    armature_candidates = []
    if not arm_objs:
        arm_obj = _create_fitted_humanoid_armature(mesh_objs)
        unrigged_auto_rigged = True
    else:
        arm_obj, armature_candidates = _pick_armature(arm_objs, mesh_objs)

    # Cache everything derived from arm_obj now: the reload below replaces all Blender data
    # and leaves arm_obj as a dangling reference.
    armature_name = arm_obj.name
    bone_count = len(arm_obj.data.bones)
    stage["name"] = "rig"
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

    stage["name"] = "save_blend"
    blend_path = os.path.join(out_dir, blend_filename)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    stage["name"] = "export"
    vrm_addon_installed, addon_detail = ensure_vrm_addon(prior_addons)
    vrm_addon_installed = bool(vrm_addon_installed and hasattr(arm_obj.data, VRM_EXTENSION_PROPERTY))
    vrm_path = os.path.join(out_dir, vrm_filename)
    vrm_export_success = False
    vrm_reload_success = False
    vrm_reload_report = None
    reloaded_material_count = 0
    reloaded_texture_count = 0
    output_vrm_sha256 = None
    output_vrm_size = 0
    python_validator_available = False
    vrm_note = None
    export_info = {}

    if vrm_addon_installed:
        try:
            export_info = _configure_vrm_extension(arm_obj, mesh_objs, bone_map, vrm_version, spec_meta, blender_context) or {}
            export_result = bpy.ops.export_scene.vrm(filepath=vrm_path)
            vrm_export_success = os.path.exists(vrm_path) and os.path.getsize(vrm_path) > 0
            if not vrm_export_success:
                # The add-on can CANCEL without raising (e.g. its own validator errors); never leave this silent.
                vrm_note = f"VRM {vrm_version} export produced no file (bpy.ops result: {sorted(export_result) if export_result else export_result}); see Blender stderr/validator output."

            if vrm_export_success:
                with open(vrm_path, "rb") as vf:
                    vrm_bytes = vf.read()
                output_vrm_size = len(vrm_bytes)
                output_vrm_sha256 = hashlib.sha256(vrm_bytes).hexdigest()

                validator_fn = _load_vrm_validator()
                if validator_fn is None:
                    binary_valid = False
                    python_validator_available = False
                    vrm_note = "Independent Python vrm_validator module is unavailable; binary conformance cannot be verified."
                else:
                    python_validator_available = True
                    vrm_reload_report = validator_fn(vrm_bytes, expected_version=vrm_version)
                    binary_valid = bool(vrm_reload_report.get("valid"))
                    nonempty = vrm_reload_report.get("non_empty_expression_count")
                    if binary_valid and nonempty == 0:
                        binary_valid = False
                        vrm_note = (
                            f"Exported VRM {vrm_version} has {vrm_reload_report.get('expression_count')} expressions but "
                            "ZERO non-empty ones (no morph target binds with non-zero deltas); export rejected."
                        )
                    if not binary_valid and not vrm_note:
                        errs = vrm_reload_report.get("errors") or []
                        vrm_note = f"Independent VRM {vrm_version} validator failed: {'; '.join(errs) or vrm_reload_report.get('error', 'schema violation')}"

                stage["name"] = "reload"
                reload_addon_ok, reload_addon_detail = _reset_scene(prior_addons)
                if not reload_addon_ok:
                    raise RuntimeError(f"VRM add-on could not be re-enabled after reset: {reload_addon_detail}")
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
        vrm_note = f"VRM_Addon_for_Blender is not registered in this Blender instance ({addon_detail}); .vrm export and reload did NOT succeed."

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
        "run_id": run_id,
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
        "python_validator_available": python_validator_available,
        "output_vrm_sha256": output_vrm_sha256,
        "output_vrm_size": output_vrm_size,
        "input_materials": input_materials,
        "input_textures": input_textures,
        "reloaded_material_count": reloaded_material_count,
        "reloaded_texture_count": reloaded_texture_count,
        "mesh_count": len(mesh_objs),
        "vertex_count": weight_audit["total_vertices"],
        "polygon_count": total_polys,
        "bone_count": bone_count,
        "armature_name": armature_name,
        "armature_candidates": armature_candidates,
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
        "vrm_addon_detail": addon_detail,
        "vrm_exported": vrm_export_success,
        "vrm_path": vrm_path if vrm_export_success else None,
        "vrm_reload_valid": vrm_reload_success,
        "vrm_reload_report": vrm_reload_report,
        "vrm_note": vrm_note,
        "export_info": export_info,
        "input_notes": input_notes,
        "meta_applied_from_spec": {k: spec_meta.get(k) for k in sorted(spec_meta) if k != "sourceRestrictions"},
    }
    report_path = os.path.join(out_dir, report_filename)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("BLENDER_PRODUCTION_REPORT:" + json.dumps(report))
    return report


def run_production_pipeline(
    out_dir: str,
    glb_path: str,
    vrm_version: str = "0.0",
    spec_json_path: str = "",
    report_filename: str = "blender_report.json",
    vrm_filename: str = "character_blender.vrm",
    blend_filename: str = "character_blender.blend",
    run_id: str = "",
) -> dict:
    """Run the pipeline; on any failure still write a status=fail report (never exit silently)."""
    stage = {"name": "start"}
    try:
        return _run_production_pipeline_impl(
            stage, out_dir, glb_path, vrm_version, spec_json_path,
            report_filename, vrm_filename, blend_filename, run_id,
        )
    except Exception as exc:
        import traceback
        message = f"Pipeline failed during stage '{stage['name']}': {type(exc).__name__}: {exc}"
        try:
            version_string = bpy.app.version_string
        except Exception:
            version_string = None
        report = {
            "status": "fail",
            "run_id": run_id,
            "vrm_version": vrm_version,
            "source_glb": glb_path,
            "blender_version": version_string,
            "failed_stage": stage["name"],
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "vrm_export_success": False,
            "vrm_reload_success": False,
            "python_validator_available": False,
            "vrm_path": None,
            "vrm_note": message,
        }
        try:
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, report_filename), "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
        except Exception as write_exc:
            report["report_write_error"] = str(write_exc)
        print("BLENDER_PRODUCTION_REPORT:" + json.dumps(report))
        return report


if __name__ == "__main__":
    output = "./output"
    glb_input = ""
    vrm_ver = "0.0"
    spec_path = ""
    run_id_arg = ""
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
        if "--run-id" in args:
            run_id_arg = args[args.index("--run-id") + 1]
    result = run_production_pipeline(
        output,
        glb_input,
        vrm_version=vrm_ver,
        spec_json_path=spec_path,
        run_id=run_id_arg,
    )
    if result.get("status") != "ok":
        sys.exit(1)
