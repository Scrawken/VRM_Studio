import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vrmForgeDesktop', {
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),
  selectBlenderExecutable: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectBlenderExecutable'),
  openProjectInBlender: (blenderPath: string, blendFilePath: string) =>
    ipcRenderer.invoke('blender:openProject', { blenderPath, blendFilePath }),
  openFolder: (folderPath: string) => ipcRenderer.invoke('shell:openFolder', folderPath),
});
