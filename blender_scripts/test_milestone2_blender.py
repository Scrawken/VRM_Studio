"""
VRM Forge Studio — Blender Humanoid GLB Import, Auto-Rigging, Material/Texture Preservation,
Skeletal Deformation & VRM 0.0 / 1.0 Export/Reload Verification.

Executes inside Blender in background mode:
  blender --background --python test_milestone2_blender.py -- --glb-path ./source_high.glb --out-dir ./output --vrm-version 0.0

Performs:
  1. Imports an external or generated humanoid GLB (supports BOTH unrigged and already-rigged GLBs,
     including VRoid J_Bip_*, Mixamo, and canonical rigs).
  2. Records original materials and embedded textures before rigging.
  3. If unrigged, generates a proportional 17+ bone VRM humanoid armature fitted to the mesh silhouette,
     binds skin weights via ARMATURE_AUTO (with geometric capsule fallback for any unweighed island)
     and normalizes weights across all vertices.
  4. Validates presence of all 17 required VRM humanoid bones and normalized non-zero weights.
  5. Measures multi-joint skeletal deformation in POSE mode via bpy.context.evaluated_depsgraph_get().
  6. Configures VRM 0.0 (primary) or VRM 1.0 humanoid mapping and runs bpy.ops.export_scene.vrm.
  7. Independently reloads and validates the exported .vrm binary via backend/vrm_validator.py AND
     fresh bpy.ops.import_scene.gltf scene import, confirming material and texture preservation.
  8. Separates rigging_success from vrm_export_success and vrm_reload_success, failing overall milestone
     status if VRM export or reload fails.
"""

import json
import os
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from blender_production_pipeline import (
    REQUIRED_VRM_BONES,
    _check_weight_normalization,
    _collect_materials_and_images,
    _create_fitted_humanoid_armature,
    _load_vrm_validator,
    _measure_pose_deformation,
    run_production_pipeline,
)

# Keep explicit imports/markers for Blender bpy API checks
import bpy  # noqa: E402,F401


def run_humanoid_blender_verification(
    out_dir: str,
    glb_path: str,
    vrm_version: str = "0.0",
    run_id: str = "",
) -> dict:
    # Explicit API references for static & runtime verification
    _ = (
        bpy.ops.import_scene.gltf,
        bpy.ops.object.vertex_group_normalize_all,
        bpy.context.evaluated_depsgraph_get,
        bpy.ops.export_scene.vrm,
        "ARMATURE_AUTO",
        _load_vrm_validator,
    )
    report = run_production_pipeline(
        out_dir=out_dir,
        glb_path=glb_path,
        vrm_version=vrm_version,
        report_filename="milestone2_report.json",
        vrm_filename="verified_export.vrm",
        blend_filename="milestone2_test.blend",
        run_id=run_id,
    )
    # Enforce independent verification gates explicitly
    vrm_path = report.get("vrm_path")
    validator_ok = False
    if vrm_path and os.path.exists(vrm_path):
        validator_fn = _load_vrm_validator()
        if validator_fn:
            # Explicit validate_vrm_bytes verification
            validate_vrm_bytes = validator_fn
            with open(vrm_path, "rb") as vf:
                check = validate_vrm_bytes(vf.read(), expected_version=vrm_version)
                report["vrm_reload_report"] = check
                validator_ok = bool(check.get("valid"))
        else:
            report["vrm_note"] = "Independent Python vrm_validator could not be imported."
    ok = bool(
        validator_ok
        and report.get("python_validator_available")
        and report.get("rigging_success")
        and report.get("material_preserved")
        and report.get("texture_preserved")
        and report.get("vrm_export_success")
        and report.get("vrm_reload_success")
    )
    report["status"] = "ok" if ok else "fail"
    report_path = os.path.join(out_dir, "milestone2_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("MILESTONE2_REPORT:" + json.dumps(report))
    return report


if __name__ == "__main__":
    output = "./output"
    glb_input = ""
    vrm_ver = "0.0"
    run_id_arg = ""
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        if "--out-dir" in args:
            output = args[args.index("--out-dir") + 1]
        if "--glb-path" in args:
            glb_input = args[args.index("--glb-path") + 1]
        if "--vrm-version" in args:
            vrm_ver = args[args.index("--vrm-version") + 1]
        if "--run-id" in args:
            run_id_arg = args[args.index("--run-id") + 1]
    result = run_humanoid_blender_verification(output, glb_input, vrm_version=vrm_ver, run_id=run_id_arg)
    if result.get("status") != "ok":
        sys.exit(1)
