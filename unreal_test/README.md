# U1 Unreal/VRM4U test fixture

This folder contains the minimal project descriptor and Python commandlet script used for the U1 attempt. The binary plugin is deliberately not committed; it is downloaded into `_tools/downloads` and copied into the scratch project's `Plugins/VRM4U` folder.

- Target engine: Unreal Engine 5.7.4 (`C:/Program Files/Epic Games/UE_5.7`)
- Plugin release: `v1.2026.11.10`, asset `VRM4U_5_7_20261110.zip`
- Release: https://github.com/ruyo/VRM4U/releases/tag/v1.2026.11.10
- Published SHA-256: `8c473169d2ff22f654c2d69f7665b2219e2fcad7dc4cf9459e653a8e1edd8308`

The commandlet probe succeeded and exposed `VrmImporterBPFunctionLibrary.import_vrm_file_with_options`. Calling that editor import API in `UnrealEditor-Cmd.exe -nullrhi` reached VRM4U but crashed in Slate/ContentBrowser (`CurrentApplication.IsValid()` assertion), so no imported asset result is claimed.
