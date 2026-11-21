# VRM Forge Studio — E3 Corrected Quality Benchmarks

## Result

E1's main verdict was partly a harness bug. The portable Blender did have VRM Format 4.10.5 installed as the extension `bl_ext.user_default.vrm`; E1 used the obsolete `io_scene_vrm` check and also used a pose-space/joint-radius method that missed weighted vertices. This report replaces those results.

The corrected harness now imports both `.vrm` and `.glb` for Aurelia, Vaelith and Marcus in Blender 4.2.23. The VRM and GLB lanes produce closely matching displacement values. The shoulder pose is measurable after selecting the best local Euler axis, not degenerate.

The appearance assessment remains unchanged: the samples are stylized and do not meet the proposed “detailed, realistic humanoids” bar. The deformation result is now evidence-based, but no product pass/fail threshold was silently promoted to a requirement.

## S1 root cause and fix

The repeated triangles came from three systematic generator patterns:

- `src/shared/sculptors/faceSculptor.ts:285-306,500-506` emitted both triangles at the north and south poles of the head latitude grid. At each pole, all longitude vertices coincide; the 64-longitude head therefore emitted 128 zero-area triangles.
- `src/shared/sculptors/faceSculptor.ts:539-568` repeated the same sphere-cap pattern for each eye. Two eyes × 20-longitude pole triangles × two poles emitted 80 zero-area triangles.
- `src/shared/sculptors/hairSculptor.ts:42-73` emitted the first cap row of the cranial cap at `phi = 0`, where every longitude vertex coincides, producing 24 zero-area triangles.
- `src/shared/sculptors/meshOps.ts:624-685` emitted a ninth hair-profile vertex equal to profile vertex zero, then connected both as separate profile edges. The index-based E1 count did not include this in the three repeated baseline counts for the sampled outputs, but it was the same class of systematic seam defect. The fix makes the profile eight vertices and closes it with modulo indexing.

The minimal fix skips only pole triangles and removes only the duplicated hair-profile vertex. Vertex attributes remain aligned; no morph/weight entry is dropped independently of its vertex. `benchmarks/degenerate_report.py` records the pre-fix indices/positions and generator mapping.

## Before/after geometry

| Sample | Before: FaceAndBody / Eyes / Hair | After: FaceAndBody / Eyes / Hair | Total after |
|---|---:|---:|---:|
| Aurelia | 128 / 80 / 24 | 0 / 0 / 0 | 0 |
| Vaelith | 128 / 80 / 24 | 0 / 0 / 0 | 0 |
| Marcus | 128 / 80 / 24 | 0 / 0 / 0 | 0 |

The regenerated scratch VRMs and GLBs are under `_staging/tmp/s1`; they were never written over `projects/*`. Corrected benchmark JSON evidence is committed as `benchmarks/s1_*_deform_v2.json`. The regenerated Blender run reported zero degenerate faces for every mesh in every sample.

The regenerated VRM mesh statistics are lower only where the invalid topology was removed: Aurelia 31,044→30,788 triangles and 17,423→16,663 vertices; Vaelith 30,596→30,340 triangles and 17,146→16,411 vertices; Marcus 21,824→21,568 triangles and 12,287→11,802 vertices. Materials, textures, morph target entries, 65 armature bones and max two influences remain unchanged. The vertex reduction is primarily the duplicate profile seam vertices in generated hair; all remaining per-vertex arrays were checked aligned by the unit test.


## Visual comparison

The pole/duplicate-triangle fix is topology-only. Before/after front and face renders are included for review; no intentional visual change was observed.

| Sample | Before | After |
|---|---|---|
| Aurelia | `assets/aurelia_front.png`, `assets/aurelia_face.png` | `assets/s1_after/aurelia_front.png`, `assets/s1_after/aurelia_face.png` |
| Vaelith | `assets/vaelith_front.png`, `assets/vaelith_face.png` | `assets/s1_after/vaelith_front.png`, `assets/s1_after/vaelith_face.png` |
| Marcus | `assets/marcus_front.png`, `assets/marcus_face.png` | `assets/s1_after/marcus_front.png`, `assets/s1_after/marcus_face.png` |

## Exact commands

The work used read-only source assets and wrote scratch results to `_staging/tmp/s1`:

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

Rest-state degenerate-face counts from E3 were a genuine generator-quality finding. S1 removed the systematic triangles; the corrected regenerated outputs report zero in every mesh. The E1/E3 BVH overlap count remains diagnostic only because coincident separate meshes can inflate it.

## Synthetic control

