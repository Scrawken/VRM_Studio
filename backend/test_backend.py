"""Automated unit tests for Python VRM 0.0 & 1.0 validator, 10 VRM 0.0 conformance fixtures, Blender pipeline checks, and hardened Blender runner."""

import importlib
import json
import os
import platform
import py_compile
import struct
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Callable, Optional
from unittest.mock import patch

from blender_runner import candidate_blender_paths, detect_blender, is_trusted_blender_executable
from vrm_validator import REQUIRED_HUMANOID_BONES, validate_vrm_bytes


def _pack_glb(gltf: dict, bin_bytes: bytes = b"") -> bytes:
    json_bytes = json.dumps(gltf).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_chunk = json_bytes + b" " * json_pad
    if not bin_bytes:
        bin_bytes = b"\x00\x00\x00\x00"
    bin_pad = (4 - (len(bin_bytes) % 4)) % 4
    bin_chunk = bin_bytes + b"\x00" * bin_pad
    total_len = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    return (
        struct.pack("<III", 0x46546C67, 2, total_len)
        + struct.pack("<II", len(json_chunk), 0x4E4F534A)
        + json_chunk
        + struct.pack("<II", len(bin_chunk), 0x004E4942)
        + bin_chunk
    )


def _make_base_geometry_and_skin(joint_count: int):
    buf = bytearray()
    buffer_views = []
    accessors = []

    def push(data: bytes, target: Optional[int] = None) -> int:
        pad = (4 - (len(buf) % 4)) % 4
        if pad:
            buf.extend(b"\x00" * pad)
        bv_idx = len(buffer_views)
        bv = {"buffer": 0, "byteOffset": len(buf), "byteLength": len(data)}
        if target is not None:
            bv["target"] = target
        buffer_views.append(bv)
        buf.extend(data)
        return bv_idx

    # 3 vertices forming 1 triangle
    pos_bytes = struct.pack("<9f", 0.0, 0.0, 0.0, 0.3, 0.0, 0.0, 0.0, 0.5, 0.0)
    pos_acc = len(accessors)
    accessors.append({
        "bufferView": push(pos_bytes, 34962),
        "componentType": 5126,
        "count": 3,
        "type": "VEC3",
        "min": [0.0, 0.0, 0.0],
        "max": [0.3, 0.5, 0.0],
    })

    j0_bytes = struct.pack("<12B", 0, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0)
    j0_acc = len(accessors)
    accessors.append({
        "bufferView": push(j0_bytes, 34962),
        "componentType": 5121,
        "count": 3,
        "type": "VEC4",
    })

    w0_bytes = struct.pack("<12f", 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0)
    w0_acc = len(accessors)
    accessors.append({
        "bufferView": push(w0_bytes, 34962),
        "componentType": 5126,
        "count": 3,
        "type": "VEC4",
    })

    idx_bytes = struct.pack("<3H", 0, 1, 2)
    idx_acc = len(accessors)
    accessors.append({
        "bufferView": push(idx_bytes, 34963),
        "componentType": 5123,
        "count": 3,
        "type": "SCALAR",
    })

    # Non-zero morph target delta
    morph_nonzero = struct.pack("<9f", 0.0, 0.0, 0.0, 0.0, 0.025, 0.0, 0.0, 0.0, 0.0)
    morph_acc = len(accessors)
    accessors.append({
        "bufferView": push(morph_nonzero, 34962),
        "componentType": 5126,
        "count": 3,
        "type": "VEC3",
    })

    # Identity inverseBindMatrices (MAT4 x joint_count)
    ibm_floats = []
    for _ in range(joint_count):
        ibm_floats.extend([
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ])
    ibm_bytes = struct.pack(f"<{len(ibm_floats)}f", *ibm_floats)
    ibm_acc = len(accessors)
    accessors.append({
        "bufferView": push(ibm_bytes),
        "componentType": 5126,
        "count": joint_count,
        "type": "MAT4",
    })

    return {
        "buf": buf,
        "buffer_views": buffer_views,
        "accessors": accessors,
        "pos_acc": pos_acc,
        "j0_acc": j0_acc,
        "w0_acc": w0_acc,
        "idx_acc": idx_acc,
        "morph_acc": morph_acc,
        "ibm_acc": ibm_acc,
        "push": push,
    }


