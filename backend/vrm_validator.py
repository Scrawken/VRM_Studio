"""Independent Python binary GLB / VRM 0.0 & VRM 1.0 validator (strict parity with vrmValidator.ts)."""

import json
import math
import struct
import sys
from typing import Any, Dict, List, Optional, Set

REQUIRED_HUMANOID_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
]

VRM0_HUMANOID_BONES: Set[str] = {
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

VRM0_BLEND_SHAPE_PRESETS: Set[str] = {
    "unknown", "neutral", "a", "i", "u", "e", "o", "blink",
    "joy", "angry", "sorrow", "fun",
    "lookup", "lookdown", "lookleft", "lookright",
    "blink_l", "blink_r",
}

VRM0_ALLOWED_USERS: Set[str] = {"OnlyAuthor", "ExplicitlyLicensedPerson", "Everyone"}
VRM0_ALLOWANCES: Set[str] = {"Allow", "Disallow"}
VRM0_LICENSE_NAMES: Set[str] = {
    "Redistribution_Prohibited", "CC0", "CC_BY", "CC_BY_NC",
    "CC_BY_SA", "CC_BY_NC_SA", "CC_BY_ND", "CC_BY_NC_ND", "Other",
}

TYPE_COMPONENTS: Dict[str, int] = {
    "SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16,
}


def _component_byte_size(component_type: int) -> int:
    if component_type in (5120, 5121):
        return 1
    if component_type in (5122, 5123):
        return 2
    if component_type in (5125, 5126):
        return 4
    return 0


def _is_accessor_in_bounds(
    acc_idx: Any,
    accessors: List[Dict[str, Any]],
    buffer_views: List[Dict[str, Any]],
    bin_len: int,
) -> bool:
    if not isinstance(acc_idx, int) or acc_idx < 0 or acc_idx >= len(accessors):
        return False
    acc = accessors[acc_idx]
    comps = TYPE_COMPONENTS.get(acc.get("type", ""), 0)
    comp_bytes = _component_byte_size(int(acc.get("componentType", 0)))
    count = acc.get("count", -1)
    if not comps or not comp_bytes or not isinstance(count, int) or count < 0:
        return False
    bv_idx = acc.get("bufferView")
    if bv_idx is None:
        sparse = acc.get("sparse")
        return isinstance(sparse, dict) and isinstance(sparse.get("count"), int) and sparse["count"] >= 0
    if not isinstance(bv_idx, int) or bv_idx < 0 or bv_idx >= len(buffer_views):
        return False
    bv = buffer_views[bv_idx]
    elem_size = comps * comp_bytes
    stride = bv.get("byteStride")
    if not isinstance(stride, int) or stride < elem_size:
        stride = elem_size
    bv_start = int(bv.get("byteOffset", 0))
    bv_end = bv_start + int(bv.get("byteLength", 0))
    if bv_start < 0 or bv_end > bin_len:
        return False
    if count == 0:
        return True
    acc_start = bv_start + int(acc.get("byteOffset", 0))
    acc_end = acc_start + (count - 1) * stride + elem_size
    return acc_start >= bv_start and acc_end <= bv_end and acc_end <= bin_len


def _has_nonzero_morph_delta(
    acc: Dict[str, Any],
    buffer_views: List[Dict[str, Any]],
    bin_bytes: bytes,
) -> bool:
    if acc.get("type") != "VEC3" or acc.get("componentType") != 5126:
        return False
    sparse = acc.get("sparse")
    if isinstance(sparse, dict) and sparse.get("count", 0) > 0:
        vals = sparse.get("values", {})
        bv_idx = vals.get("bufferView")
        if isinstance(bv_idx, int) and 0 <= bv_idx < len(buffer_views):
            bv = buffer_views[bv_idx]
            base = int(bv.get("byteOffset", 0)) + int(vals.get("byteOffset", 0))
            for i in range(int(sparse["count"])):
                p = base + i * 12
                if p + 12 > len(bin_bytes):
                    break
                dx, dy, dz = struct.unpack_from("<fff", bin_bytes, p)
                if math.isfinite(dx) and math.isfinite(dy) and math.isfinite(dz):
                    if abs(dx) + abs(dy) + abs(dz) > 1e-4:
                        return True
    bv_idx = acc.get("bufferView")
    if isinstance(bv_idx, int) and 0 <= bv_idx < len(buffer_views):
        bv = buffer_views[bv_idx]
        stride = bv.get("byteStride")
        if not isinstance(stride, int) or stride < 12:
            stride = 12
        base = int(bv.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
        for i in range(int(acc.get("count", 0))):
            p = base + i * stride
            if p + 12 > len(bin_bytes):
                break
            dx, dy, dz = struct.unpack_from("<fff", bin_bytes, p)
            if math.isfinite(dx) and math.isfinite(dy) and math.isfinite(dz):
                if abs(dx) + abs(dy) + abs(dz) > 1e-4:
                    return True
    return False


def _morph_target_has_delta(
    target: Dict[str, Any],
    accessors: List[Dict[str, Any]],
    buffer_views: List[Dict[str, Any]],
    bin_bytes: bytes,
) -> bool:
    """A morph target is non-empty when POSITION, NORMAL or TANGENT carries a non-zero delta."""
    for attr in ("POSITION", "NORMAL", "TANGENT"):
        acc_idx = target.get(attr)
        if _is_accessor_in_bounds(acc_idx, accessors, buffer_views, len(bin_bytes)):
            if _has_nonzero_morph_delta(accessors[acc_idx], buffer_views, bin_bytes):
                return True
    return False


VRM0_FIRST_PERSON_FLAGS: Set[str] = {"Auto", "Both", "ThirdPersonOnly", "FirstPersonOnly"}
VRM0_LOOK_AT_TYPES: Set[str] = {"None", "Bone", "BlendShape"}


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _validate_vrm0_extras(
    vrm0: Dict[str, Any],
    texture_count: int,
    material_names: Optional[List[str]] = None,
    warnings: Optional[List[str]] = None,
) -> List[str]:
    errs: List[str] = []
    meta = vrm0.get("meta")
    if isinstance(meta, dict):
        for key in ("title", "version", "author", "contactInformation", "reference", "otherPermissionUrl", "otherLicenseUrl"):
            if key in meta and not isinstance(meta[key], str):
                errs.append(f"meta.{key} must be a string")
        if "texture" in meta:
            tex = meta["texture"]
            if not _is_int(tex) or tex < -1 or tex >= texture_count:
                errs.append(f"meta.texture {tex} is not -1 or a valid texture index")

    fp = vrm0.get("firstPerson")
    if isinstance(fp, dict):
        if "lookAtTypeName" in fp and fp["lookAtTypeName"] not in VRM0_LOOK_AT_TYPES:
            errs.append(f"Invalid firstPerson.lookAtTypeName {fp['lookAtTypeName']}")
        anns = fp.get("meshAnnotations")
        if isinstance(anns, list):
            for ma in anns:
                if isinstance(ma, dict) and "firstPersonFlag" in ma and ma["firstPersonFlag"] not in VRM0_FIRST_PERSON_FLAGS:
                    errs.append(f"Invalid firstPersonFlag {ma['firstPersonFlag']}")

    bsm = vrm0.get("blendShapeMaster")
    groups = bsm.get("blendShapeGroups") if isinstance(bsm, dict) else None
    if isinstance(groups, list):
        seen: Set[str] = set()
        for i, g in enumerate(groups):
            if not isinstance(g, dict):
                errs.append(f"blendShapeGroups[{i}] is not an object")
                continue
            if "isBinary" in g and not isinstance(g["isBinary"], bool):
                errs.append(f"blendShapeGroups[{i}].isBinary must be boolean")
            pn = g.get("presetName")
            if isinstance(pn, str) and pn != "unknown":
                if pn in seen:
                    errs.append(f"Duplicate blendShapeGroup presetName {pn}")
                seen.add(pn)
            if "materialValues" in g:
                mvs = g["materialValues"]
                if not isinstance(mvs, list):
                    errs.append(f"blendShapeGroups[{i}].materialValues must be an array")
                else:
                    for mv in mvs:
                        if (
                            not isinstance(mv, dict)
                            or not isinstance(mv.get("materialName"), str)
                            or not isinstance(mv.get("propertyName"), str)
                            or not isinstance(mv.get("targetValue"), list)
                            or not all(_is_num(x) for x in mv["targetValue"])
                        ):
                            errs.append(f"blendShapeGroups[{i}].materialValues has a malformed entry")
                            break
                        if mv["materialName"] not in (material_names or []):
                            errs.append(
                                f"blendShapeGroups[{i}].materialValues references unknown material \"{mv['materialName']}\""
                            )

    if "materialProperties" in vrm0:
        mps = vrm0["materialProperties"]
        if not isinstance(mps, list):
            errs.append("materialProperties must be an array")
        else:
            if warnings is not None and len(mps) != len(material_names or []):
                warnings.append(
                    f"materialProperties has {len(mps)} entries but the glTF has {len(material_names or [])} materials"
                )
            for i, mp in enumerate(mps):
                if not isinstance(mp, dict):
                    errs.append(f"materialProperties[{i}] is not an object")
                    continue
                if "name" in mp and not isinstance(mp["name"], str):
                    errs.append(f"materialProperties[{i}].name must be a string")
                if "shader" in mp and not isinstance(mp["shader"], str):
                    errs.append(f"materialProperties[{i}].shader must be a string")
                if "renderQueue" in mp and not _is_int(mp["renderQueue"]):
                    errs.append(f"materialProperties[{i}].renderQueue must be an integer")
                checks = (
                    ("floatProperties", _is_num, "finite numbers"),
                    ("vectorProperties", lambda v: isinstance(v, list) and all(_is_num(x) for x in v), "number arrays"),
                    ("textureProperties", lambda v: _is_int(v) and 0 <= v < texture_count, "valid texture indices"),
                    ("keywordMap", lambda v: isinstance(v, bool), "booleans"),
                    ("tagMap", lambda v: isinstance(v, str), "strings"),
                )
                for key, ok, what in checks:
                    if key in mp and (not isinstance(mp[key], dict) or not all(ok(v) for v in mp[key].values())):
                        errs.append(f"materialProperties[{i}].{key} must map to {what}")
    return errs


HUMANOID_ALLOWED_PARENTS: Dict[str, List[str]] = {
    "spine": ["hips"],
    "chest": ["spine", "hips"],
    "upperChest": ["chest", "spine"],
    "neck": ["upperChest", "chest", "spine"],
    "head": ["neck"],
    "leftEye": ["head"], "rightEye": ["head"], "jaw": ["head"],
    "leftShoulder": ["upperChest", "chest", "spine"],
    "rightShoulder": ["upperChest", "chest", "spine"],
    "leftUpperArm": ["leftShoulder", "upperChest", "chest", "spine"],
    "rightUpperArm": ["rightShoulder", "upperChest", "chest", "spine"],
    "leftLowerArm": ["leftUpperArm"], "rightLowerArm": ["rightUpperArm"],
    "leftHand": ["leftLowerArm"], "rightHand": ["rightLowerArm"],
    "leftUpperLeg": ["hips"], "rightUpperLeg": ["hips"],
    "leftLowerLeg": ["leftUpperLeg"], "rightLowerLeg": ["rightUpperLeg"],
    "leftFoot": ["leftLowerLeg"], "rightFoot": ["rightLowerLeg"],
    "leftToes": ["leftFoot"], "rightToes": ["rightFoot"],
}
for _side in ("left", "right"):
    for _finger in ("Thumb", "Index", "Middle", "Ring", "Little"):
        _hand = f"{_side}Hand"
        _prox = f"{_side}{_finger}Proximal"
        _inter = f"{_side}{_finger}Intermediate"
        _dist = f"{_side}{_finger}Distal"
        HUMANOID_ALLOWED_PARENTS[_prox] = [_hand]
        HUMANOID_ALLOWED_PARENTS[_inter] = [_prox, _hand]
        HUMANOID_ALLOWED_PARENTS[_dist] = [_inter, _prox, _hand]


def _humanoid_hierarchy_warnings(mapped_map: Dict[str, int], nodes: List[Dict[str, Any]]) -> List[str]:
    parent_of: Dict[int, int] = {}
    for i, nd in enumerate(nodes):
        children = nd.get("children", []) if isinstance(nd, dict) else []
        for ch in children if isinstance(children, list) else []:
            if _is_int(ch) and ch not in parent_of:
                parent_of[ch] = i
    node_to_bone = {n: b for b, n in mapped_map.items()}
    warnings: List[str] = []
    for bone, node in mapped_map.items():
        if node < 0 or node >= len(nodes):
            continue
        allowed = HUMANOID_ALLOWED_PARENTS.get(bone)
        if not allowed:
            continue
        cur = parent_of.get(node)
        guard = 0
        while cur is not None and cur not in node_to_bone and guard <= len(nodes):
            cur = parent_of.get(cur)
            guard += 1
        ancestor = node_to_bone.get(cur) if cur is not None else None
        if ancestor is None or ancestor not in allowed:
            warnings.append(f"'{bone}' nearest humanoid ancestor is {ancestor or 'none'} (expected {' / '.join(allowed)})")
    return warnings


def _read_vec4_weight_sum(
    acc: Dict[str, Any],
    v: int,
    buffer_views: List[Dict[str, Any]],
    bin_bytes: bytes,
) -> Optional[float]:
    bv_idx = acc.get("bufferView")
    if not isinstance(bv_idx, int) or bv_idx < 0 or bv_idx >= len(buffer_views):
        return None
    bv = buffer_views[bv_idx]
    comp_type = int(acc.get("componentType", 0))
    comp_bytes = _component_byte_size(comp_type)
    if not comp_bytes:
        return None
    stride = bv.get("byteStride")
    if not isinstance(stride, int) or stride < comp_bytes * 4:
        stride = comp_bytes * 4
    ptr = int(bv.get("byteOffset", 0)) + int(acc.get("byteOffset", 0)) + v * stride
    if ptr < 0 or ptr + comp_bytes * 4 > len(bin_bytes):
        return None
    total = 0.0
    for k in range(4):
        c_off = ptr + k * comp_bytes
        if comp_type == 5126:
            w = struct.unpack_from("<f", bin_bytes, c_off)[0]
        elif comp_type == 5123:
            w = struct.unpack_from("<H", bin_bytes, c_off)[0] / 65535.0
        elif comp_type == 5121:
            w = bin_bytes[c_off] / 255.0
        else:
            return None
        if not math.isfinite(w) or w < -0.001:
            return None
        total += w
    return total


def validate_vrm_bytes(
    payload: bytes, expected_version: Optional[str] = None
) -> Dict[str, Any]:
    if len(payload) < 20:
        return {"valid": False, "error": "Payload shorter than 20-byte GLB header."}

    magic, version, total_len = struct.unpack_from("<III", payload, 0)
    if magic != 0x46546C67 or version != 2:
        return {"valid": False, "error": f"Invalid GLB header magic={hex(magic)} version={version}"}
    if total_len != len(payload):
        return {"valid": False, "error": f"Length mismatch: declared={total_len}, actual={len(payload)}"}

    offset = 12
    gltf_json: Dict[str, Any] = {}
    bin_bytes: Optional[bytes] = None
    while offset + 8 <= len(payload):
        chunk_len, chunk_type = struct.unpack_from("<II", payload, offset)
        start = offset + 8
        end = start + chunk_len
        if end > len(payload):
            return {"valid": False, "error": "Chunk exceeds payload length."}
        if chunk_type == 0x4E4F534A:
            try:
                gltf_json = json.loads(payload[start:end].decode("utf-8"))
            except Exception as exc:
                return {"valid": False, "error": f"Invalid JSON chunk: {exc}"}
        elif chunk_type == 0x004E4942:
            bin_bytes = payload[start:end]
        offset = end

    if not gltf_json or bin_bytes is None:
        return {"valid": False, "error": "Missing JSON or BIN chunk."}

    errors: List[str] = []
    extra_warnings: List[str] = []
    extensions = gltf_json.get("extensions", {})
    extensions_used = gltf_json.get("extensionsUsed", [])
    vrm0 = extensions.get("VRM")
    vrm1 = extensions.get("VRMC_vrm")

    nodes = gltf_json.get("nodes", [])
    meshes = gltf_json.get("meshes", [])
    skins = gltf_json.get("skins", [])
    materials = gltf_json.get("materials", [])
    textures = gltf_json.get("textures", [])
    images = gltf_json.get("images", [])
    accessors = gltf_json.get("accessors", [])
    buffer_views = gltf_json.get("bufferViews", [])
    node_count = len(nodes)

    if not ((vrm0 and not vrm1) or (vrm1 and not vrm0)):
        return {
            "valid": False,
            "spec_version": "ambiguous" if (vrm0 and vrm1) else "missing",
            "missing_required_bones": list(REQUIRED_HUMANOID_BONES),
            "mapped_bone_count": 0,
            "skin_bone_count": len(skins[0].get("joints", [])) if skins else 0,
            "expression_count": 0,
            "blend_shape_group_count": 0,
            "secondary_bone_group_count": 0,
            "collider_group_count": 0,
            "errors": ["Missing or ambiguous VRM extension"],
        }

    is_vrm0 = bool(vrm0 and not vrm1)
    spec_version = str((vrm0 if is_vrm0 else vrm1).get("specVersion") or ("0.0" if is_vrm0 else "missing"))
    if is_vrm0:
        if spec_version != "0.0" or expected_version not in (None, "0.0"):
            errors.append(f"Version mismatch: expected {expected_version or '0.0'}, got {spec_version}")
        if not isinstance(extensions_used, list) or "VRM" not in extensions_used:
            errors.append("extensionsUsed missing 'VRM'")
    else:
        if spec_version != "1.0" or expected_version not in (None, "1.0"):
            errors.append(f"Version mismatch: expected {expected_version or '1.0'}, got {spec_version}")
        if not isinstance(extensions_used, list) or "VRMC_vrm" not in extensions_used:
            errors.append("extensionsUsed missing 'VRMC_vrm'")

    # Node hierarchy bounds & acyclicity check
    if node_count == 0:
        errors.append("Scene has 0 nodes")
    else:
        state = [0] * node_count

        def _dfs(idx: int) -> None:
            if state[idx] == 1:
                errors.append(f"Node cycle at {idx}")
                return
            if state[idx] == 2:
                return
            state[idx] = 1
            nd = nodes[idx]
            if "mesh" in nd and (not isinstance(nd["mesh"], int) or nd["mesh"] < 0 or nd["mesh"] >= len(meshes)):
                errors.append(f"Node {idx} invalid mesh {nd['mesh']}")
            if "skin" in nd and (not isinstance(nd["skin"], int) or nd["skin"] < 0 or nd["skin"] >= len(skins)):
                errors.append(f"Node {idx} invalid skin {nd['skin']}")
            for ch in nd.get("children", []):
                if not isinstance(ch, int) or ch < 0 or ch >= node_count:
                    errors.append(f"Node {idx} out-of-range child {ch}")
                else:
                    _dfs(ch)
            state[idx] = 2

        for i in range(node_count):
            if state[i] == 0:
                _dfs(i)

    # Humanoid mapping & metadata enum validation
    mapped_map: Dict[str, int] = {}
    if is_vrm0:
        m0 = vrm0.get("meta")
        if not isinstance(m0, dict):
            errors.append("Missing VRM.meta")
        else:
            if "allowedUserName" in m0 and m0["allowedUserName"] not in VRM0_ALLOWED_USERS:
                errors.append(f"Invalid allowedUserName {m0['allowedUserName']}")
            if "violentUssageName" in m0 and m0["violentUssageName"] not in VRM0_ALLOWANCES:
                errors.append(f"Invalid violentUssageName {m0['violentUssageName']}")
            if "sexualUssageName" in m0 and m0["sexualUssageName"] not in VRM0_ALLOWANCES:
                errors.append(f"Invalid sexualUssageName {m0['sexualUssageName']}")
            if "commercialUssageName" in m0 and m0["commercialUssageName"] not in VRM0_ALLOWANCES:
                errors.append(f"Invalid commercialUssageName {m0['commercialUssageName']}")
            if "licenseName" in m0 and m0["licenseName"] not in VRM0_LICENSE_NAMES:
                errors.append(f"Invalid licenseName {m0['licenseName']}")
        errors.extend(
            _validate_vrm0_extras(
                vrm0,
                len(textures),
                [m.get("name", "") for m in materials if isinstance(m, dict)],
                extra_warnings,
            )
        )

        raw_bones = vrm0.get("humanoid", {}).get("humanBones")
        if not isinstance(raw_bones, list):
            errors.append("VRM.humanoid.humanBones must be a list")
        else:
            seen_nodes: Dict[int, str] = {}
            for entry in raw_bones:
                if not isinstance(entry, dict) or not isinstance(entry.get("bone"), str) or not isinstance(entry.get("node"), int):
                    errors.append("Malformed VRM.humanoid.humanBones entry")
                    continue
                bname, nidx = entry["bone"], entry["node"]
                if bname not in VRM0_HUMANOID_BONES:
                    errors.append(f"Invalid VRM 0.0 bone identifier '{bname}'")
                    continue
                if bname in mapped_map:
                    errors.append(f"Duplicate humanoid bone '{bname}'")
                    continue
                if nidx in seen_nodes:
                    errors.append(f"Node {nidx} mapped to multiple bones")
                    continue
                seen_nodes[nidx] = bname
                mapped_map[bname] = nidx

        fp = vrm0.get("firstPerson", {})
        if "firstPersonBone" in fp:
            fp_b = fp["firstPersonBone"]
            if not isinstance(fp_b, int) or fp_b < -1 or fp_b >= node_count:
                errors.append(f"Invalid firstPersonBone {fp_b}")
        for ma in fp.get("meshAnnotations", []):
            m_idx = ma.get("mesh") if isinstance(ma, dict) else None
            if not isinstance(m_idx, int) or m_idx < 0 or m_idx >= len(meshes):
                errors.append(f"Invalid firstPerson.meshAnnotations mesh {m_idx}")
    else:
        raw_bones = vrm1.get("humanoid", {}).get("humanBones", {})
        seen_nodes1: Dict[int, str] = {}
        for bname, ref in raw_bones.items():
            if not isinstance(ref, dict) or not isinstance(ref.get("node"), int):
                errors.append(f"Malformed humanBones.{bname}")
            elif ref["node"] in seen_nodes1:
                errors.append(f"Node {ref['node']} mapped to multiple bones")
            else:
                seen_nodes1[ref["node"]] = bname
                mapped_map[bname] = ref["node"]

    warnings = _humanoid_hierarchy_warnings(mapped_map, nodes) + extra_warnings
    missing = [b for b in REQUIRED_HUMANOID_BONES if b not in mapped_map]
    invalid_nodes = [b for b, idx in mapped_map.items() if idx < 0 or idx >= node_count]

    # Geometry, Skinning, IBM & Weights
    bone_count = len(skins[0].get("joints", [])) if skins else 0
    if not skins or bone_count == 0:
        errors.append("Missing skin or empty joints")
    else:
        skin0 = skins[0]
        if any(not isinstance(j, int) or j < 0 or j >= node_count for j in skin0.get("joints", [])):
            errors.append("Skin joints contain out-of-range node index")
        ibm_idx = skin0.get("inverseBindMatrices")
        if not _is_accessor_in_bounds(ibm_idx, accessors, buffer_views, len(bin_bytes)):
            errors.append("Missing or out-of-bounds inverseBindMatrices")
        else:
            ibm_acc = accessors[ibm_idx]
            if ibm_acc.get("type") != "MAT4" or ibm_acc.get("componentType") != 5126 or ibm_acc.get("count", 0) < bone_count:
                errors.append("Invalid inverseBindMatrices accessor type/count")
            else:
                bv = buffer_views[ibm_acc["bufferView"]]
                base = int(bv.get("byteOffset", 0)) + int(ibm_acc.get("byteOffset", 0))
                vals = struct.unpack_from(f"<{bone_count * 16}f", bin_bytes, base)
                if any(not math.isfinite(x) for x in vals):
                    errors.append("Non-finite float in inverseBindMatrices")

    prim_count = 0
    vert_count = 0
    tri_count = 0
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            prim_count += 1
            attrs = prim.get("attributes", {})
            pos_idx = attrs.get("POSITION")
            j0_idx = attrs.get("JOINTS_0")
            w0_idx = attrs.get("WEIGHTS_0")
            j1_idx = attrs.get("JOINTS_1")
            w1_idx = attrs.get("WEIGHTS_1")
            if pos_idx is None or j0_idx is None or w0_idx is None:
                errors.append("Primitive missing POSITION, JOINTS_0, or WEIGHTS_0")
                continue
            if not _is_accessor_in_bounds(pos_idx, accessors, buffer_views, len(bin_bytes)):
                errors.append("POSITION accessor out of BIN bounds")
                continue
            if "indices" in prim and not _is_accessor_in_bounds(prim["indices"], accessors, buffer_views, len(bin_bytes)):
                errors.append("Primitive indices accessor out of BIN bounds")
                continue
            vert_count += int(accessors[pos_idx].get("count", 0))
            if "indices" in prim:
                tri_count += int(accessors[prim["indices"]].get("count", 0)) // 3
            else:
                tri_count += int(accessors[pos_idx].get("count", 0)) // 3

            if not _is_accessor_in_bounds(w0_idx, accessors, buffer_views, len(bin_bytes)) or not _is_accessor_in_bounds(j0_idx, accessors, buffer_views, len(bin_bytes)):
                errors.append("JOINTS_0 or WEIGHTS_0 out of BIN bounds")
                continue
            if (j1_idx is not None) != (w1_idx is not None):
                errors.append("Primitive defines only one of JOINTS_1 / WEIGHTS_1")
                continue
            if j1_idx is not None and (not _is_accessor_in_bounds(w1_idx, accessors, buffer_views, len(bin_bytes)) or not _is_accessor_in_bounds(j1_idx, accessors, buffer_views, len(bin_bytes))):
                errors.append("JOINTS_1 or WEIGHTS_1 out of BIN bounds")
                continue

            w0_acc = accessors[w0_idx]
            w1_acc = accessors[w1_idx] if w1_idx is not None else None
            for v in range(int(w0_acc.get("count", 0))):
                s0 = _read_vec4_weight_sum(w0_acc, v, buffer_views, bin_bytes)
                if s0 is None:
                    errors.append(f"Invalid WEIGHTS_0 at vertex {v}")
                    break
                s_total = s0
                if w1_acc is not None:
                    s1 = _read_vec4_weight_sum(w1_acc, v, buffer_views, bin_bytes)
                    if s1 is None:
                        errors.append(f"Invalid WEIGHTS_1 at vertex {v}")
                        break
                    s_total += s1
                if abs(s_total - 1.0) > 0.025:
                    errors.append(f"Unnormalized skin weight sum={s_total:.3f} at vertex {v}")
                    break

    if len(meshes) == 0 or prim_count == 0 or vert_count == 0 or tri_count == 0:
        errors.append("GLB contains empty mesh geometry")

    if len(materials) == 0:
        errors.append("GLB contains 0 materials")
    for tex in textures:
        if "source" in tex and (not isinstance(tex["source"], int) or tex["source"] < 0 or tex["source"] >= len(images)):
            errors.append("Invalid texture.source index")
    for img in images:
        if "bufferView" in img:
            bv_i = img["bufferView"]
            if not isinstance(bv_i, int) or bv_i < 0 or bv_i >= len(buffer_views):
                errors.append("Invalid image.bufferView index")
            else:
                bv = buffer_views[bv_i]
                if int(bv.get("byteOffset", 0)) + int(bv.get("byteLength", 0)) > len(bin_bytes):
                    errors.append("Image bufferView exceeds BIN length")

    # BlendShapeMaster / Expressions validation
    non_empty_exprs = 0
    if is_vrm0:
        groups = vrm0.get("blendShapeMaster", {}).get("blendShapeGroups", [])
        expr_count = len(groups)
        for grp in groups:
            pname = grp.get("presetName")
            if pname is not None and pname not in VRM0_BLEND_SHAPE_PRESETS:
                errors.append(f"Invalid VRM 0.0 blendShapeGroup presetName '{pname}'")
            binds = grp.get("binds", [])
            if not binds:
                continue
            has_delta = False
            for b in binds:
                m_idx = b.get("mesh") if isinstance(b, dict) else None
                t_idx = b.get("index") if isinstance(b, dict) else None
                w_val = b.get("weight") if isinstance(b, dict) else None
                if (
                    not isinstance(m_idx, int) or m_idx < 0 or m_idx >= len(meshes)
                    or not isinstance(t_idx, int) or t_idx < 0
                    or not isinstance(w_val, (int, float)) or not math.isfinite(w_val) or w_val < 0 or w_val > 100
                ):
                    errors.append("Invalid blendShapeGroup bind")
                    continue
                matched_slot = False
                for prim in meshes[m_idx].get("primitives", []):
                    targets = prim.get("targets", [])
                    if 0 <= t_idx < len(targets):
                        matched_slot = True
                        if _morph_target_has_delta(targets[t_idx], accessors, buffer_views, bin_bytes):
                            has_delta = True
                if not matched_slot:
                    errors.append(f"Morph target index {t_idx} missing on mesh {m_idx}")
            if not has_delta:
                errors.append(f"BlendShapeGroup '{grp.get('name', pname)}' binds to empty/zero morph target")
            else:
                non_empty_exprs += 1
    else:
        presets = vrm1.get("expressions", {}).get("preset", {})
        expr_count = len(presets)
        for ename, pdef in presets.items():
            binds = pdef.get("morphTargetBinds", []) if isinstance(pdef, dict) else []
            if not binds:
                continue
            has_delta = False
            for b in binds:
                n_idx = b.get("node") if isinstance(b, dict) else None
                t_idx = b.get("index") if isinstance(b, dict) else None
                if not isinstance(n_idx, int) or n_idx < 0 or n_idx >= node_count or "mesh" not in nodes[n_idx]:
                    errors.append(f"Expression '{ename}' invalid node bind")
                    continue
                m_idx = nodes[n_idx]["mesh"]
                matched_slot = False
                for prim in meshes[m_idx].get("primitives", []):
                    targets = prim.get("targets", [])
                    if isinstance(t_idx, int) and 0 <= t_idx < len(targets):
                        matched_slot = True
                        if _morph_target_has_delta(targets[t_idx], accessors, buffer_views, bin_bytes):
                            has_delta = True
                if not matched_slot:
                    errors.append(f"Expression '{ename}' missing morph target {t_idx}")
            if not has_delta:
                errors.append(f"Expression '{ename}' binds to empty/zero morph target")
            else:
                non_empty_exprs += 1

    # Secondary Animation / SpringBone & Colliders
    humanoid_node_set = set(mapped_map.values())
    if is_vrm0:
        sec_anim = vrm0.get("secondaryAnimation", {})
        bone_groups = sec_anim.get("boneGroups", [])
        collider_groups = sec_anim.get("colliderGroups", [])
        for g_idx, cg in enumerate(collider_groups):
            cnode = cg.get("node")
            if not isinstance(cnode, int) or cnode < 0 or cnode >= node_count:
                errors.append(f"colliderGroups[{g_idx}] invalid node {cnode}")
            for col in cg.get("colliders", []):
                off = col.get("offset")
                rad = col.get("radius")
                if not isinstance(off, dict) or not all(isinstance(off.get(ax), (int, float)) and math.isfinite(off.get(ax)) for ax in ("x", "y", "z")):
                    errors.append(f"colliderGroups[{g_idx}] invalid offset")
                if not isinstance(rad, (int, float)) or not math.isfinite(rad) or rad < 0:
                    errors.append(f"colliderGroups[{g_idx}] invalid radius {rad}")
        for b_idx, bg in enumerate(bone_groups):
            for key in ("stiffiness", "gravityPower", "dragForce", "hitRadius"):
                if key in bg and (not _is_num(bg[key]) or bg[key] < 0):
                    errors.append(f"boneGroups[{b_idx}].{key} must be a finite non-negative number")
            if _is_num(bg.get("dragForce")) and bg["dragForce"] > 1:
                errors.append(f"boneGroups[{b_idx}].dragForce must be within 0..1")
            gd = bg.get("gravityDir")
            if gd is not None:
                if not isinstance(gd, dict) or not all(_is_num(gd.get(ax)) for ax in ("x", "y", "z")):
                    errors.append(f"boneGroups[{b_idx}].gravityDir must be an object {{x,y,z}} of finite numbers")
                elif math.hypot(gd["x"], gd["y"], gd["z"]) == 0 and _is_num(bg.get("gravityPower")) and bg["gravityPower"] != 0:
                    warnings.append(f"boneGroups[{b_idx}].gravityDir has zero length but gravityPower is {bg['gravityPower']}")
            center = bg.get("center")
            if center is not None and (not isinstance(center, int) or center < -1 or center >= node_count):
                errors.append(f"boneGroups[{b_idx}] invalid center {center}")
            for bnode in bg.get("bones", []):
                if not isinstance(bnode, int) or bnode < 0 or bnode >= node_count:
                    errors.append(f"boneGroups[{b_idx}] out-of-range node {bnode}")
                elif bnode in humanoid_node_set:
                    errors.append(f"boneGroups[{b_idx}] binds humanoid node {bnode}")
            for cg_i in bg.get("colliderGroups", []):
                if not isinstance(cg_i, int) or cg_i < 0 or cg_i >= len(collider_groups):
                    errors.append(f"boneGroups[{b_idx}] out-of-range colliderGroup {cg_i}")
        sec_count = len(bone_groups)
        col_count = len(collider_groups)
    else:
        sb = extensions.get("VRMC_springBone", {})
        springs = sb.get("springs", [])
        colliders1 = sb.get("colliders", [])
        collider_groups1 = sb.get("colliderGroups", [])
        for col in colliders1:
            cnode = col.get("node")
            if not isinstance(cnode, int) or cnode < 0 or cnode >= node_count:
                errors.append(f"VRMC_springBone collider invalid node {cnode}")
            sph = col.get("shape", {}).get("sphere", {})
            if sph:
                rad = sph.get("radius")
                off = sph.get("offset", [])
                if not isinstance(rad, (int, float)) or not math.isfinite(rad) or rad < 0:
                    errors.append("VRMC_springBone collider negative radius")
                if not isinstance(off, list) or len(off) < 3 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in off[:3]):
                    errors.append("VRMC_springBone collider invalid offset")
        for sp in springs:
            for cg_i in sp.get("colliderGroups", []):
                if not isinstance(cg_i, int) or cg_i < 0 or cg_i >= len(collider_groups1):
                    errors.append("VRMC_springBone out-of-range colliderGroup")
            for j in sp.get("joints", []):
                jn = j.get("node") if isinstance(j, dict) else None
                if not isinstance(jn, int) or jn < 0 or jn >= node_count:
                    errors.append(f"VRMC_springBone invalid joint node {jn}")
                elif jn in humanoid_node_set:
                    errors.append(f"VRMC_springBone binds humanoid node {jn}")
        sec_count = len(springs)
        col_count = len(collider_groups1)

    valid = len(errors) == 0 and len(missing) == 0 and len(invalid_nodes) == 0
    return {
        "valid": valid,
        "spec_version": spec_version,
        "missing_required_bones": missing,
        "invalid_bone_nodes": invalid_nodes,
        "mapped_bone_count": len(mapped_map),
        "skin_bone_count": bone_count,
        "vertex_count": vert_count,
        "triangle_count": tri_count,
        "expression_count": expr_count,
        "non_empty_expression_count": non_empty_exprs,
        "blend_shape_group_count": expr_count,
        "secondary_bone_group_count": sec_count,
        "collider_group_count": col_count,
        "errors": errors,
        "warnings": warnings,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"valid": False, "error": "Usage: python3 vrm_validator.py <file.vrm> [0.0|1.0]"}))
        sys.exit(2)
    path = sys.argv[1]
    exp_ver = sys.argv[2] if len(sys.argv) >= 3 else None
    with open(path, "rb") as fh:
        res = validate_vrm_bytes(fh.read(), expected_version=exp_ver)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("valid") else 1)
