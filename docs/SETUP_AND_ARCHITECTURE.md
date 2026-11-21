# VRM Forge Studio — Local Architecture & Windows Setup

## 1. Architecture Overview

VRM Forge Studio runs locally as a Node.js application, with an optional Electron desktop shell. VRM 0.0 is the primary compatibility target; VRM 1.0 is also available.

- **Frontend (`src/`)**: React, TypeScript, Three.js, and `@pixiv/three-vrm` provide the local studio interface and VRM preview.
- **VRM pipeline (`src/shared/`)**: TypeScript builds and validates binary glTF/VRM, characters, morph targets, textures, and humanoid rigs.
- **Local Node/Express runtime (`server.ts`, `server/`)**: Serves the UI and `/api/*` routes, stores browser-mode projects locally, and detects Blender and hardware. The development command uses Vite middleware; the built command serves `dist/`.
- **Windows desktop shell (`electron/`)**: Electron starts a bundled Express child process on loopback, opens the local UI, handles folder dialogs, and can open `.blend` files in Blender.
- **Python and Blender tools (`backend/`, `blender_scripts/`)**: Python contains the binary validator, subprocess helper, tests, and Blender scripts.

---

## 2. Operating Modes & Provider Matrix

| Mode | Interpretation | Geometry & Rigging | Network use |
| :--- | :--- | :--- | :--- |
| **Local** | Local semantic parser; optional Ollama | Local procedural VRM engine; optional Blender | None required |
| **Hybrid** | Gemini, with local parser fallback | Local procedural engine and optional Blender | Gemini requests when configured |
| **External geometry** | Selected interpreter | Tripo/Meshy adapter with local import and rigging | Provider requests and downloads |

---

## 3. Running Locally & Windows Desktop Packaging

### Browser development (port 3000)
```bash
npm install
npm run dev
```
Open `http://127.0.0.1:3000`. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`) if you want to configure optional providers. The server binds to `127.0.0.1` by default; `PORT` changes the port (default 3000, invalid values fall back to 3000). A non-loopback `HOST`/`VRM_FORGE_HOST` is ignored unless `VRM_FORGE_ALLOW_NON_LOOPBACK=1` is set.

### Built local server
```bash
npm run build
npm start
```
This builds the frontend and bundled Express server, then serves them locally. `dist-server/server.cjs` is a committed build artifact; rebuild it whenever `server.ts` or `server/` changes.

### Electron desktop app
```bash
npm install
npm --prefix electron install
npm run desktop
```
Electron starts its own local server process and stores projects in its per-user application data directory.

### Blender
Acceptance target: **Blender 4.2** with **VRM Add-on for Blender** installed and enabled. Newer Blender builds can be used by setting `BLENDER_EXECUTABLE` (or choosing `blender.exe` in the desktop picker); results on a newer build apply to that build only and are not a claim of 4.2 compatibility. Auto-detection checks `Program Files\Blender Foundation\Blender <version>` for 4.2 first, then 5.2 through 3.6.

The add-on counts as installed only if its Armature property `vrm_addon_extension` is registered after the probe (`blender_scripts/vrm_addon_probe.py`) tries to enable it. Testing `hasattr(bpy.ops.export_scene, "vrm")` is not valid because `bpy.ops` resolves any name. The pipeline re-enables the add-on after each factory reset, because a reset unregisters it (it is enabled with a fresh preferences entry because the VRM exporter asserts when none exists; add-on preference values return to defaults; nothing is saved to the user's preferences).

To invoke the repository's Blender script manually, pass an input GLB (`--glb-path` is required; the script fails with a report otherwise):
```bash
blender --background --python-exit-code 1 --python blender_scripts/test_milestone2_blender.py --   --glb-path ./projects/<character_id>/character.glb --out-dir ./projects/_blender_test
```
`--python-exit-code 1` makes uncaught Python errors return a non-zero exit code (Blender otherwise exits 0). On any failure the pipeline writes a `status: "fail"` report (`failed_stage`, `error`, `traceback`). The app deletes stale `blender_report.json`, `character_blender.vrm` and `character_blender.blend` before each run and promotes outputs only after verification. When the GLB has several armatures, the one with the most bound meshes, then matched vertex groups, then bones is used (`armature_candidates` in the report).

**Metadata and physics preservation (VRM 0.0 path).** `spec.json` is written with the *resolved* metadata (`resolveEffectiveVrmMetadata`: spec, then source VRM, then defaults, clamped to source restrictions) as `vrmMetadata`; Blender applies it verbatim with no field-level defaults, and no sample licence data is embedded in the scripts. Missing fields are listed in the report (`export_info.meta_missing_fields`; `input_notes` when `spec.json` is absent). Source springs and collider groups come from `blender_context.json`: collider groups are created as sphere empties parented to the bone (the add-on exports those, not raw offsets), spring groups get `gravityDir`, `center` and `colliderGroups` (remapped past skipped groups). Anything that cannot be preserved is reported, not silent: `export_info.colliders_skipped` (node is not an armature bone), `springs_skipped` and `spring_warnings`. The add-on normalises `gravityDir`, so only its direction is preserved. VRM 1.0 expressions are bound from shape keys (`ext.vrm1.expressions.preset.<snake_case>.morph_target_binds`: `.node.mesh_object_name`, `.index` = shape key name, `.weight`), on every mesh carrying a non-zero-delta key; `export_info.vrm1_expressions_bound/skipped` lists the outcome, and the pipeline fails the run when the exported VRM has zero non-empty expressions. `neutral` stays empty unless a `neutral` key exists. VRM 1.0 via Blender applies metadata (the add-on's `other_license_url` is written as `otherLicenseUrl`, while `licenseUrl` stays the VRM default) but does not export source springs/colliders (reported in `export_info.spring_warnings`). Human bones for 1.0 must be assigned by the add-on's snake_case property names (`left_upper_leg`); camelCase names silently assign nothing and the add-on then cancels the export.

**Local portable Blender.** Auto-discovery also checks `<repo>/_tools/blender-*/[<nested folder>/]blender.exe` (4.2 first), found from the working directory or up to three parent folders (so git worktrees under `_staging` work). A `portable` folder next to `blender.exe` keeps that install's config and extensions out of the user's profile. Install the VRM add-on into it with `blender --background --factory-startup --command extension install-file -r user_default --enable <vrm-addon.zip>` (the add-on is published at extensions.blender.org; check the SHA-256 it lists).

This command has not been run as part of the documentation update; verify it on the target Windows installation.

### Windows installer
```bash
npm install
npm --prefix electron install
npm run package:win
```

---

## 4. Security & Privacy Boundaries

- Optional API keys (`GEMINI_API_KEY`, `TRIPO_API_KEY`, `MESHY_API_KEY`) are read by the local server and are not placed in the browser bundle. Configuring a provider causes requests to leave the machine.
- Character descriptions never execute `eval` or arbitrary script snippets; Blender Python scripts are generated deterministically from validated `CharacterSpecification` JSON.
- Browser-mode project artifacts are stored locally under `./projects/<character_id>/`; Electron projects use the per-user application data directory.
