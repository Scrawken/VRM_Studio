"""
VRM Forge Studio: VRM add-on probe.

Usage: blender --background --python blender_scripts/vrm_addon_probe.py

Prints one line: VRM_ADDON=True|False plus detail. The add-on counts as installed only when its
Armature property (vrm_addon_extension) is actually registered after trying to enable it.
hasattr(bpy.ops.export_scene, "vrm") must not be used: bpy.ops resolves any name lazily, so that
test is True even with no add-on installed. Enabling uses default_set=True (needed so the add-on has a preferences entry) but is
non-persistent and runs in --background, so saved user preferences are not modified.
"""
import sys

import bpy

PROP = "vrm_addon_extension"


def registered():
    try:
        return PROP in bpy.types.Armature.bl_rna.properties
    except Exception:
        return False


detail = "registered"
if not registered():
    detail = "not found"
    try:
        import addon_utils

        names = [m.__name__ for m in addon_utils.modules() if "vrm" in m.__name__.lower()]
        errors = []
        for name in names:
            try:
                addon_utils.enable(name, default_set=True, persistent=False)
            except Exception as exc:
                errors.append(f"{name}: {exc}")
            if registered():
                detail = f"enabled {name}"
                break
        else:
            if names:
                detail = "could not register (" + "; ".join(errors or ["no error"]) + ")"
    except Exception as exc:
        detail = f"addon_utils error: {exc}"

print(f"VRM_ADDON={registered()} DETAIL={detail}")
sys.stdout.flush()
