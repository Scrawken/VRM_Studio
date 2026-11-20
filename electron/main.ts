import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let activeBackendUrl: string | null = null;

function getProjectsDir(): string {
  return path.join(app.getPath('userData'), 'projects');
}

function isStrictBlenderBinaryName(candidatePath: string): boolean {
  const base = path.basename(candidatePath);
  if (process.platform === 'win32') {
    return base.toLowerCase() === 'blender.exe';
  }
  return base === 'blender';
}

function isWithinDirectory(targetPath: string, rootDir: string): boolean {
  const rel = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function pollBackendHealth(port: number, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Timed out waiting for Express backend on 127.0.0.1:${port}`));
        return;
      }
      setTimeout(attempt, 200);
    };

    attempt();
  });
}

async function startExpressBackend(): Promise<string> {
  const devExternalUrl = process.env.VRM_FORGE_DEV_URL;
  if (!app.isPackaged && devExternalUrl) {
    const parsedUrl = new URL(devExternalUrl);
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || !localHosts.has(parsedUrl.hostname)) {
      throw new Error('VRM_FORGE_DEV_URL must point to a local loopback address.');
    }
    return devExternalUrl;
  }

  const isPackaged = app.isPackaged;
  const resourcesRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '../..');
  const serverBundlePath = path.join(resourcesRoot, 'dist-server', 'server.cjs');
  const publicDir = path.join(resourcesRoot, 'dist');
  const blenderScriptsDir = path.join(resourcesRoot, 'blender_scripts');
  const backendDir = path.join(resourcesRoot, 'backend');
  const projectsDir = getProjectsDir();
  fs.mkdirSync(projectsDir, { recursive: true });

  if (!fs.existsSync(serverBundlePath)) {
    throw new Error(
      `Bundled Express backend not found at ${serverBundlePath}. Run "npm run build:all" before launching desktop shell.`
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [serverBundlePath], {
      cwd: resourcesRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: '0',
        VRM_FORGE_HOST: '127.0.0.1',
        VRM_FORGE_PUBLIC_DIR: publicDir,
        VRM_FORGE_PROJECTS_DIR: projectsDir,
        VRM_FORGE_BLENDER_SCRIPTS_DIR: blenderScriptsDir,
        VRM_FORGE_BACKEND_DIR: backendDir,
      },
    });
    backendProcess = child;

    const handleChunk = async (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        console.log('[Express]', line);
        const match = /^VRM_FORGE_READY:(\d+)$/.exec(line.trim());
        if (match && !settled) {
          settled = true;
          const port = Number(match[1]);
          try {
            await pollBackendHealth(port);
            resolve(`http://127.0.0.1:${port}`);
          } catch (err) {
            reject(err);
          }
        }
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      void handleChunk(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      console.error('[Express:err]', chunk.toString('utf8').trim());
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Express backend exited prematurely with code ${code ?? 'unknown'}`));
      }
    });
  });
}

function stopExpressBackend() {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch {
      // Ignore already exited child
    }
    backendProcess = null;
  }
}

function createWindow(targetUrl: string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0e1116',
    title: 'VRM Forge Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadURL(targetUrl);
}

ipcMain.handle('dialog:selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:selectBlenderExecutable', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Blender Executable',
    filters: [
      {
        name: 'Blender Executable',
        extensions: process.platform === 'win32' ? ['exe'] : ['*'],
      },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = result.filePaths[0];
  if (!isStrictBlenderBinaryName(selected)) {
    return null;
  }
  return selected;
});

ipcMain.handle(
  'blender:openProject',
  async (_event, args: { blenderPath: string; blendFilePath: string }) => {
    const projectsRoot = getProjectsDir();
    if (
      !args.blenderPath ||
      !isStrictBlenderBinaryName(args.blenderPath) ||
      !fs.existsSync(args.blenderPath)
    ) {
      return { launched: false, error: 'Selected Blender executable is invalid or missing.' };
    }
    if (
      !args.blendFilePath ||
      path.extname(args.blendFilePath).toLowerCase() !== '.blend' ||
      !isWithinDirectory(args.blendFilePath, projectsRoot) ||
      !fs.existsSync(args.blendFilePath)
    ) {
      return { launched: false, error: '.blend project file must reside inside app projects directory.' };
    }
    const child = spawn(args.blenderPath, [args.blendFilePath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { launched: true };
  }
);

ipcMain.handle('shell:openFolder', async (_event, folderPath: string) => {
  const allowedRoot = app.getPath('userData');
  if (
    folderPath &&
    (path.resolve(folderPath) === path.resolve(allowedRoot) ||
      isWithinDirectory(folderPath, allowedRoot)) &&
    fs.existsSync(folderPath)
  ) {
    await shell.openPath(folderPath);
    return true;
  }
  return false;
});

app.whenReady().then(async () => {
  try {
    activeBackendUrl = await startExpressBackend();
    createWindow(activeBackendUrl);
  } catch (err) {
    console.error('Desktop startup failure:', err);
    dialog.showErrorBox('VRM Forge Studio Startup Error', (err as Error).message);
    app.quit();
  }
});

app.on('before-quit', () => {
  stopExpressBackend();
});

app.on('window-all-closed', () => {
  stopExpressBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
