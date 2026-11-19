import { contextBridge, ipcRenderer } from 'electron';
import type { ShellBridge } from './shell';
import type { ConfigurationReply, ConfigurationRequest } from './configuration';
const configuration = <T>(request: ConfigurationRequest): Promise<ConfigurationReply<T>> => ipcRenderer.invoke('configuration:request', request);
const operationId = () => crypto.randomUUID();

const bridge: ShellBridge = {
  onConfigurationInvalidated: listener => {
    const invalidate = () => listener();
    ipcRenderer.on('configuration:invalidate', invalidate);
    return () => { ipcRenderer.removeListener('configuration:invalidate', invalidate); };
  },
  getGlobalDefaults: () => configuration({ kind: 'global:get', operationId: operationId() }),
  recoverGlobalDefaults: () => configuration({ kind: 'global:recover', operationId: operationId() }),
  updateGlobalDefaults: input => configuration({ kind: 'global:update', operationId: input.requestId, input }),
  getProjectDefaults: projectId => configuration({ kind: 'project:get', operationId: operationId(), projectId }),
  recoverProjectDefaults: projectId => configuration({ kind: 'project:recover', operationId: operationId(), projectId }),
  updateProjectDefaults: (projectId, input) => configuration({ kind: 'project:update', operationId: input.requestId, projectId, input }),
  prepareConfiguration: projectId => configuration({ kind: 'prepare', operationId: operationId(), projectId }),
  saveConfiguration: input => configuration({ kind: 'save', operationId: input.requestId, input }),
  listConfigurations: projectId => configuration({ kind: 'snapshots', operationId: operationId(), projectId }),
  getConfiguration: (projectId, snapshotId) => configuration({ kind: 'snapshot', operationId: operationId(), projectId, snapshotId }),
  selectImportSource: (kind) => ipcRenderer.invoke('imports:select', kind),
  startImport: (projectId, input) => ipcRenderer.invoke('imports:start', projectId, input),
  listImports: (projectId) => ipcRenderer.invoke('imports:list', projectId),
  importAction: (projectId, importId, expectedRevision, action) => ipcRenderer.invoke('imports:action', projectId, importId, expectedRevision, action),
  runpodCredentials: () => ipcRenderer.invoke('runpod:credentials'),
  discoverRunpod: credentialId => ipcRenderer.invoke('runpod:discover', credentialId),
  inspectRunpod: (credentialId, resourceId) => ipcRenderer.invoke('runpod:inspect', credentialId, resourceId),
  openCredentialSettings: () => ipcRenderer.invoke('shell:credential-settings'),
  listVastCredentials: () => ipcRenderer.invoke('vast:credentials'),
  discoverVast: id => ipcRenderer.invoke('vast:discover', id),
  openVastSettings: () => ipcRenderer.invoke('vast:settings'),
  codex: {
    reconcileSave: requestId => ipcRenderer.invoke('codex:reconcile-save', requestId),
    settings: () => ipcRenderer.invoke('codex:settings'),
    recovery: projectId => ipcRenderer.invoke('codex:recovery', projectId),
    credentials: () => ipcRenderer.invoke('codex:credentials'),
    authenticate: credentialRef => ipcRenderer.invoke('codex:authenticate', credentialRef),
    models: () => ipcRenderer.invoke('codex:models'),
    saveDefault: (choice, requestId) => ipcRenderer.invoke('codex:default', choice, requestId),
    runSelection: projectId => ipcRenderer.invoke('codex:run-get', projectId),
    saveRunSelection: (projectId, expectedRevision, choice, requestId) => ipcRenderer.invoke('codex:run-save', projectId, expectedRevision, choice, requestId),
  },
  claude: {
    settings: () => ipcRenderer.invoke('claude:settings'),
    recovery: () => ipcRenderer.invoke('claude:recovery'),
    openCredentials: () => ipcRenderer.invoke('claude:credentials'),
    discover: credentialId => ipcRenderer.invoke('claude:discover', credentialId),
    save: (choice, revision, requestId) => ipcRenderer.invoke('claude:save', choice, revision, requestId),
    qualify: choice => ipcRenderer.invoke('claude:qualify', choice),
    runInputs: projectId => ipcRenderer.invoke('claude:runs', projectId),
    saveRunInput: input => ipcRenderer.invoke('claude:save-run', input),
  },
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
