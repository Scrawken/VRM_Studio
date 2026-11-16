# VRM Forge Studio — Architecture, Installation & Windows Desktop Guide

## 1. Architecture Overview

VRM Forge Studio implements a modular, desktop-first AI Text-to-VRM 1.0 generation workstation:

- **Frontend (`src/`)**: React 19, TypeScript, Tailwind CSS v4, Three.js, and `@pixiv/three-vrm` (`VRMLoaderPlugin`), providing real-time 3D inspection, skeletal & vertex weight visualization, 18-expression morph target testing, animation playback, and character customization.
- **VRM 1.0 Binary Engine (`src/shared/`)**: Zero-dependency binary glTF 2.0 + `VRMC_vrm` 1.0 + `VRMC_springBone` synthesizer, pure TypeScript procedural PNG PBR texture encoder, and an independent binary VRM 1.0 validator.
- **Node/Express Runtime (`server.ts`, `server/`)**: Full-stack development & web runtime hosting `/api/*` routes, `@google/genai` (`gemini-4-hydrogen`) structured character interpretation, local disk project storage (`./projects/`), and Blender/hardware probing.
- **Windows Desktop Shell (`electron/`)**: Electron main & preload processes managing native Windows folder dialogs, launching the Python FastAPI backend (`backend/app.py`), and opening `.blend` files directly in Blender.
- **Python & Blender Automation (`backend/`, `blender_scripts/`)**: FastAPI service, subprocess Blender runner (`--background --python`), and `bpy` scripts generating humanoid armatures, skin weights, shape keys, `.blend` files, and VRM Add-on exports.

---

## 2. Operating Modes & Provider Matrix

| Mode | AI Interpretation | 3D Geometry & Rigging | Cloud Dependency | Cost Model |
| :--- | :--- | :--- | :--- | :--- |
| **Hybrid (Recommended)** | Gemini 4 Hydrogen (fallback: Local Semantic Parser) | Procedural VRM Engine + Local Blender `bpy` | Interpretation only | Gemini API free/paid tier; Blender/VRM free |
| **Local (Offline)** | Local Semantic Parser or Ollama (`qwen2.5:7b` / `llama3.2:3b`) | Procedural VRM Engine + Local Blender `bpy` | None (100% offline) | Free |
| **Cloud-Assisted** | Gemini 4 Hydrogen | Modular Cloud 3D Adapter (e.g. Tripo AI) + Local Blender cleanup | Interpretation + optional 3D | Gemini + commercial 3D credits (`TRIPO_API_KEY`) |

---

## 3. Running Locally & Windows Desktop Packaging

### Web / Node.js Development (Port 3000)
```bash
npm install
npm run dev
```

### Python FastAPI Backend & Tests
```bash
cd backend
python -m unittest discover -p "test_*.py" -v
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8765
```

### Blender Milestone 2 Verification (Windows / Linux / macOS)
1. Install **Blender 3.6 LTS or 4.x** (`https://www.blender.org/download/`).
2. Install the official **VRM Add-on for Blender** (`https://vrm-addon-for-blender.info/`) for native `.vrm` export inside Blender.
3. Run the automated Milestone 2 test directly:
```bash
blender --background --python blender_scripts/test_milestone2_blender.py -- --out-dir ./projects/_blender_test
```

### Windows Electron Installer (`.exe`)
```bash
cd electron
npm install
npm run package:win
```

---

## 4. Security & Privacy Boundaries

- Private API keys (`GEMINI_API_KEY`, `TRIPO_API_KEY`) remain strictly server-side (`process.env`) and are never exposed to the browser bundle.
- Character descriptions never execute `eval` or arbitrary script snippets; Blender Python scripts are generated deterministically from validated `CharacterSpecification` JSON.
- All generated `.vrm`, `.glb`, `.json`, and `.py` project artifacts are stored locally under `./projects/<character_id>/`.
