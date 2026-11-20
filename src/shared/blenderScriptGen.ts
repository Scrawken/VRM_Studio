import { textureResolutionToTargetPx } from './pngEncoder';
import { createDefaultVrmMetadata } from './characterParser';
import { CharacterSpecification, VrmExportVersion } from './types';

function hexToRgbaTuple(hex: string): string {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 6 ? clean : '888888', 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return `(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}, 1.0)`;
}

export function generateBlenderCharacterScript(
  spec: CharacterSpecification,
  outputDirPlaceholder = './output'
): string {
  const safeName = spec.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hScale = (spec.proportions.heightMeters / 1.7).toFixed(4);
  const texPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';
  const vrmMeta = createDefaultVrmMetadata(spec.name, spec.vrmMetadata);
  const subsurfLevels =
    spec.qualityConfig.geometryQuality === 'ultra'
      ? 2
      : spec.qualityConfig.geometryQuality === 'high'
        ? 1
        : 0;

  return `"""
VRM Forge Studio — Blender 4.2+ Anatomical Refinement, Rig Mapping & VRM ${targetVrmVersion} Export Script
Character: ${spec.name} (${spec.species} | Art Style: ${spec.artStyle})
Primary Export Target: VRM ${targetVrmVersion} | Geometry: ${spec.qualityConfig.geometryQuality} | Texture Target: ${texPx}px
Generated: ${spec.updatedAt}

Usage (Background / Headless):
  blender --background --python ${safeName}_build.py -- --out-dir "${outputDirPlaceholder}" --vrm-version ${targetVrmVersion}
"""

import bpy
import bmesh
import json
import math
import os
import re
import sys
from mathutils import Vector

CHAR_SPEC = ${JSON.stringify(spec, null, 2)}
VRM_META_DEFAULTS = ${JSON.stringify(vrmMeta, null, 2)}
TARGET_VRM_VERSION = "${targetVrmVersion}"
TARGET_TEXTURE_PX = ${texPx}
SUBSURF_LEVELS = ${subsurfLevels}

REQUIRED_VRM_HUMANOID_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
]

VROID_AND_CANONICAL_ALIASES = {
    "hips": ["hips", "j_bip_c_hips", "mixamorig:hips", "pelvis", "root"],
    "spine": ["spine", "j_bip_c_spine", "mixamorig:spine", "spine1", "spine_01"],
    "chest": ["chest", "j_bip_c_chest", "mixamorig:spine1", "mixamorig:spine2", "spine2", "spine_02"],
    "upperChest": ["upperchest", "j_bip_c_upperchest", "spine_03"],
    "neck": ["neck", "j_bip_c_neck", "mixamorig:neck", "neck_01"],
    "head": ["head", "j_bip_c_head", "mixamorig:head"],
    "leftEye": ["lefteye", "j_adj_l_faceeye", "eye_l"],
    "rightEye": ["righteye", "j_adj_r_faceeye", "eye_r"],
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


def vrm_extension_registered():
    # hasattr(bpy.ops.export_scene, "vrm") is always True (bpy.ops resolves names lazily), so test
    # the registered Armature property instead.
    try:
        return "vrm_addon_extension" in bpy.types.Armature.bl_rna.properties
    except Exception:
        return False


def ensure_vrm_addon(preferred_names=()):
    if vrm_extension_registered():
        return True
    try:
        import addon_utils
        names = [n for n in preferred_names if "vrm" in n.lower()]
        for mod in addon_utils.modules():
            if "vrm" in mod.__name__.lower() and mod.__name__ not in names:
                names.append(mod.__name__)
        for name in names:
            try:
                addon_utils.enable(name, default_set=True, persistent=False)
            except Exception:
                pass
            if vrm_extension_registered():
                return True
    except Exception:
        pass
    return False


PRIOR_ADDONS = []


def clear_scene():
    # read_factory_settings unregisters add-ons (including VRM), so re-enable them afterwards.
    if not PRIOR_ADDONS:
        PRIOR_ADDONS.extend(str(k) for k in bpy.context.preferences.addons.keys())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ensure_vrm_addon(PRIOR_ADDONS)


def create_material(name, rgba, metallic=0.0, roughness=0.5, emissive_rgba=None):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emissive_rgba and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emissive_rgba
            bsdf.inputs["Emission Strength"].default_value = 1.25
        bake_img = bpy.data.images.new(f"{name}_Bake_${texPx}", width=TARGET_TEXTURE_PX, height=TARGET_TEXTURE_PX)
        tex_node = nodes.new("ShaderNodeTexImage")
        tex_node.image = bake_img
        tex_node.location = (-360, 200)
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 28.0
        noise.inputs["Detail"].default_value = 6.0
        noise.location = (-560, -180)
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.08
        bump.location = (-280, -180)
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        if "Normal" in bsdf.inputs:
            links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def create_humanoid_armature(name, h_scale=${hScale}):
    arm_data = bpy.data.armatures.new(f"{name}_ArmatureData")
    arm_obj = bpy.data.objects.new(f"{name}_Armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones
    sw = CHAR_SPEC["proportions"]["shoulderWidthScale"]
    hw = CHAR_SPEC["proportions"]["hipWidthScale"]

    def add_bone(bname, head, tail, parent=None):
        b = eb.new(bname)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent:
            b.parent = parent
        return b

    hips_y = 0.94 * h_scale
    hips = add_bone("hips", (0, 0, hips_y), (0, 0, hips_y + 0.11 * h_scale))
    spine = add_bone("spine", (0, 0, hips_y + 0.11 * h_scale), (0, 0, hips_y + 0.24 * h_scale), hips)
    chest = add_bone("chest", (0, 0, hips_y + 0.24 * h_scale), (0, 0, hips_y + 0.38 * h_scale), spine)
    upper_chest = add_bone("upperChest", (0, 0, hips_y + 0.38 * h_scale), (0, 0, hips_y + 0.49 * h_scale), chest)
    neck = add_bone("neck", (0, 0, hips_y + 0.49 * h_scale), (0, 0, hips_y + 0.57 * h_scale), upper_chest)
    head = add_bone("head", (0, 0, hips_y + 0.57 * h_scale), (0, 0, hips_y + 0.77 * h_scale), neck)

    add_bone("leftEye", (0.0315, -0.084, hips_y + 0.675 * h_scale), (0.0315, -0.11, hips_y + 0.675 * h_scale), head)
    add_bone("rightEye", (-0.0315, -0.084, hips_y + 0.675 * h_scale), (-0.0315, -0.11, hips_y + 0.675 * h_scale), head)
    add_bone("jaw", (0, -0.025, hips_y + 0.598 * h_scale), (0, -0.095, hips_y + 0.588 * h_scale), head)

    sh_y = hips_y + 0.43 * h_scale
    for side, sign in [("left", 1.0), ("right", -1.0)]:
        sh = add_bone(f"{side}Shoulder", (sign * 0.07 * sw, 0, sh_y), (sign * 0.165 * sw, 0, sh_y), upper_chest)
        ua = add_bone(f"{side}UpperArm", (sign * 0.165 * sw, 0, sh_y), (sign * 0.415 * sw, 0, sh_y), sh)
        la = add_bone(f"{side}LowerArm", (sign * 0.415 * sw, 0, sh_y), (sign * 0.645 * sw, 0, sh_y), ua)
        hand = add_bone(f"{side}Hand", (sign * 0.645 * sw, 0, sh_y), (sign * 0.72 * sw, 0, sh_y), la)

        for idx, (fkey, y_off) in enumerate([("Thumb", -0.026), ("Index", -0.022), ("Middle", -0.008), ("Ring", 0.008), ("Little", 0.022)]):
            bx = sign * (0.667 if fkey == "Thumb" else 0.71) * sw
            first_suffix = "Metacarpal" if fkey == "Thumb" else "Proximal"
            second_suffix = "Proximal" if fkey == "Thumb" else "Intermediate"
            p1 = add_bone(f"{side}{fkey}{first_suffix}", (bx, y_off, sh_y - 0.015), (bx + sign * 0.032, y_off, sh_y - 0.017), hand)
            p2 = add_bone(f"{side}{fkey}{second_suffix}", (bx + sign * 0.032, y_off, sh_y - 0.017), (bx + sign * 0.056, y_off, sh_y - 0.019), p1)
            add_bone(f"{side}{fkey}Distal", (bx + sign * 0.056, y_off, sh_y - 0.019), (bx + sign * 0.074, y_off, sh_y - 0.021), p2)

        ul = add_bone(f"{side}UpperLeg", (sign * 0.092 * hw, 0, hips_y - 0.04), (sign * 0.092 * hw, 0, hips_y * 0.52), hips)
        ll = add_bone(f"{side}LowerLeg", (sign * 0.092 * hw, 0, hips_y * 0.52), (sign * 0.092 * hw, 0, 0.08 * h_scale), ul)
        ft = add_bone(f"{side}Foot", (sign * 0.092 * hw, 0, 0.08 * h_scale), (sign * 0.092 * hw, -0.11, 0.02), ll)
        add_bone(f"{side}Toes", (sign * 0.092 * hw, -0.11, 0.02), (sign * 0.092 * hw, -0.16, 0.02), ft)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def append_anatomical_loft(bm, rings, radial_segs=28):
    ring_verts = []
    for cx, cy, cz, rx, rz, axis in rings:
        verts = []
        for s in range(radial_segs):
            th = (s / radial_segs) * math.pi * 2.0
            c = math.cos(th)
            sn = math.sin(th)
            if axis == "x":
                verts.append(bm.verts.new((cx, cy + sn * rz, cz + c * rx)))
            else:
                sternum = math.exp(-((c / 0.18) ** 2))
                pec = math.exp(-(((abs(c) - 0.42) / 0.28) ** 2))
                dz = (pec * 0.014 - sternum * 0.005) * sn if sn > 0 else 0.0
                verts.append(bm.verts.new((cx + c * rx, cy + sn * rz - dz, cz)))
        ring_verts.append(verts)

    for r in range(len(ring_verts) - 1):
        a = ring_verts[r]
        b = ring_verts[r + 1]
        for s in range(radial_segs):
            s2 = (s + 1) % radial_segs
            bm.faces.new((a[s], a[s2], b[s2], b[s]))


def build_sculpted_hair_curves(name, head_z, h_scale=${hScale}):
    curve_data = bpy.data.curves.new(f"{name}_HairCurves", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.012
    curve_data.bevel_resolution = 3
    curve_obj = bpy.data.objects.new(f"{name}_Hair", curve_data)
    bpy.context.collection.objects.link(curve_obj)

    for idx in range(14):
        frac = (idx / 13.0) * 2.0 - 1.0
        ang = frac * 1.4
        spline = curve_data.splines.new("NURBS")
        pts = [
            (math.sin(ang) * 0.088, math.cos(ang) * 0.095, head_z + 0.09, 1.0),
            (math.sin(ang) * 0.115, math.cos(ang) * 0.135, head_z - 0.14 * h_scale, 1.0),
            (math.sin(ang) * 0.135, math.cos(ang) * 0.165, head_z - 0.36 * h_scale, 1.0),
            (math.sin(ang) * 0.142, math.cos(ang) * 0.175, head_z - 0.54 * h_scale, 1.0),
        ]
        spline.points.add(len(pts) - 1)
        for p_i, co in enumerate(pts):
            spline.points[p_i].co = co
        spline.use_endpoint_u = True

    bpy.context.view_layer.objects.active = curve_obj
    curve_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def refine_scene_meshes(objs):
    for obj in objs:
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.ops.object.shade_smooth()

        if SUBSURF_LEVELS > 0 and "Eyes" not in obj.name and len(obj.data.vertices) < 18000:
            sub = obj.modifiers.new(name="AnatomicalSubsurf", type="SUBSURF")
            sub.levels = SUBSURF_LEVELS
            sub.render_levels = SUBSURF_LEVELS

        if not obj.data.uv_layers:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=1.15192)
            bpy.ops.object.mode_set(mode="OBJECT")

        wn = obj.modifiers.new(name="WeightedNormals", type="WEIGHTED_NORMAL")
        wn.keep_sharp = True


def build_anatomical_fallback_scene(name, h_scale=${hScale}):
    arm_obj = create_humanoid_armature(name, h_scale)
    mesh = bpy.data.meshes.new(f"{name}_AnatomicalMeshData")
    obj = bpy.data.objects.new(f"{name}_AnatomicalBody", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    hips_z = 0.94 * h_scale
    append_anatomical_loft(bm, [
        (0, 0, hips_z - 0.10 * h_scale, 0.125, 0.095, "z"),
        (0, 0, hips_z + 0.02 * h_scale, 0.145, 0.105, "z"),
        (0, 0, hips_z + 0.16 * h_scale, 0.105, 0.090, "z"),
        (0, 0, hips_z + 0.30 * h_scale, 0.138, 0.118, "z"),
        (0, 0, hips_z + 0.43 * h_scale, 0.142, 0.102, "z"),
        (0, 0, hips_z + 0.50 * h_scale, 0.052, 0.050, "z"),
        (0, 0, hips_z + 0.58 * h_scale, 0.044, 0.046, "z"),
    ], radial_segs=32)

    head_z = hips_z + 0.59 * h_scale
    append_anatomical_loft(bm, [
        (0, -0.01, head_z + 0.005, 0.046, 0.052, "z"),
        (0, -0.015, head_z + 0.055, 0.072, 0.088, "z"),
        (0, -0.005, head_z + 0.110, 0.088, 0.102, "z"),
        (0, 0.005, head_z + 0.175, 0.078, 0.092, "z"),
        (0, 0.005, head_z + 0.215, 0.032, 0.038, "z"),
    ], radial_segs=32)

    for sign in (1.0, -1.0):
        lx = sign * 0.092
        append_anatomical_loft(bm, [
            (lx, 0, hips_z - 0.02, 0.082, 0.086, "z"),
            (lx, -0.006, hips_z * 0.72, 0.066, 0.072, "z"),
            (lx, -0.010, hips_z * 0.52, 0.051, 0.054, "z"),
            (lx, 0.012, hips_z * 0.34, 0.054, 0.062, "z"),
            (lx, 0.005, 0.08 * h_scale, 0.040, 0.044, "z"),
        ], radial_segs=20)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    skin_mat = create_material("Skin", ${hexToRgbaTuple(spec.palette.skinColor)}, metallic=0.0, roughness=0.6)
    hair_mat = create_material("Hair", ${hexToRgbaTuple(spec.palette.hairColor)}, metallic=0.12, roughness=0.35)
    armor_mat = create_material("Outfit", ${hexToRgbaTuple(spec.palette.primaryOutfitColor)}, metallic=0.48, roughness=0.38)
    accent_mat = create_material("SecondaryAccent", ${hexToRgbaTuple(spec.palette.secondaryOutfitColor)}, metallic=0.36, roughness=0.40)
    obj.data.materials.append(skin_mat)
    obj.data.materials.append(armor_mat)
    obj.data.materials.append(accent_mat)

    hair_obj = build_sculpted_hair_curves(name, head_z + 0.09, h_scale)
    hair_obj.data.materials.append(hair_mat)

    refine_scene_meshes([obj, hair_obj])

    obj.shape_key_add(name="Basis", from_mix=False)
    for expr in ["happy", "angry", "sad", "surprised", "blink", "aa", "ih", "ou", "ee", "oh"]:
        obj.shape_key_add(name=expr, from_mix=False)

    for mesh_obj in [obj, hair_obj]:
        mesh_obj.parent = arm_obj
        mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        arm_obj.select_set(True)
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    return arm_obj, [obj, hair_obj]


def resolve_vrm_bone_map(arm_obj):
    by_lower = {b.name.lower(): b.name for b in arm_obj.data.bones}
    by_norm = {re.sub(r"[^a-z0-9]", "", b.name.lower()): b.name for b in arm_obj.data.bones}
    mapping = {}
    for canonical, aliases in VROID_AND_CANONICAL_ALIASES.items():
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


def _assign_bone_ref(prop_obj, target_bone_name):
    if prop_obj is None:
        return
    if hasattr(prop_obj, "node") and hasattr(prop_obj.node, "bone_name"):
        prop_obj.node.bone_name = target_bone_name
    elif hasattr(prop_obj, "bone_name"):
        prop_obj.bone_name = target_bone_name


def run_deformation_check(arm_obj, bone_map):
    if not arm_obj or arm_obj.type != "ARMATURE":
        return {"deformed": False, "max_delta": 0.0, "weighted_vertices": 0}
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if not mesh_objs:
        return {"deformed": False, "max_delta": 0.0, "weighted_vertices": 0}

    target_mesh = max(mesh_objs, key=lambda o: len(o.data.vertices))
    weighted_verts = sum(
        1 for o in mesh_objs for v in o.data.vertices if any(g.weight > 0.001 for g in v.groups)
    )
    deps_before = bpy.context.evaluated_depsgraph_get()
    eval_before = target_mesh.evaluated_get(deps_before).to_mesh()
    rest_coords = [v.co.copy() for v in eval_before.vertices]
    target_mesh.evaluated_get(deps_before).to_mesh_clear()

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for canonical in ("leftUpperArm", "rightUpperArm", "hips"):
        bname = bone_map.get(canonical, canonical)
        pb = arm_obj.pose.bones.get(bname)
        if pb:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (0.25, 0.0, 0.25 if "left" in canonical else -0.25)
    bpy.context.view_layer.update()

    deps_after = bpy.context.evaluated_depsgraph_get()
    eval_after = target_mesh.evaluated_get(deps_after).to_mesh()
    max_delta = 0.0
    for i, v in enumerate(eval_after.vertices):
        if i < len(rest_coords):
            delta = (v.co - rest_coords[i]).length
            if delta > max_delta:
                max_delta = delta
    target_mesh.evaluated_get(deps_after).to_mesh_clear()

    for pb in arm_obj.pose.bones:
        pb.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    return {"deformed": max_delta > 1e-4, "max_delta": round(float(max_delta), 6), "weighted_vertices": weighted_verts}


def configure_vrm_addon_and_export(arm_obj, out_dir, deform_stats=None, vrm_version=TARGET_VRM_VERSION):
    vrm_path = os.path.join(out_dir, "${safeName}.vrm")
    blend_path = os.path.join(out_dir, "${safeName}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    vrm_addon_installed = ensure_vrm_addon(PRIOR_ADDONS)
    # Cache armature-derived values: the reload below invalidates arm_obj.
    bone_count = len(arm_obj.data.bones) if arm_obj else 0
    vrm_exported = False
    vrm_reload_valid = False
    vrm_error = None
    bone_map = resolve_vrm_bone_map(arm_obj) if arm_obj else {}
    missing_bones = [b for b in REQUIRED_VRM_HUMANOID_BONES if b not in bone_map]

    if arm_obj and vrm_addon_installed:
        try:
            ext = arm_obj.data.vrm_addon_extension
            if vrm_version == "0.0":
                ext.spec_version = "0.0"
                meta0 = ext.vrm0.meta
                meta0.title = VRM_META_DEFAULTS.get("title", CHAR_SPEC["name"])
                meta0.author = VRM_META_DEFAULTS.get("author", "") or "Unspecified Author"
                meta0.version = VRM_META_DEFAULTS.get("version", "1.0")
                if hasattr(meta0, "contact_information"):
                    meta0.contact_information = VRM_META_DEFAULTS.get("contactInformation", "")
                if hasattr(meta0, "reference"):
                    meta0.reference = VRM_META_DEFAULTS.get("reference", "")
                if hasattr(meta0, "other_license_url"):
                    meta0.other_license_url = VRM_META_DEFAULTS.get("otherLicenseUrl", "")
                if hasattr(meta0, "other_permission_url"):
                    meta0.other_permission_url = VRM_META_DEFAULTS.get("otherPermissionUrl", "")
                meta0.license_name = VRM_META_DEFAULTS.get("licenseName", "Other")
                meta0.allowed_user_name = VRM_META_DEFAULTS.get("allowedUserName", "OnlyAuthor")
                meta0.violent_ussage_name = VRM_META_DEFAULTS.get("violentUsage", "Disallow")
                meta0.sexual_ussage_name = VRM_META_DEFAULTS.get("sexualUsage", "Disallow")
                meta0.commercial_ussage_name = VRM_META_DEFAULTS.get("commercialUsage", "Disallow")

                vrm0_thumb_map = {
                    "leftThumbMetacarpal": "leftThumbProximal",
                    "leftThumbProximal": "leftThumbIntermediate",
                    "rightThumbMetacarpal": "rightThumbProximal",
                    "rightThumbProximal": "rightThumbIntermediate",
                }
                hum0 = ext.vrm0.humanoid
                seen_vrm0_bones = set()
                for canonical, real_bone in bone_map.items():
                    vrm0_bone = vrm0_thumb_map.get(canonical, canonical)
                    if vrm0_bone in seen_vrm0_bones:
                        continue
                    seen_vrm0_bones.add(vrm0_bone)
                    entry = next((hb for hb in hum0.human_bones if getattr(hb, "bone", "") == vrm0_bone), None)
                    if entry is None:
                        entry = hum0.human_bones.add()
                        if hasattr(entry, "bone"):
                            entry.bone = vrm0_bone
                    _assign_bone_ref(entry, real_bone)

                if hasattr(ext.vrm0, "first_person") and "head" in bone_map:
                    _assign_bone_ref(ext.vrm0.first_person.first_person_bone, bone_map["head"])
            else:
                ext.spec_version = "1.0"
                ext.vrm1.meta.vrm_name = VRM_META_DEFAULTS.get("title", CHAR_SPEC["name"])
                human_bones = ext.vrm1.humanoid.human_bones
                for canonical, real_bone in bone_map.items():
                    if hasattr(human_bones, canonical):
                        _assign_bone_ref(getattr(human_bones, canonical), real_bone)

            bpy.ops.export_scene.vrm(filepath=vrm_path)
            vrm_exported = os.path.exists(vrm_path)
            if vrm_exported:
                with open(vrm_path, "rb") as vf:
                    header = vf.read(12)
                    vrm_reload_valid = header[:4] == b"glTF"
                clear_scene()
                bpy.ops.import_scene.gltf(filepath=vrm_path)
                vrm_reload_valid = vrm_reload_valid and any(o.type == "MESH" for o in bpy.data.objects)
        except Exception as exc:
            vrm_error = str(exc)
    else:
        vrm_error = "VRM_Addon_for_Blender not installed; saved refined high-detail .blend project."

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    total_verts = sum(len(o.data.vertices) for o in mesh_objs)
    total_polys = sum(len(o.data.polygons) for o in mesh_objs)

    report = {
        "status": "ok" if vrm_exported and vrm_reload_valid else "warn",
        "vrm_version": vrm_version,
        "character_name": CHAR_SPEC["name"],
        "art_style": CHAR_SPEC.get("artStyle", "semi_realistic"),
        "target_texture_px": TARGET_TEXTURE_PX,
        "blender_version": bpy.app.version_string,
        "blend_path": blend_path,
        "vrm_addon_installed": vrm_addon_installed,
        "vrm_path": vrm_path if vrm_exported else None,
        "vrm_exported": vrm_exported,
        "vrm_reload_valid": vrm_reload_valid,
        "vrm_note": vrm_error,
        "vertex_count": total_verts,
        "polygon_count": total_polys,
        "bone_count": bone_count,
        "mapped_bone_count": len(bone_map),
        "missing_required_bones": missing_bones,
        "deformation": deform_stats or {},
    }
    report_path = os.path.join(out_dir, "${safeName}_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("VRM_FORGE_REPORT:" + json.dumps(report))


def main():
    out_dir = "${outputDirPlaceholder}"
    vrm_version = TARGET_VRM_VERSION
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1:]
        if "--out-dir" in args:
            out_dir = args[args.index("--out-dir") + 1]
        if "--vrm-version" in args:
            vrm_version = args[args.index("--vrm-version") + 1]
    os.makedirs(out_dir, exist_ok=True)
    clear_scene()

    source_glb = os.path.join(out_dir, "source_high.glb")
    arm_obj = None
    if os.path.exists(source_glb) and hasattr(bpy.ops.import_scene, "gltf"):
        bpy.ops.import_scene.gltf(filepath=source_glb)
        mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
        arm_objs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
        arm_obj = max(arm_objs, key=lambda a: len(a.data.bones)) if arm_objs else None
        refine_scene_meshes(mesh_objs)
    else:
        arm_obj, _meshes = build_anatomical_fallback_scene("${safeName}")

    deform_stats = None
    if arm_obj:
        bmap = resolve_vrm_bone_map(arm_obj)
        deform_stats = run_deformation_check(arm_obj, bmap)
    configure_vrm_addon_and_export(arm_obj, out_dir, deform_stats, vrm_version)


if __name__ == "__main__":
    main()
`;
}