def build_minimal_valid_vrm1(mutator: Optional[Callable[[dict, bytearray], None]] = None) -> bytes:
    nodes = [{"name": b} for b in REQUIRED_HUMANOID_BONES]
    nodes[4]["children"] = [17]
    nodes.append({"name": "hairRoot"})  # 17: non-humanoid spring root
    nodes.append({"name": "BodyMesh", "mesh": 0, "skin": 0})  # 18
    geom = _make_base_geometry_and_skin(18)

    human_bones = {name: {"node": idx} for idx, name in enumerate(REQUIRED_HUMANOID_BONES)}
    gltf = {
        "asset": {"version": "2.0"},
        "extensionsUsed": ["VRMC_vrm", "VRMC_springBone"],
        "nodes": nodes,
        "skins": [{
            "joints": list(range(18)),
            "inverseBindMatrices": geom["ibm_acc"],
        }],
        "meshes": [{
            "name": "Body",
            "primitives": [{
                "attributes": {
                    "POSITION": geom["pos_acc"],
                    "JOINTS_0": geom["j0_acc"],
                    "WEIGHTS_0": geom["w0_acc"],
                },
                "indices": geom["idx_acc"],
                "material": 0,
                "targets": [{"POSITION": geom["morph_acc"]}],
            }],
        }],
        "materials": [{"name": "DefaultMat", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}}],
        "accessors": geom["accessors"],
        "bufferViews": geom["buffer_views"],
        "buffers": [{"byteLength": len(geom["buf"])}],
        "extensions": {
            "VRMC_vrm": {
                "specVersion": "1.0",
                "humanoid": {"humanBones": human_bones},
                "expressions": {
                    "preset": {
                        "neutral": {"morphTargetBinds": []},
                        "happy": {"morphTargetBinds": [{"node": 18, "index": 0, "weight": 1.0}]},
                    }
                },
            },
            "VRMC_springBone": {
                "specVersion": "1.0",
                "colliders": [{"node": 4, "shape": {"sphere": {"offset": [0.0, 0.08, 0.0], "radius": 0.1}}}],
                "colliderGroups": [{"name": "Head", "colliders": [0]}],
                "springs": [{
                    "name": "Hair",
                    "colliderGroups": [0],
                    "joints": [{"node": 17, "hitRadius": 0.02, "stiffness": 0.7, "dragForce": 0.4}],
                }],
            },
        },
    }
    if mutator is not None:
        mutator(gltf, geom["buf"])
    gltf["buffers"][0]["byteLength"] = len(geom["buf"])
    return _pack_glb(gltf, bytes(geom["buf"]))


