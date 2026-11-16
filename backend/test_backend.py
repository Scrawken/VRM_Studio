"""Automated unit tests for Python VRM 1.0 validator, hardened Blender runner, and Blender verification scripts."""

import json
import platform
import struct
import unittest
from pathlib import Path

from blender_runner import candidate_blender_paths, detect_blender, is_trusted_blender_executable
from vrm_validator import REQUIRED_HUMANOID_BONES, validate_vrm_bytes


def build_minimal_valid_vrm() -> bytes:
    human_bones = {name: {"node": idx} for idx, name in enumerate(REQUIRED_HUMANOID_BONES)}
    gltf = {
        "asset": {"version": "2.0"},
        "nodes": [{"name": b} for b in REQUIRED_HUMANOID_BONES],
        "skins": [{"joints": list(range(len(REQUIRED_HUMANOID_BONES)))}],
        "extensions": {
            "VRMC_vrm": {
                "specVersion": "1.0",
                "humanoid": {"humanBones": human_bones},
                "expressions": {"preset": {"happy": {}, "blink": {}}},
            }
        },
    }
    json_bytes = json.dumps(gltf).encode("utf-8")
    pad = (4 - (len(json_bytes) % 4)) % 4
    json_chunk = json_bytes + b" " * pad
    bin_chunk = b"\x00\x00\x00\x00"
    total_len = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    return (
        struct.pack("<III", 0x46546C67, 2, total_len)
        + struct.pack("<II", len(json_chunk), 0x4E4F534A)
        + json_chunk
        + struct.pack("<II", len(bin_chunk), 0x004E4942)
        + bin_chunk
    )


class BackendTests(unittest.TestCase):
    def test_blender_candidate_paths_non_empty(self):
        paths = candidate_blender_paths()
        self.assertGreaterEqual(len(paths), 2)

    def test_blender_executable_security_rejects_arbitrary_binaries(self):
        self.assertFalse(is_trusted_blender_executable("/bin/sh"))
        self.assertFalse(is_trusted_blender_executable("cmd.exe"))
        self.assertFalse(is_trusted_blender_executable("/usr/bin/blender;rm -rf /"))
        self.assertFalse(is_trusted_blender_executable("../blender"))
        if platform.system() == "Windows":
            self.assertTrue(is_trusted_blender_executable(r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"))
        else:
            self.assertTrue(is_trusted_blender_executable("/usr/bin/blender"))

    def test_detect_blender_graceful_on_host(self):
        info = detect_blender()
        self.assertIsInstance(info.installed, bool)
        self.assertGreater(len(info.searched_paths), 0)

    def test_vrm_validator_accepts_valid_vrm1(self):
        vrm_bytes = build_minimal_valid_vrm()
        report = validate_vrm_bytes(vrm_bytes)
        self.assertTrue(report["valid"])
        self.assertEqual(report["spec_version"], "1.0")
        self.assertEqual(report["missing_required_bones"], [])
        self.assertEqual(report["mapped_bone_count"], len(REQUIRED_HUMANOID_BONES))

    def test_vrm_validator_rejects_corrupt_header(self):
        report = validate_vrm_bytes(b"NOT_A_GLB_FILE_1234567890")
        self.assertFalse(report["valid"])

    def test_milestone2_blender_script_verifies_humanoid_glb_not_primitives(self):
        script = Path(__file__).resolve().parent.parent / "blender_scripts" / "test_milestone2_blender.py"
        self.assertTrue(script.exists())
        text = script.read_text(encoding="utf-8")
        self.assertIn("--glb-path", text)
        self.assertIn("bpy.ops.import_scene.gltf", text)
        self.assertIn("ARMATURE_AUTO", text)
        self.assertIn("vertex_group_normalize_all", text)
        self.assertIn("material_preserved", text)
        self.assertIn("texture_preserved", text)
        self.assertIn("rigging_success", text)
        self.assertIn("vrm_export_success", text)
        self.assertIn("vrm_reload_success", text)
        self.assertIn("evaluated_depsgraph_get", text)
        self.assertIn("export_scene.vrm", text)
        self.assertIn("validate_vrm_bytes", text)
        self.assertNotIn("create_icosphere", text)
        self.assertNotIn("create_cube", text)


if __name__ == "__main__":
    unittest.main()
