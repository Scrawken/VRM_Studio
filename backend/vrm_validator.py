"""Independent Python binary GLB / VRM 0.0 & VRM 1.0 validator."""

import json
import struct
from typing import Any, Dict, List, Optional

REQUIRED_HUMANOID_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
]


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
    has_bin = False
    while offset + 8 <= len(payload):
        chunk_len, chunk_type = struct.unpack_from("<II", payload, offset)
        start = offset + 8
        end = start + chunk_len
        if end > len(payload):
            return {"valid": False, "error": "Chunk exceeds payload length."}
        if chunk_type == 0x4E4F534A:
            gltf_json = json.loads(payload[start:end].decode("utf-8"))
        elif chunk_type == 0x004E4942:
            has_bin = True
        offset = end

    if not gltf_json or not has_bin:
        return {"valid": False, "error": "Missing JSON or BIN chunk."}

    extensions = gltf_json.get("extensions", {})
    vrm0 = extensions.get("VRM")
    vrm1 = extensions.get("VRMC_vrm")
    node_count = len(gltf_json.get("nodes", []))
    skins = gltf_json.get("skins", [])
    bone_count = len(skins[0].get("joints", [])) if skins else 0

    if vrm0 and not vrm1:
        spec_version = str(vrm0.get("specVersion") or "0.0")
        raw_bones = vrm0.get("humanoid", {}).get("humanBones", [])
        mapped_map: Dict[str, int] = {}
        if isinstance(raw_bones, list):
            for entry in raw_bones:
                if isinstance(entry, dict) and isinstance(entry.get("bone"), str) and isinstance(entry.get("node"), int):
                    mapped_map[entry["bone"]] = entry["node"]

        missing = [b for b in REQUIRED_HUMANOID_BONES if b not in mapped_map]
        invalid_nodes = [b for b, idx in mapped_map.items() if idx < 0 or idx >= node_count]

        groups = vrm0.get("blendShapeMaster", {}).get("blendShapeGroups", [])
        sec_anim = vrm0.get("secondaryAnimation", {})
        bone_groups = sec_anim.get("boneGroups", [])
        collider_groups = sec_anim.get("colliderGroups", [])

        version_ok = spec_version == "0.0" and (expected_version in (None, "0.0"))
        return {
            "valid": version_ok and isinstance(raw_bones, list) and len(missing) == 0 and len(invalid_nodes) == 0 and bone_count > 0,
            "spec_version": spec_version,
            "missing_required_bones": missing,
            "invalid_bone_nodes": invalid_nodes,
            "mapped_bone_count": len(mapped_map),
            "skin_bone_count": bone_count,
            "expression_count": len(groups),
            "blend_shape_group_count": len(groups),
            "secondary_bone_group_count": len(bone_groups),
            "collider_group_count": len(collider_groups),
        }

    if vrm1 and not vrm0:
        spec_version = str(vrm1.get("specVersion") or "missing")
        human_bones = vrm1.get("humanoid", {}).get("humanBones", {})
        missing: List[str] = [b for b in REQUIRED_HUMANOID_BONES if b not in human_bones]
        invalid_nodes = [
            b for b, ref in human_bones.items()
            if not isinstance(ref, dict) or not isinstance(ref.get("node"), int) or ref["node"] < 0 or ref["node"] >= node_count
        ]
        presets = vrm1.get("expressions", {}).get("preset", {})
        springs = extensions.get("VRMC_springBone", {}).get("springs", [])

        version_ok = spec_version == "1.0" and (expected_version in (None, "1.0"))
        return {
            "valid": version_ok and len(missing) == 0 and len(invalid_nodes) == 0 and bone_count > 0,
            "spec_version": spec_version,
            "missing_required_bones": missing,
            "invalid_bone_nodes": invalid_nodes,
            "mapped_bone_count": len(human_bones),
            "skin_bone_count": bone_count,
            "expression_count": len(presets),
            "blend_shape_group_count": len(presets),
            "secondary_bone_group_count": len(springs),
            "collider_group_count": 0,
        }

    return {
        "valid": False,
        "spec_version": "ambiguous" if (vrm0 and vrm1) else "missing",
        "missing_required_bones": list(REQUIRED_HUMANOID_BONES),
        "mapped_bone_count": 0,
        "skin_bone_count": bone_count,
        "expression_count": 0,
        "blend_shape_group_count": 0,
        "secondary_bone_group_count": 0,
        "collider_group_count": 0,
    }
