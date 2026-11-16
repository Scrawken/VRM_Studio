"""Independent Python binary GLB / VRM 1.0 validator."""

import json
import struct
from typing import Any, Dict, List

REQUIRED_HUMANOID_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
]


def validate_vrm_bytes(payload: bytes) -> Dict[str, Any]:
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

    vrm = gltf_json.get("extensions", {}).get("VRMC_vrm", {})
    spec_version = vrm.get("specVersion")
    human_bones = vrm.get("humanoid", {}).get("humanBones", {})
    missing: List[str] = [b for b in REQUIRED_HUMANOID_BONES if b not in human_bones]

    skins = gltf_json.get("skins", [])
    bone_count = len(skins[0].get("joints", [])) if skins else 0
    presets = vrm.get("expressions", {}).get("preset", {})

    return {
        "valid": spec_version == "1.0" and len(missing) == 0 and bone_count > 0,
        "spec_version": spec_version,
        "missing_required_bones": missing,
        "mapped_bone_count": len(human_bones),
        "skin_bone_count": bone_count,
        "expression_count": len(presets),
    }
