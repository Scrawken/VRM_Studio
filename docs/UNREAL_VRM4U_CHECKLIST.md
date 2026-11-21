# Unreal + VRM4U Acceptance Protocol

**Status:** U1 obtained a matching VRM4U UE5.7 binary and verified the plugin/API loads in Unreal Engine 5.7.4. The first real import attempt is **BLOCKED/UNTESTED**: VRM4U reaches its importer from Python, then Unreal aborts in headless mode on `CurrentApplication.IsValid()` at `SlateApplication.h:321` through ContentBrowser/VRM4ULoader. No skeletal mesh, bone, morph, physics or metadata result is claimed. Full evidence: `benchmarks/UNREAL_U1_EVIDENCE.md`. Blender 4.2.23 VRM Format 4.10.5 imported all three `.vrm` files separately; that is not Unreal/VRM4U evidence. The three first test inputs are `aurelia`, `vaelith`, and `marcus` under `projects/`.

## Evidence rules

For each sample, capture the exact `.vrm` SHA-256, UE version, VRM4U version, import log, Message Log screenshot/export, imported asset paths, and screenshots at the named checkpoints. Mark **PASS** only when every criterion in a section is met; otherwise mark **FAIL** or **UNTESTED**. Do not infer Unreal results from GLB or Blender results.

## 1. Source audit — UNTESTED in the UE/VRM4U protocol

- [ ] **PASS:** Inspector export identifies VRM 0.0; capture the audit panel and file hash.
- [ ] **PASS:** all 17 required humanoid bones are mapped and `Missing Required Bones: 0`; capture the audit panel and imported Skeleton Tree.
- [ ] **PASS:** the expected VRM blend-shape groups are present, including Neutral, Blink/Blink_L/Blink_R, Joy, Angry, Sorrow and A/I/U/E/O; capture the list.
- [ ] **PASS:** title/author and usage metadata match the sample and contain no copied template/sample identity; capture metadata.

## 2. Import — UNTESTED

- [ ] **PASS:** VRM4U is enabled; capture Plugins panel with plugin version.
- [ ] **PASS:** each `.vrm` imports with Model, Skeleton, Skeletal Mesh, Material and Morph Target enabled, VRM0 behavior enabled; capture import options.
- [ ] **PASS:** import completes with zero fatal/errors in Message Log; save the log export.
- [ ] **PASS:** assets exist under `/Game/Characters/<sample>/` with a reproducible asset list.

## 3. Skeleton, deformation and retargeting — UNTESTED

- [ ] **PASS:** Skeleton Tree contains hips/spine/chest/neck/head, both arm and leg chains, fingers and eyes with intact parentage; capture tree.
- [ ] **PASS:** rotate each left/right elbow, knee, shoulder-abduction, neck and hip test joint at the E1 angles (90°, 90°, 80°, 45°, 70°); no detached vertices, exploding triangles or inverted normals in before/after screenshots.
- [ ] **PASS:** IK Rig chains Spine, Head, LeftArm, RightArm, LeftLeg and RightLeg have no unmapped required joints; capture IK Rig.
- [ ] **PASS:** IK Retargeter preview preserves feet contact and sane hip height/scale; capture preview and scale values.

## 4. Morphs — UNTESTED

- [ ] **PASS:** every listed core morph reaches weight 0 and 1 without eyelid/eyeball clipping, mouth tearing or chin collapse; capture 0/1 screenshots and morph list.
- [ ] **PASS:** custom shape keys, if present, are listed and non-destructive; capture list and one preview.

## 5. Spring bones — UNTESTED

- [ ] **PASS:** hair/cloak/ribbon secondary groups react in PIE without penetrating head/torso colliders.
- [ ] **PASS:** hips, arms, legs and feet are not spring bones; capture VRM4U/Animation Blueprint setup.
- [ ] **PASS:** a walk/turn PIE capture shows stable core limbs and responsive secondary motion; attach video or frame sequence.

## 6. Materials and lighting — UNTESTED

- [ ] **PASS:** lit viewport shows non-missing, correctly oriented albedo/base color and expected roughness/metallic values.
- [ ] **PASS:** masked/translucent hair, lashes and overlays have no dark silhouettes, missing backfaces or sorting failure; capture lit screenshots.

## U2 execution matrix (2026-11-21)

| Route/item | Status | Evidence |
|---|---|---|
| `AssetImportTask` automated route | FAIL/BLOCKED | `benchmarks/UNREAL_U2_EVIDENCE.md`; SlateCore `CurrentBaseApplication.IsValid()` assertion |
| Rendered editor + post-tick route | FAIL/BLOCKED | `benchmarks/UNREAL_U2_EVIDENCE.md`; callback registered, no import result before editor exit |
| VRM4U commandlet route | UNTESTED/UNAVAILABLE | no commandlet implementation found in plugin source |
| Four requested inputs imported | UNTESTED | no route produced a trustworthy import result |
| Skeletal mesh/bones/morph/material/physics/meta evidence | UNTESTED | no saved imported assets |

The U2 alternatives did not establish model incompatibility. The cheapest next step is a supported interactive editor import with the Slate application left alive through completion, or a project C++ commandlet that invokes the VRM4U factory without ContentBrowser/Slate.


| Item | Status | Evidence |
|---|---|---|
| UE5.7.4 executable available | PASS | `benchmarks/UNREAL_U1_EVIDENCE.md` |
| VRM4U UE5.7 binary downloaded and hash matched | PASS | release URL/hash in evidence |
| Project-local plugin enabled | PASS | `unreal_test/VRM4UTest.uproject`; scratch project log |
| Python commandlet/API reflection | PASS | `VRM4UImporterBPFunctionLibrary` and `ImportOptionData` exposed |
| Aurelia import and generated skeletal mesh | UNTESTED/BLOCKED | headless Slate assertion |
| Vaelith import and generated skeletal mesh | UNTESTED/BLOCKED | first import process aborted |
| Marcus import and generated skeletal mesh | UNTESTED/BLOCKED | first import process aborted |
| Bone/morph/physics/meta asset counts | UNTESTED | no trustworthy imported asset result |
| GUI import, deformation, retargeting, morphs, spring physics, materials | UNTESTED | no supported completed GUI evidence |

The headless route is not a model failure: the importer reached VRM4U and then accessed Slate/ContentBrowser without a valid Slate application. Do not mark any import or asset-quality item PASS until an interactive editor run or a plugin commandlet-safe route produces saved assets and logs.


Run all sections for `aurelia/character.vrm`, `vaelith/character.vrm`, and `marcus/character.vrm`. Store evidence as `evidence/<sample>/<section>/...`; record PASS/FAIL/UNTESTED and the exact file path for each item.