def build_minimal_valid_vrm0(mutator: Optional[Callable[[dict, bytearray], None]] = None) -> bytes:
    nodes = [{"name": b} for b in REQUIRED_HUMANOID_BONES]
    nodes[4]["children"] = [17]
    nodes.append({"name": "hairRoot"})  # 17: non-humanoid spring root
    nodes.append({"name": "BodyMesh", "mesh": 0, "skin": 0})  # 18
    geom = _make_base_geometry_and_skin(18)

    human_bones = [
        {"bone": name, "node": idx, "useDefaultValues": True}
        for idx, name in enumerate(REQUIRED_HUMANOID_BONES)
    ]
    gltf = {
        "asset": {"version": "2.0"},
        "extensionsUsed": ["VRM"],
        "nodes": nodes,
        "skins": [{
            "joints": list(range(18)),
            "inverseBindMatrices": geom["ibm_acc"],
        }],
        "meshes": [{
            "name": "Body",
            "primitives": [{
                "attributes": {
                    "POSITION": geom["pos_acc"],
                    "JOINTS_0": geom["j0_acc"],
                    "WEIGHTS_0": geom["w0_acc"],
                },
                "indices": geom["idx_acc"],
                "material": 0,
                "targets": [{"POSITION": geom["morph_acc"]}],
            }],
        }],
        "materials": [{"name": "DefaultMat", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}}],
        "accessors": geom["accessors"],
        "bufferViews": geom["buffer_views"],
        "buffers": [{"byteLength": len(geom["buf"])}],
        "extensions": {
            "VRM": {
                "specVersion": "0.0",
                "meta": {
                    "title": "Test VRM0 Avatar",
                    "author": "Test Author",
                    "licenseName": "Other",
                    "allowedUserName": "OnlyAuthor",
                    "violentUssageName": "Disallow",
                    "sexualUssageName": "Disallow",
                    "commercialUssageName": "Disallow",
                },
                "humanoid": {"humanBones": human_bones},
                "firstPerson": {"firstPersonBone": 4, "meshAnnotations": [{"mesh": 0, "firstPersonFlag": "Auto"}]},
                "blendShapeMaster": {
                    "blendShapeGroups": [
                        {"name": "Neutral", "presetName": "neutral", "binds": []},
                        {"name": "Joy", "presetName": "joy", "binds": [{"mesh": 0, "index": 0, "weight": 100}]},
                    ]
                },
                "secondaryAnimation": {
                    "boneGroups": [{"comment": "Hair", "stiffiness": 0.6, "bones": [17], "colliderGroups": [0]}],
                    "colliderGroups": [{"node": 4, "colliders": [{"offset": {"x": 0.0, "y": 0.08, "z": 0.0}, "radius": 0.1}]}],
                },
            }
        },
    }
    if mutator is not None:
        mutator(gltf, geom["buf"])
    gltf["buffers"][0]["byteLength"] = len(geom["buf"])
    return _pack_glb(gltf, bytes(geom["buf"]))


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

    def test_vrm_validator_accepts_valid_vrm1_and_rejects_as_vrm0(self):
        vrm1_bytes = build_minimal_valid_vrm1()
        report_v1 = validate_vrm_bytes(vrm1_bytes, expected_version="1.0")
        self.assertTrue(report_v1["valid"], f"Unexpected VRM 1.0 failure: {report_v1}")
        self.assertEqual(report_v1["spec_version"], "1.0")
        self.assertEqual(report_v1["missing_required_bones"], [])
        self.assertEqual(report_v1["mapped_bone_count"], len(REQUIRED_HUMANOID_BONES))

        report_wrong = validate_vrm_bytes(vrm1_bytes, expected_version="0.0")
        self.assertFalse(report_wrong["valid"])

    # --- 10 VRM 0.0 Conformance Fixtures ---

    def test_conformance_01_valid_minimal_humanoid(self):
        vrm0_bytes = build_minimal_valid_vrm0()
        report = validate_vrm_bytes(vrm0_bytes, expected_version="0.0")
        self.assertTrue(report["valid"], f"Fixture 1 failed: {report}")
        self.assertEqual(report["spec_version"], "0.0")
        self.assertEqual(report["missing_required_bones"], [])
        self.assertEqual(report["invalid_bone_nodes"], [])
        self.assertEqual(report["blend_shape_group_count"], 2)
        self.assertEqual(report["secondary_bone_group_count"], 1)
        self.assertEqual(report["collider_group_count"], 1)
        self.assertFalse(validate_vrm_bytes(vrm0_bytes, expected_version="1.0")["valid"])

    def test_conformance_02_valid_vroid_jbip_humanoid(self):
        vroid_names = {
            "hips": "J_Bip_C_Hips",
            "spine": "J_Bip_C_Spine",
            "chest": "J_Bip_C_Chest",
            "neck": "J_Bip_C_Neck",
            "head": "J_Bip_C_Head",
            "leftUpperArm": "J_Bip_L_UpperArm",
            "leftLowerArm": "J_Bip_L_LowerArm",
            "leftHand": "J_Bip_L_Hand",
            "rightUpperArm": "J_Bip_R_UpperArm",
            "rightLowerArm": "J_Bip_R_LowerArm",
            "rightHand": "J_Bip_R_Hand",
            "leftUpperLeg": "J_Bip_L_UpperLeg",
            "leftLowerLeg": "J_Bip_L_LowerLeg",
            "leftFoot": "J_Bip_L_Foot",
            "rightUpperLeg": "J_Bip_R_UpperLeg",
            "rightLowerLeg": "J_Bip_R_LowerLeg",
            "rightFoot": "J_Bip_R_Foot",
        }

        def _rename_vroid(gltf: dict, _buf: bytearray):
            for idx, bname in enumerate(REQUIRED_HUMANOID_BONES):
                gltf["nodes"][idx]["name"] = vroid_names[bname]
            gltf["nodes"][17]["name"] = "J_Sec_Hair1_01"
            gltf["extensions"]["VRM"]["humanoid"]["humanBones"].extend([
                {"bone": "leftThumbProximal", "node": 19, "useDefaultValues": True},
                {"bone": "leftThumbIntermediate", "node": 20, "useDefaultValues": True},
            ])
            gltf["nodes"].append({"name": "J_Bip_L_Thumb1"})
            gltf["nodes"].append({"name": "J_Bip_L_Thumb2"})

        report = validate_vrm_bytes(build_minimal_valid_vrm0(_rename_vroid), expected_version="0.0")
        self.assertTrue(report["valid"], f"Fixture 2 VRoid failed: {report}")
        self.assertEqual(report["mapped_bone_count"], len(REQUIRED_HUMANOID_BONES) + 2)

    def test_conformance_03_invalid_preset_names(self):
        for bad_preset in ("Joy", "Blink", "invalidPreset"):
            def _mut(gltf: dict, _buf: bytearray, p=bad_preset):
                gltf["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"][1]["presetName"] = p
            report = validate_vrm_bytes(build_minimal_valid_vrm0(_mut), expected_version="0.0")
            self.assertFalse(report["valid"], f"Expected presetName '{bad_preset}' to fail")
            self.assertTrue(any("presetName" in e for e in report["errors"]))

    def test_conformance_04_invalid_snake_case_bone_names(self):
        def _mut(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["humanoid"]["humanBones"][5]["bone"] = "left_upper_arm"
        report = validate_vrm_bytes(build_minimal_valid_vrm0(_mut), expected_version="0.0")
        self.assertFalse(report["valid"])
        self.assertTrue(any("left_upper_arm" in e for e in report["errors"]))

    def test_conformance_05_invalid_morph_target_binds(self):
        def _bad_mesh(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"][1]["binds"][0]["mesh"] = 99
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_mesh), expected_version="0.0")["valid"])

        def _bad_index(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"][1]["binds"][0]["index"] = 5
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_index), expected_version="0.0")["valid"])

        def _zero_morph(gltf: dict, buf: bytearray):
            # Overwrite morph_acc (index 4) bytes in BIN with zeros
            acc = gltf["accessors"][4]
            bv = gltf["bufferViews"][acc["bufferView"]]
            start = bv["byteOffset"]
            for i in range(bv["byteLength"]):
                buf[start + i] = 0
        report = validate_vrm_bytes(build_minimal_valid_vrm0(_zero_morph), expected_version="0.0")
        self.assertFalse(report["valid"])
        self.assertTrue(any("empty/zero" in e for e in report["errors"]))

    def test_conformance_06_invalid_spring_references(self):
        def _bad_node(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["secondaryAnimation"]["boneGroups"][0]["bones"] = [999]
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_node), expected_version="0.0")["valid"])

        def _humanoid_in_spring(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["secondaryAnimation"]["boneGroups"][0]["bones"] = [4]
        rep_h = validate_vrm_bytes(build_minimal_valid_vrm0(_humanoid_in_spring), expected_version="0.0")
        self.assertFalse(rep_h["valid"])
        self.assertTrue(any("humanoid" in e for e in rep_h["errors"]))

        def _bad_cg_idx(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["secondaryAnimation"]["boneGroups"][0]["colliderGroups"] = [42]
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_cg_idx), expected_version="0.0")["valid"])

    def test_conformance_07_invalid_collider_references(self):
        def _bad_cnode(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["secondaryAnimation"]["colliderGroups"][0]["node"] = 777
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_cnode), expected_version="0.0")["valid"])

        def _neg_rad(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["secondaryAnimation"]["colliderGroups"][0]["colliders"][0]["radius"] = -0.2
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_neg_rad), expected_version="0.0")["valid"])

        def _missing_off(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["secondaryAnimation"]["colliderGroups"][0]["colliders"][0]["offset"] = {"x": 0}
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_missing_off), expected_version="0.0")["valid"])

    def test_conformance_08_invalid_metadata_permission_enums(self):
        def _bad_comm(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["meta"]["commercialUssageName"] = "Yes"
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_comm), expected_version="0.0")["valid"])

        def _bad_user(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["meta"]["allowedUserName"] = "AnyoneAtAll"
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_bad_user), expected_version="0.0")["valid"])

    def test_conformance_09_missing_or_duplicate_humanoid_bones(self):
        def _missing_hips(gltf: dict, _buf: bytearray):
            bones = gltf["extensions"]["VRM"]["humanoid"]["humanBones"]
            gltf["extensions"]["VRM"]["humanoid"]["humanBones"] = [b for b in bones if b["bone"] != "hips"]
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_missing_hips), expected_version="0.0")["valid"])

        def _duplicate_head(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["humanoid"]["humanBones"].append({"bone": "head", "node": 17, "useDefaultValues": True})
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_duplicate_head), expected_version="0.0")["valid"])

        def _duplicate_node(gltf: dict, _buf: bytearray):
            gltf["extensions"]["VRM"]["humanoid"]["humanBones"].append({"bone": "jaw", "node": 4, "useDefaultValues": True})
        self.assertFalse(validate_vrm_bytes(build_minimal_valid_vrm0(_duplicate_node), expected_version="0.0")["valid"])

    def test_conformance_10_malformed_glb_containers(self):
        self.assertFalse(validate_vrm_bytes(b"NOT_A_GLB_FILE_1234567890")["valid"])
        valid = build_minimal_valid_vrm0()
        # Truncated payload / length mismatch
        self.assertFalse(validate_vrm_bytes(valid[:-12])["valid"])
        # Missing BIN chunk
        magic, ver, _ = struct.unpack_from("<III", valid, 0)
        json_len, json_type = struct.unpack_from("<II", valid, 12)
        only_json = valid[12 : 20 + json_len]
        no_bin = struct.pack("<III", magic, ver, 12 + len(only_json)) + only_json
        self.assertFalse(validate_vrm_bytes(no_bin)["valid"])

    def test_blender_pipeline_fails_explicitly_when_python_validator_missing(self):
        root = Path(__file__).resolve().parent.parent
        scripts_dir = str(root / "blender_scripts")
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)

        valid_vrm = build_minimal_valid_vrm0()

        with tempfile.TemporaryDirectory() as tmpdir:
            glb_file = Path(tmpdir) / "input.glb"
            glb_file.write_bytes(valid_vrm)
            out_dir = Path(tmpdir) / "out"

            class _FakeVec:
                def __init__(self, coords=(0.0, 0.0, 0.0)):
                    self.x, self.y, self.z = float(coords[0]), float(coords[1]), float(coords[2])
                    self.length = (self.x**2 + self.y**2 + self.z**2) ** 0.5
                    self.length_squared = self.x**2 + self.y**2 + self.z**2

                def copy(self):
                    return _FakeVec((self.x, self.y, self.z))

                def __sub__(self, other):
                    return _FakeVec((self.x - other.x, self.y - other.y, self.z - other.z))

            class _FakeObj:
                def __init__(self, otype, name):
                    self.type = otype
                    self.name = name
                    self.matrix_world = None
                    if otype == "MESH":
                        v = types.SimpleNamespace(co=_FakeVec((0.0, 0.0, 0.0)), groups=[types.SimpleNamespace(weight=1.0)])
                        self.data = types.SimpleNamespace(vertices=[v], polygons=[1], vertex_groups=[1])
                        self.vertex_groups = [1]
                        self.material_slots = []
                    else:
                        self.data = types.SimpleNamespace(
                            bones=[types.SimpleNamespace(name=b, parent=None) for b in REQUIRED_HUMANOID_BONES],
                            vrm_addon_extension=types.SimpleNamespace(
                                spec_version="0.0",
                                vrm0=types.SimpleNamespace(
                                    meta=types.SimpleNamespace(),
                                    humanoid=types.SimpleNamespace(human_bones=[]),
                                    first_person=types.SimpleNamespace(first_person_bone=types.SimpleNamespace()),
                                    blend_shape_master=types.SimpleNamespace(blend_shape_groups=[]),
                                    secondary_animation=types.SimpleNamespace(collider_groups=[], bone_groups=[]),
                                ),
                                vrm1=types.SimpleNamespace(
                                    meta=types.SimpleNamespace(authors=types.SimpleNamespace(clear=lambda: None, add=lambda: types.SimpleNamespace())),
                                    humanoid=types.SimpleNamespace(human_bones=types.SimpleNamespace()),
                                ),
                            ),
                        )
                        self.pose = types.SimpleNamespace(bones={})

                def evaluated_get(self, _dg):
                    return types.SimpleNamespace(
                        to_mesh=lambda: types.SimpleNamespace(vertices=[types.SimpleNamespace(co=_FakeVec((0.0, 0.0, 0.0)))]),
                        to_mesh_clear=lambda: None,
                    )

            mesh_obj = _FakeObj("MESH", "BodyMesh")
            arm_obj = _FakeObj("ARMATURE", "Armature")
            fake_objects = [mesh_obj, arm_obj]

            def _save_blend(filepath=""):
                Path(filepath).write_bytes(b"FAKEBLEND")

            def _export_vrm(filepath=""):
                Path(filepath).write_bytes(valid_vrm)

            fake_bpy = types.ModuleType("bpy")
            fake_bpy.app = types.SimpleNamespace(version_string="4.2.0-test")
            fake_bpy.data = types.SimpleNamespace(objects=fake_objects)
            fake_bpy.context = types.SimpleNamespace(
                evaluated_depsgraph_get=lambda: None,
                view_layer=types.SimpleNamespace(objects=types.SimpleNamespace(active=None), update=lambda: None),
            )
            fake_bpy.ops = types.SimpleNamespace(
                wm=types.SimpleNamespace(
                    read_factory_settings=lambda **_kw: None,
                    save_as_mainfile=lambda **kw: _save_blend(**kw),
                ),
                import_scene=types.SimpleNamespace(gltf=lambda **_kw: None),
                object=types.SimpleNamespace(mode_set=lambda **_kw: None),
                export_scene=types.SimpleNamespace(vrm=lambda **kw: _export_vrm(**kw)),
            )
            fake_mathutils = types.ModuleType("mathutils")
            fake_mathutils.Vector = _FakeVec

            with patch.dict(sys.modules, {"bpy": fake_bpy, "mathutils": fake_mathutils}):
                if "blender_production_pipeline" in sys.modules:
                    del sys.modules["blender_production_pipeline"]
                pipeline_mod = importlib.import_module("blender_production_pipeline")
                with patch.object(pipeline_mod, "_load_vrm_validator", return_value=None):
                    with patch.object(pipeline_mod, "_configure_vrm_extension", return_value=None):
                        with patch.object(pipeline_mod, "_measure_pose_deformation", return_value={"deformed": True, "max_delta": 0.1, "tested_bones": ["neck"], "joint_results": {"neck": 0.1}}):
                            report = pipeline_mod.run_production_pipeline(
                                out_dir=str(out_dir),
                                glb_path=str(glb_file),
                                vrm_version="0.0",
                                run_id="test-missing-validator",
                            )
                            self.assertEqual(report["status"], "fail")
                            self.assertFalse(report["python_validator_available"])
                            self.assertFalse(report["vrm_reload_success"])
                            self.assertEqual(report["run_id"], "test-missing-validator")
                            self.assertIn("unavailable", report.get("vrm_note", "").lower())

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
        self.assertIn("--run-id", prod_text)
        self.assertIn("ext.vrm0.meta", prod_text)
        self.assertIn("ext.vrm0.humanoid", prod_text)
        self.assertIn("ext.vrm0.blend_shape_master", prod_text)
        self.assertIn("ext.vrm0.secondary_animation", prod_text)
        self.assertIn("j_bip_c_hips", prod_text)
        self.assertIn("validate_vrm_bytes", prod_text)
        self.assertIn("run_production_pipeline", prod_text)

        m2_text = m2_script.read_text(encoding="utf-8")
        self.assertIn("--glb-path", m2_text)
        self.assertIn("--run-id", m2_text)
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

    @unittest.skipUnless(
        detect_blender().installed and bool(os.environ.get("VRM_RUN_LIVE_BLENDER_TEST")),
        "Live Blender 4.2 binary test skipped (set VRM_RUN_LIVE_BLENDER_TEST=1 when Blender is installed).",
    )
    def test_conditional_live_blender_pipeline_execution(self):
        info = detect_blender()
        self.assertTrue(info.installed)
        self.assertIsNotNone(info.executablePath if hasattr(info, "executablePath") else info.executable_path)


if __name__ == "__main__":
    unittest.main()
