"""Automated unit tests for Python VRM 0.0 & 1.0 validator, hardened Blender runner, and Blender scripts."""

import json
import platform
import py_compile
import struct
import unittest
from pathlib import Path

from blender_runner import candidate_blender_paths, detect_blender, is_trusted_blender_executable
from vrm_validator import REQUIRED_HUMANOID_BONES, validate_vrm_bytes


def _pack_glb(gltf: dict) -> bytes:
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


def build_minimal_valid_vrm1() -> bytes:
    human_bones = {name: {"node": idx} for idx, name in enumerate(REQUIRED_HUMANOID_BONES)}
    return _pack_glb({
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
    })


def build_minimal_valid_vrm0() -> bytes:
    human_bones = [{"bone": name, "node": idx, "useDefaultValues": True} for idx, name in enumerate(REQUIRED_HUMANOID_BONES)]
    return _pack_glb({
        "asset": {"version": "2.0"},
        "nodes": [{"name": b} for b in REQUIRED_HUMANOID_BONES],
        "skins": [{"joints": list(range(len(REQUIRED_HUMANOID_BONES)))}],
        "extensions": {
            "VRM": {
                "specVersion": "0.0",
                "meta": {
                    "title": "Test VRM0 Avatar",
                    "author": "Test Author",
                    "commercialUssageName": "Disallow",
                    "allowedUserName": "OnlyAuthor",
                },
                "humanoid": {"humanBones": human_bones},
                "firstPerson": {"firstPersonBone": 4},
                "blendShapeMaster": {
                    "blendShapeGroups": [
                        {"name": "Neutral", "presetName": "neutral", "binds": []},
                        {"name": "Joy", "presetName": "joy", "binds": [{"mesh": 0, "index": 0, "weight": 100}]},
                    ]
                },
                "secondaryAnimation": {
                    "boneGroups": [{"comment": "Hair", "stiffiness": 0.6, "bones": [4], "colliderGroups": [0]}],
                    "colliderGroups": [{"node": 4, "colliders": [{"offset": {"x": 0, "y": 0, "z": 0}, "radius": 0.1}]}],
                },
            }
        },
    })


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

    def test_vrm_validator_accepts_valid_vrm0_and_enforces_version_separation(self):
        vrm0_bytes = build_minimal_valid_vrm0()
        report_v0 = validate_vrm_bytes(vrm0_bytes, expected_version="0.0")
        self.assertTrue(report_v0["valid"])
        self.assertEqual(report_v0["spec_version"], "0.0")
        self.assertEqual(report_v0["missing_required_bones"], [])
        self.assertEqual(report_v0["invalid_bone_nodes"], [])
        self.assertEqual(report_v0["blend_shape_group_count"], 2)
        self.assertEqual(report_v0["secondary_bone_group_count"], 1)
        self.assertEqual(report_v0["collider_group_count"], 1)

        # Cross-version mismatch must fail strict validation
        report_wrong = validate_vrm_bytes(vrm0_bytes, expected_version="1.0")
        self.assertFalse(report_wrong["valid"])

    def test_vrm_validator_accepts_valid_vrm1_and_rejects_as_vrm0(self):
        vrm1_bytes = build_minimal_valid_vrm1()
        report_v1 = validate_vrm_bytes(vrm1_bytes, expected_version="1.0")
        self.assertTrue(report_v1["valid"])
        self.assertEqual(report_v1["spec_version"], "1.0")
        self.assertEqual(report_v1["missing_required_bones"], [])
        self.assertEqual(report_v1["mapped_bone_count"], len(REQUIRED_HUMANOID_BONES))

        report_wrong = validate_vrm_bytes(vrm1_bytes, expected_version="0.0")
        self.assertFalse(report_wrong["valid"])

    def test_vrm_validator_rejects_corrupt_header(self):
        report = validate_vrm_bytes(b"NOT_A_GLB_FILE_1234567890")
        self.assertFalse(report["valid"])

    def test_blender_production_pipeline_and_milestone2_scripts_compile_and_contain_vrm0_markers(self):
        root = Path(__file__).resolve().parent.parent
        prod_script = root / "blender_scripts" / "blender_production_pipeline.py"
        m2_script = root / "blender_scripts" / "test_milestone2_blender.py"
        self.assertTrue(prod_script.exists())
        self.assertTrue(m2_script.exists())

        py_compile.compile(str(prod_script), doraise=True)
        py_compile.compile(str(m2_script), doraise=True)

        prod_text = prod_script.read_text(encoding="utf-8")
        self.assertIn("--glb-path", prod_text)
        self.assertIn("--vrm-version", prod_text)
        self.assertIn("ext.vrm0.meta", prod_text)
        self.assertIn("ext.vrm0.humanoid", prod_text)
        self.assertIn("ext.vrm0.blend_shape_master", prod_text)
        self.assertIn("ext.vrm0.secondary_animation", prod_text)
        self.assertIn("j_bip_c_hips", prod_text)
        self.assertIn("validate_vrm_bytes", prod_text)
        self.assertIn("run_production_pipeline", prod_text)

        m2_text = m2_script.read_text(encoding="utf-8")
        self.assertIn("--glb-path", m2_text)
        self.assertIn("bpy.ops.import_scene.gltf", m2_text)
        self.assertIn("ARMATURE_AUTO", m2_text)
        self.assertIn("vertex_group_normalize_all", m2_text)
        self.assertIn("material_preserved", m2_text)
        self.assertIn("texture_preserved", m2_text)
        self.assertIn("rigging_success", m2_text)
        self.assertIn("vrm_export_success", m2_text)
        self.assertIn("vrm_reload_success", m2_text)
        self.assertIn("evaluated_depsgraph_get", m2_text)
        self.assertIn("export_scene.vrm", m2_text)
        self.assertIn("validate_vrm_bytes", m2_text)
        self.assertNotIn("create_icosphere", m2_text)
        self.assertNotIn("create_cube", m2_text)


if __name__ == "__main__":
    unittest.main()
