"""Automated unit tests for the Python backend, Blender integration, and binary VRM validator."""

import json
import struct
import unittest
from pathlib import Path

from blender_runner import candidate_blender_paths, detect_blender
from providers import get_provider_catalog
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
        paths = candidate_blender_paths(r"C:\Custom\blender.exe")
        self.assertGreaterEqual(len(paths), 2)
        self.assertEqual(paths[0], r"C:\Custom\blender.exe")

    def test_detect_blender_graceful_on_missing_path(self):
        info = detect_blender("/nonexistent/path/to/blender")
        self.assertIsInstance(info.installed, bool)
        self.assertGreater(len(info.searched_paths), 0)

    def test_provider_catalog_includes_local_fallback(self):
        catalog = get_provider_catalog()
        ids = [item["id"] for item in catalog]
        self.assertIn("gemini-4-hydrogen", ids)
        self.assertIn("local-semantic-parser", ids)

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

    def test_milestone2_blender_script_exists(self):
        script = Path(__file__).resolve().parent.parent / "blender_scripts" / "test_milestone2_blender.py"
        self.assertTrue(script.exists())
        text = script.read_text(encoding="utf-8")
        self.assertIn("bpy.ops.wm.save_as_mainfile", text)


if __name__ == "__main__":
    unittest.main()