The same script creates four points representing a child segment of a two-bone cylinder and rotates the child 90° around local Z. It reports `0.141421 m` maximum displacement and passes a `>0.1 m` sanity threshold in every lane. This proves the measurement path responds to a known-correct pose; it does not prove every production deformation is good.

## Appearance verdict

The corrected deformation harness does not change the visual assessment. Aurelia has a clear armor/cloak silhouette but simple face, hair and hands. Vaelith has strong hair/cloak contrast but uniformly 256² textures and simple facial/hand forms. Marcus has broad, low-detail face and clothing forms and is the most mannequin-like. All three remain **below** the proposed “detailed, realistic humanoids” appearance bar.

## Proposed improvements (not applied)

1. Inspect the source sculptors and exporter for the baseline 128 body, 80 eye and 24 hair degenerate faces; these are genuine asset-quality issues. Proposed files: `src/shared/sculptors/*`, `vrmBuilder.ts`.
2. Add visual pose snapshots and per-mesh collision review for the large corrected hip displacements (0.956–1.147m). Do not alter source generation until screenshots identify the failing region.
3. Keep the corrected benchmark as the regression harness: local-axis selection, target/descendant weights, target-tail movement check, per-mesh degeneracy, and synthetic control. Proposed file: `benchmarks/deform_bench_v2.py`.
4. Add a pinned VRM extension/runtime preflight to the benchmark README or local CI.

## Validation

The new unit test `src/shared/sculptorGeometry.test.ts` builds all three sample specifications through `parseCharacterPromptFallback`, `buildHumanoidSkeleton` and `buildHighDetailCharacterGeometry`, and checks zero degenerate triangles plus aligned positions/joints/weights/normals/UVs. It passes after the fix. The negative control was the pre-fix sample GLB run through `python -I benchmarks/degenerate_report.py`, which measured 128/80/24; scratch negative-control files were removed.

Commands and results:

```text
npx tsx --test src/shared/sculptorGeometry.test.ts                         PASS
npm run lint                                                               PASS
npx tsx --test server/hostAllowlist.test.ts server/routes.smoke.test.ts \
  src/shared/vrmPipeline.test.ts src/shared/vrmValidator.test.ts \
  src/shared/vrmMetadata.test.ts src/shared/sculptorGeometry.test.ts      54 pass, 1 skipped
npm run test:backend                                                       20 pass, 1 skipped
python -I backend/vrm_validator.py <each regenerated character.vrm> 0.0    3 valid
```

The corrected deformation values are effectively unchanged from E3: the maximum weighted displacement values remain within rounding-level differences in the regenerated outputs (for example Aurelia hip 1.016m, Vaelith hip 1.147m, Marcus hip 0.956m). No deformation regression was observed. Unreal Engine/VRM4U import, retargeting, morph playback, spring physics and UE material behavior remain untested.

## U2 bounded Unreal/VRM4U retry

U2 tried the standard automated `AssetImportTask` route and a full rendered editor route with `register_slate_post_tick_callback`. The automated route failed with `CurrentBaseApplication.IsValid()` at `SlateApplicationBase.h:554` before returning task results. The rendered editor loaded VRM4U and logged `U2_TICK_REGISTERED`, but produced no import result before the editor exited. A source search found no VRM4U commandlet. No sample import or asset counts are claimed. See `benchmarks/UNREAL_U2_EVIDENCE.md` for exact commands, logs and the four-input matrix.

## U1 Unreal/VRM4U attempt

A matching VRM4U UE5.7 binary was downloaded and SHA-256 verified. Unreal 5.7.4 loaded the project-local plugin and Python reflection exposed the non-interactive `VrmImporterBPFunctionLibrary.import_vrm_file_with_options` API. The first import attempt reached VRM4U but Unreal aborted in headless mode on `CurrentApplication.IsValid()` at `SlateApplication.h:321`, through ContentBrowser → VRM4ULoader → VRM4UImporter. Therefore no Unreal import, skeletal mesh, bone, morph, physics, spring or metadata result is claimed for any sample. Full evidence, versions, hashes and paths are in `benchmarks/UNREAL_U1_EVIDENCE.md`.

| Sample | Unreal/VRM4U result |
|---|---|
| Aurelia | UNTESTED/BLOCKED by headless Slate assertion |
| Vaelith | UNTESTED/BLOCKED; first process crashed before a trustworthy call |
| Marcus | UNTESTED/BLOCKED; first process crashed before a trustworthy call |

This does not change the Blender 4.2 or appearance findings. GUI editor import and all Unreal acceptance items remain untested.
