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
Open `http://127.0.0.1:3000`. Copy `.env.example` to `.env` if you want to configure optional providers. The server binds to loopback by default.

### Built local server
```bash
npm run build
npm start
```
This builds the frontend and bundled Express server, then serves them locally.

### Electron desktop app
```bash
npm install
npm --prefix electron install
npm run desktop
```
Electron starts its own local server process and stores projects in its per-user application data directory.

### Blender
Install Blender 4.2 and VRM Add-on for Blender to use the local headless Blender export path. To invoke the repository's Blender script manually:
```bash
blender --background --python blender_scripts/test_milestone2_blender.py -- --out-dir ./projects/_blender_test
```
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
