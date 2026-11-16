import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

const BACKEND_PORT = 8765;

function startPythonBackend() {
  const isPackaged = app.isPackaged;
  const backendDir = isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.resolve(__dirname, '../../backend');
  const pythonExec = process.env.VRM_FORGE_PYTHON || 'python';

  backendProcess = spawn(
    pythonExec,
    ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: backendDir,
      stdio: 'pipe',
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }
  );

  backendProcess.stdout?.on('data', (chunk) => {
    console.log('[FastAPI]', chunk.toString().trim());
  });
  backendProcess.stderr?.on('data', (chunk) => {
    console.error('[FastAPI:err]', chunk.toString().trim());
  });
}

function createWindow() {
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
    },
  });

  const devUrl = process.env.VRM_FORGE_DEV_URL || 'http://localhost:3000';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '../../dist/index.html'));
  }
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
      { name: 'Executables', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('blender:openProject', async (_event, args: { blenderPath: string; blendFilePath: string }) => {
  if (!args.blenderPath || !fs.existsSync(args.blendFilePath)) {
    return { launched: false, error: 'Blender executable or .blend file not found.' };
  }
  const child = spawn(args.blenderPath, [args.blendFilePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { launched: true };
});

ipcMain.handle('shell:openFolder', async (_event, folderPath: string) => {
  if (fs.existsSync(folderPath)) {
    await shell.openPath(folderPath);
    return true;
  }
  return false;
});

app.whenReady().then(() => {
  startPythonBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
