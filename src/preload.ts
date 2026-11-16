import { contextBridge, ipcRenderer } from 'electron';
import type { ShellBridge } from './shell';
import type { ConfigurationReply, ConfigurationRequest } from './configuration';
const configuration = <T>(request: ConfigurationRequest): Promise<ConfigurationReply<T>> => ipcRenderer.invoke('configuration:request', request);
const operationId = () => crypto.randomUUID();

const bridge: ShellBridge = {
  getGlobalDefaults: () => configuration({ kind: 'global:get', operationId: operationId() }),
  updateGlobalDefaults: input => configuration({ kind: 'global:update', operationId: input.requestId, input }),
  getProjectDefaults: projectId => configuration({ kind: 'project:get', operationId: operationId(), projectId }),
  updateProjectDefaults: (projectId, input) => configuration({ kind: 'project:update', operationId: input.requestId, projectId, input }),
  prepareConfiguration: projectId => configuration({ kind: 'prepare', operationId: operationId(), projectId }),
  saveConfiguration: input => configuration({ kind: 'save', operationId: input.requestId, input }),
  listConfigurations: projectId => configuration({ kind: 'snapshots', operationId: operationId(), projectId }),
  getConfiguration: (projectId, snapshotId) => configuration({ kind: 'snapshot', operationId: operationId(), projectId, snapshotId }),
  selectImportSource: (kind) => ipcRenderer.invoke('imports:select', kind),
  startImport: (projectId, input) => ipcRenderer.invoke('imports:start', projectId, input),
  listImports: (projectId) => ipcRenderer.invoke('imports:list', projectId),
  importAction: (projectId, importId, expectedRevision, action) => ipcRenderer.invoke('imports:action', projectId, importId, expectedRevision, action),
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
