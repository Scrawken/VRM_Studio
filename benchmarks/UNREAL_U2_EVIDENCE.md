# U2 bounded Unreal/VRM4U retry evidence

U2 reused the project-local VRM4U UE5.7 binary from U1 in a fresh scratch project at `F:/Projects/vrm-forge-studio/_staging/tmp/u2/VRM4UTest`. No engine files were changed.

## Route A — `AssetImportTask`

Command:

```text
UnrealEditor-Cmd.exe F:/Projects/vrm-forge-studio/_staging/tmp/u2/VRM4UTest/VRM4UTest.uproject -run=PythonScript -script=F:/Projects/vrm-forge-studio/_staging/tmp/u2/VRM4UTest/route_a.py -unattended -nop4 -nosplash -nullrhi -NoSound
```

The script used `unreal.AssetImportTask`, `automated=True`, `save=True`, destination `/Game/VRM`, and `AssetToolsHelpers.get_asset_tools().import_asset_tasks`. It failed before returning task results:

```text
Assertion failed: CurrentBaseApplication.IsValid()
Engine/Source/Runtime/SlateCore/Public/Application/SlateApplicationBase.h:554
```

This is a headless Slate/ContentBrowser failure in the standard AssetTools route. Log: `_staging/tmp/u2/logs/route_a.log`.

## Route B — rendered editor + post-tick

Command:

```text
UnrealEditor.exe F:/Projects/vrm-forge-studio/_staging/tmp/u2/VRM4UTest/VRM4UTest.uproject -unattended -nop4 -nosplash -NoSound -ExecutePythonScript=F:/Projects/vrm-forge-studio/_staging/tmp/u2/VRM4UTest/route_b.py
```

The script registered `unreal.register_slate_post_tick_callback`, waited for 20 ticks, then attempted the VRM4U import and `quit_editor()`. The editor loaded with rendering, mounted VRM4U and logged `U2_TICK_REGISTERED`, but no `U2_TICK_RESULT` or `U2_TICK_ERROR` was produced before the editor window was destroyed. No assets or import result are claimed. Log: `_staging/tmp/u2/logs/route_b.log`.

## Route C — plugin commandlet

The plugin source was searched for commandlet implementations. No VRM4U commandlet was found; the only `Commandlet` matches were unrelated camera/render source references. Route unavailable.

## Result matrix

| Input | AssetImportTask | Rendered post-tick | Commandlet | Assets/bone/morph/physics/meta evidence |
|---|---|---|---|---|
| Aurelia | blocked by SlateCore assertion | no result before editor exit | unavailable | none |
| Vaelith | blocked before per-sample result | not reached after bounded first-sample attempt | unavailable | none |
| Marcus | blocked before per-sample result | not reached after bounded first-sample attempt | unavailable | none |
| Blender `coord42c/out0.0/verified_export.vrm` | not reached | not reached | unavailable | none |

No per-sample import success is claimed. No skeletal mesh, bone count, morph count, material count, physics asset, spring-bone asset or VRM metadata result is claimed.

## Cheapest next step

Run the same `import_test.py` from an interactive Unreal Editor session with a real Slate application and allow the editor to remain open until the import callback finishes, or add a small C++ project commandlet that invokes VRM4U’s factory without ContentBrowser/Slate. The current headless routes are not evidence of model incompatibility.

No UnrealEditor processes remained after the bounded runs.
