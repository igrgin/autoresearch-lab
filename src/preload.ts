import { contextBridge, ipcRenderer } from 'electron';
import type { ShellBridge } from './shell';

const bridge: ShellBridge = {
  getStatus: () => ipcRenderer.invoke('shell:get-status'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  openProject: (projectId) => ipcRenderer.invoke('projects:open', projectId),
  recoverProject: (projectId) => ipcRenderer.invoke('projects:recover', projectId),
  revealProjectRepository: (projectId) => ipcRenderer.invoke('projects:reveal-repository', projectId),
  revealProject: (projectId) => ipcRenderer.invoke('projects:reveal', projectId),
  copyWorkspaceLocation: () => ipcRenderer.invoke('projects:copy-workspace-location'),
  copyProjectRepository: (projectId) => ipcRenderer.invoke('projects:copy-repository', projectId),
  copyProjectLocation: (projectId) => ipcRenderer.invoke('projects:copy-location', projectId),
};
contextBridge.exposeInMainWorld('lab', bridge);
