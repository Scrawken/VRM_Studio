# VRM Forge Studio — E3 Corrected Quality Benchmarks

## Result

E1's main verdict was partly a harness bug. The portable Blender did have VRM Format 4.10.5 installed as the extension `bl_ext.user_default.vrm`; E1 used the obsolete `io_scene_vrm` check and also used a pose-space/joint-radius method that missed weighted vertices. This report replaces those results.

The corrected harness now imports both `.vrm` and `.glb` for Aurelia, Vaelith and Marcus in Blender 4.2.23. The VRM and GLB lanes produce closely matching displacement values. The shoulder pose is measurable after selecting the best local Euler axis, not degenerate.

The appearance assessment remains unchanged: the samples are stylized and do not meet the proposed “detailed, realistic humanoids” bar. The deformation result is now evidence-based, but no product pass/fail threshold was silently promoted to a requirement.

## Exact commands

The work used read-only source assets and wrote scratch results to `_staging/tmp/e3`:

```bash
BL=F:/Projects/vrm-forge-studio/_tools/blender-4.2/blender-4.2.23-windows-x64/blender.exe
"$BL" --background --python-expr \
  "import bpy; print(hasattr(bpy.types.Armature,'vrm_addon_extension'))"
"$BL" --background -P benchmarks/deform_bench_v2.py -- \
  F:/Projects/vrm-forge-studio/projects/armored_paladin_aurelia/character.vrm \
  F:/Projects/vrm-forge-studio/_staging/tmp/e3 aurelia_vrm
```

The command must not use `--factory-startup`; the script also avoids `read_factory_settings`, because either resets the portable user extension state. The actual six-lane run was this same command for each `.vrm` and `.glb` in Aurelia, Vaelith and Marcus. Results are copied into `benchmarks/*_deform_v2.json`.

## Runtime verification

- Blender: **4.2.23 LTS**.
- VRM extension: `bl_ext.user_default.vrm`, VRM Format **4.10.5**.
- `hasattr(bpy.types.Armature, 'vrm_addon_extension')`: **True**.
- `hasattr(bpy.ops.import_scene, 'vrm')`: **True**.
- All three `.vrm` files imported successfully through `bpy.ops.import_scene.vrm`.
- All three `.glb` files imported successfully through `bpy.ops.import_scene.gltf`.
- Each lane passed the synthetic control; JSON records `max_displacement_m = 0.141421` and `pass = true`.

## Corrected deformation table

`max weighted displacement` is the maximum displacement among vertices with weight >0.3 to the target bone or any descendant. The selected axis is the local pose Euler axis that moved the target's descendant tip most; the harness records target-tail movement before measuring. Weighted vertex totals are included to expose coverage.

| Sample | Pose | Local axis | Weighted vertices | Max weighted displacement (m) | VRM vs GLB | Verdict |
|---|---|---:|---:|---:|---|---|
| Aurelia | elbow 90° | 0 | 435 | 0.520 | match | measurable |
| Aurelia | knee 90° | 0 | 532 | 0.670 | match | measurable |
| Aurelia | shoulder abduction 80° | 1 | 923 | 0.791 | match | measurable |
| Aurelia | neck 45° | 0 | 8,686 | 0.255 | match | measurable |
| Aurelia | hip flexion 70° | 0 | 600 | 1.016 | match | measurable; inspect large motion |
| Aurelia | spine bend 30° | 0 | 15,217 | 0.496 | match | measurable |
| Vaelith | elbow 90° | 0 | 435 | 0.561 | match | measurable |
| Vaelith | knee 90° | 0 | 532 | 0.755 | match | measurable |
| Vaelith | shoulder abduction 80° | 1 | 923 | 0.868 | match | measurable |
| Vaelith | neck 45° | 0 | 10,719 | 0.425 | match | measurable |
| Vaelith | hip flexion 70° | 0 | 600 | 1.147 | match | measurable; inspect large motion |
| Vaelith | spine bend 30° | 0 | 14,940 | 0.508 | match | measurable |
| Marcus | elbow 90° | 0 | 302 | 0.501 | match | measurable |
| Marcus | knee 90° | 0 | 448 | 0.629 | match | measurable |
| Marcus | shoulder abduction 80° | 1 | 336 | 0.754 | match | measurable |
| Marcus | neck 45° | 0 | 9,340 | 0.236 | match | measurable |
| Marcus | hip flexion 70° | 0 | 516 | 0.956 | match | measurable; inspect large motion |
| Marcus | spine bend 30° | 0 | 10,901 | 0.416 | match | measurable |

The corrected results disprove E1's “zero body displacement” and “axis degenerate” conclusions. Those were harness errors, not evidence that the assets lack limb weights. The high hip displacement is a genuine signal from the corrected measurement, but requires visual review before calling it a defect.

## Weight coverage and degenerate faces

The old `FaceAndBodyMesh`-only measurement was misleading: limb weights are primarily in outfit/armor meshes for these generated characters. Corrected target/descendant coverage includes, for example, Aurelia elbow: 407 armor + 28 secondary-accent vertices; Aurelia shoulder: 765 armor + 158 secondary-accent vertices; Marcus shoulder: 119 armor + 217 body vertices. Full per-mesh maps are in the JSON evidence.

Rest-state degenerate-face counts are stable across pose tests and are not the 128 universal pose failures reported by E1:

| Sample | Rest degenerate faces found |
|---|---|
| Aurelia | FaceAndBodyMesh 128; EyesMesh 80; HairMesh 24; other meshes 0 |
| Vaelith | FaceAndBodyMesh 128; EyesMesh 80; HairMesh 24; other meshes 0 |
| Marcus | FaceAndBodyMesh 128; EyesMesh 80; HairMesh 24; other meshes 0 |

No tested pose increased these degenerate-face counts in the corrected run. They are genuine baseline asset-geometry findings, but the old report incorrectly presented the FaceAndBody count as a pose-created failure. BVH overlap counts remain diagnostic only because coincident separate meshes can inflate them.

## Synthetic control

The same script creates four points representing a child segment of a two-bone cylinder and rotates the child 90° around local Z. It reports `0.141421 m` maximum displacement and passes a `>0.1 m` sanity threshold in every lane. This proves the measurement path responds to a known-correct pose; it does not prove every production deformation is good.

## Appearance verdict

The corrected deformation harness does not change the visual assessment. Aurelia has a clear armor/cloak silhouette but simple face, hair and hands. Vaelith has strong hair/cloak contrast but uniformly 256² textures and simple facial/hand forms. Marcus has broad, low-detail face and clothing forms and is the most mannequin-like. All three remain **below** the proposed “detailed, realistic humanoids” appearance bar.

## Proposed improvements (not applied)

1. Inspect the source sculptors and exporter for the baseline 128 body, 80 eye and 24 hair degenerate faces; these are genuine asset-quality issues. Proposed files: `src/shared/sculptors/*`, `vrmBuilder.ts`.
2. Add visual pose snapshots and per-mesh collision review for the large corrected hip displacements (0.956–1.147m). Do not alter source generation until screenshots identify the failing region.
3. Keep the corrected benchmark as the regression harness: local-axis selection, target/descendant weights, target-tail movement check, per-mesh degeneracy, and synthetic control. Proposed file: `benchmarks/deform_bench_v2.py`.
4. Add a pinned VRM extension/runtime preflight to the benchmark README or local CI.

## Remaining untested

Unreal Engine/VRM4U import, retargeting, morph playback, spring physics and UE material behavior remain untested. The updated acceptance protocol is in `docs/UNREAL_VRM4U_CHECKLIST.md`.
