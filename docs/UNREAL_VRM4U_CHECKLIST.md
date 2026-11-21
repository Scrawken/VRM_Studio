# Unreal + VRM4U Acceptance Protocol

**Status:** Protocol prepared; all Unreal/VRM4U items are **UNTESTED** on this machine. Blender 4.2.23 VRM Format 4.10.5 was verified separately and imported all three `.vrm` files; that is not Unreal/VRM4U evidence. Unreal Engine executables were found in standard Epic locations (`UE_5.7`, `UE_5.8`), but no VRM4U plugin or configured VRM4U project was found in the inspected project/engine folders. No Unreal Editor or VRM4U import was run. The three first test inputs are `aurelia`, `vaelith`, and `marcus` under `projects/`.

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

## Required test matrix

Run all sections for `aurelia/character.vrm`, `vaelith/character.vrm`, and `marcus/character.vrm`. Store evidence as `evidence/<sample>/<section>/...`; record PASS/FAIL/UNTESTED and the exact file path for each item.
