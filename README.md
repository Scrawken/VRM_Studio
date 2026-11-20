# VRM Forge Studio

VRM Forge Studio runs as a local Node.js application on Windows. It provides a browser interface and an optional Electron desktop shell, keeps project files on the machine, and can invoke a local Blender installation for VRM export.

## Run the local browser app

Install Node.js, then from this folder run:

```bash
npm install
cp .env.example .env
npm run dev
```

Copying `.env.example` is optional if you are not configuring API providers.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to loopback by default. You do not need a Gemini key for local semantic parsing and procedural generation. Add `GEMINI_API_KEY` to `.env` only if you want Gemini interpretation. Tripo and Meshy keys are optional and send requests to those external providers.

To run the built local server instead:

```bash
npm run build
npm start
```

## Run the Electron desktop app

Install the desktop dependencies once, then build and launch Electron:

```bash
npm install
npm --prefix electron install
npm run desktop
```

Electron starts a local Express process and connects to it over `127.0.0.1`. Generated projects are stored in the app's local data directory.

## Blender

Blender is optional for the TypeScript VRM pipeline. Install Blender 4.2 and VRM Add-on for Blender to use the local headless Blender export path. The application reports whether Blender and the add-on are detected; source-code presence alone does not establish that an export works on a particular machine.

## Local configuration and data

- `.env` is read by the local server and should remain private. `.env.example` contains optional provider settings.
- Browser-mode projects are stored under `projects/` by default. Electron uses its per-user application data directory.
- The browser and server communicate over the local machine. Gemini, Tripo, and Meshy remain optional network services when selected.
- `npm run build` builds both the frontend and the local server bundle (`dist-server/server.cjs`, which is committed; rebuild it after changing `server.ts` or `server/`).
- `npm run clean` removes build output using Node, so it works in cmd, PowerShell and Git Bash.
- `npm run test:backend` needs Python 3 available as `python` on PATH (there is no `python3` on a default Windows install). `npm test` also runs one test that calls `python3`; on Windows it fails unless a `python3` command exists.
