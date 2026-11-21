# U1 Unreal/VRM4U Evidence

## Release and environment

- Unreal Engine 5.7.4 (`++UE5+Release-5.7-CL-51494982`) was selected because the machine has UE 5.7 and the upstream release provides a matching binary.
- VRM4U release: `v1.2026.11.10`, asset `VRM4U_5_7_20261110.zip`.
- URL: https://github.com/ruyo/VRM4U/releases/download/v1.2026.11.10/VRM4U_5_7_20261110.zip
- Release page: https://github.com/ruyo/VRM4U/releases/tag/v1.2026.11.10
- Published SHA-256: `8c473169d2ff22f654c2d69f7665b2219e2fcad7dc4cf9459e653a8e1edd8308`.
- Local download: `F:/Projects/vrm-forge-studio/_tools/downloads/VRM4U_5_7_20261110.zip`; computed SHA matched.
- The same release also published `VRM4U_5_8_20261110.zip` with published SHA `fde4548e66db05562acbcaa485a802c574fefbe636b0a1befb63824130ba7a0d`; it was not selected because this run targeted UE 5.7.

## Project and commands

The scratch project was created at `F:/Projects/vrm-forge-studio/_staging/tmp/u1/VRM4UTest`, with the plugin under its project-local `Plugins/VRM4U` folder. The three read-only source VRMs were copied to `F:/Projects/vrm-forge-studio/_staging/tmp/u1/inputs/`.

```text
UnrealEditor-Cmd.exe .../VRM4UTest.uproject -run=DerivedDataCache -unattended -nop4 -nosplash -nullrhi -NoSound
UnrealEditor-Cmd.exe .../VRM4UTest.uproject -run=PythonScript \
  -script=.../Scripts/probe2.py -unattended -nop4 -nosplash -nullrhi -NoSound
UnrealEditor-Cmd.exe .../VRM4UTest.uproject -run=PythonScript \
  -script=.../Scripts/import_test.py -unattended -nop4 -nosplash -nullrhi -NoSound
UnrealEditor.exe .../VRM4UTest.uproject -unattended -nop4 -nosplash -NoSound \
  -ExecutePythonScript=.../Scripts/import_test.py
```

The repository copy of the fixture is `unreal_test/`. The full scratch log is `F:/Projects/vrm-forge-studio/_staging/tmp/u1/VRM4UTest/Saved/Logs/VRM4UTest.log`.

## Results

| Sample | VRM4U import call | Skeletal mesh | Bones | Morphs | Physics/meta assets | Status |
|---|---|---|---:|---:|---|---|
| Aurelia | reached API, then process crash | no trustworthy result | — | — | — | **UNTESTED/BLOCKED** |
| Vaelith | not reached after first crash | no result | — | — | — | **UNTESTED/BLOCKED** |
| Marcus | not reached after first crash | no result | — | — | — | **UNTESTED/BLOCKED** |

The Python commandlet probe itself succeeded. It exposed `unreal.VrmImporterBPFunctionLibrary.import_vrm_file_with_options` and `unreal.ImportOptionData`. The import script called that API with morph targets enabled, physics enabled and degenerate-triangle removal enabled. During the first import, VRM4U reached its importer/loader modules, then Unreal aborted with:

```text
Assertion failed: CurrentApplication.IsValid()
Engine/Source/Runtime/Slate/Public/Framework/Application/SlateApplication.h:321
Callstack: UnrealEditor-Slate.dll -> ContentBrowser.dll -> UnrealEditor-VRM4ULoader.dll -> UnrealEditor-VRM4UImporter.dll
```

This is a headless Slate/ContentBrowser blocker, not evidence of a successful or failed model import. A GUI editor attempt was made with `UnrealEditor.exe`, but it did not produce a trustworthy per-sample result before the same process/log state; no assets are claimed.

## Checklist status

- UE 5.7 executable: **PASS** (version recorded above).
- Matching VRM4U 5.7 binary downloaded and SHA-256 verified: **PASS**.
- Project-local plugin placement and enabled `.uproject`: **PASS**.
- Python commandlet and VRM4U reflection/API discovery: **PASS**.
- VRM4U import for Aurelia/Vaelith/Marcus: **UNTESTED/BLOCKED** by the reproducible headless Slate assertion.
- Skeletal mesh, bone count, morph count, spring/physics assets, VRM metadata: **UNTESTED**.
- GUI import, visual deformation, retargeting, morph playback, spring physics and material behavior: **UNTESTED**.

No owner action is required for the release download. A real import needs a supported interactive editor route or a VRM4U commandlet-safe import path that does not access Slate/ContentBrowser during headless execution.
