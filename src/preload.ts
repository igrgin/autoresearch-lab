import { contextBridge, ipcRenderer } from 'electron';
import type { ShellBridge } from './shell';

const bridge: ShellBridge = {
  getStatus: () => ipcRenderer.invoke('shell:get-status'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  openProject: (projectId) => ipcRenderer.invoke('projects:open', projectId),
  recoverProject: (projectId) => ipcRenderer.invoke('projects:recover', projectId),
  revealProject: (projectId) => ipcRenderer.invoke('projects:reveal', projectId),
  copyWorkspaceLocation: () => ipcRenderer.invoke('projects:copy-workspace-location'),
};
contextBridge.exposeInMainWorld('lab', bridge);
