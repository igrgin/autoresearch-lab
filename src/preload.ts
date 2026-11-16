import { MetadataPolicy } from './security/metadata-policy';
import { contextBridge, ipcRenderer } from 'electron';
import type { ShellBridge } from './shell';
import type { ConfigurationReply, ConfigurationRequest } from './configuration';
const policy = new MetadataPolicy();
const revision = (): Promise<number> => ipcRenderer.invoke('metadata:revision');
ipcRenderer.on('configuration:invalidate', (_event, generation: number) => policy.observe(generation));
const metadata = <T>(channel: string, ...args: unknown[]): Promise<T> => policy.receive(() => ipcRenderer.invoke(channel, ...args), revision);
const configuration = <T>(request: ConfigurationRequest): Promise<ConfigurationReply<T>> => metadata('configuration:request', request);
const operationId = () => crypto.randomUUID();

const bridge: ShellBridge = {
  metadataReady: () => policy.refresh(() => ipcRenderer.invoke('metadata:ready')),
  metadataGeneration: policy.current,
  metadataRevision: policy.revision,
  onMetadataInvalidated: policy.subscribe,
  onConfigurationInvalidated: policy.subscribe,
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
  selectImportSource: (kind) => metadata('imports:select', kind),
  startImport: (projectId, input) => metadata('imports:start', projectId, input),
  listImports: (projectId) => metadata('imports:list', projectId),
  importAction: (projectId, importId, expectedRevision, action) => metadata('imports:action', projectId, importId, expectedRevision, action),
  runpodCredentials: () => metadata('runpod:credentials'),
  discoverRunpod: credentialId => metadata('runpod:discover', credentialId),
  inspectRunpod: (credentialId, resourceId) => metadata('runpod:inspect', credentialId, resourceId),
  openCredentialSettings: () => ipcRenderer.invoke('shell:credential-settings'),
  listVastCredentials: () => metadata('vast:credentials'),
  discoverVast: id => metadata('vast:discover', id),
  openVastSettings: () => ipcRenderer.invoke('vast:settings'),
  codex: {
    reconcileSave: requestId => metadata('codex:reconcile-save', requestId),
    settings: () => metadata('codex:settings'),
    recovery: projectId => metadata('codex:recovery', projectId),
    credentials: () => ipcRenderer.invoke('codex:credentials'),
    authenticate: credentialRef => metadata('codex:authenticate', credentialRef),
    models: () => metadata('codex:models'),
    saveDefault: (choice, requestId) => metadata('codex:default', choice, requestId),
    runSelection: projectId => metadata('codex:run-get', projectId),
    saveRunSelection: (projectId, expectedRevision, choice, requestId) => metadata('codex:run-save', projectId, expectedRevision, choice, requestId),
  },
  claude: {
    settings: () => metadata('claude:settings'),
    recovery: () => metadata('claude:recovery'),
    openCredentials: () => ipcRenderer.invoke('claude:credentials'),
    discover: credentialId => metadata('claude:discover', credentialId),
    save: (choice, revision, requestId) => metadata('claude:save', choice, revision, requestId),
    qualify: choice => metadata('claude:qualify', choice),
    runInputs: projectId => metadata('claude:runs', projectId),
    saveRunInput: input => metadata('claude:save-run', input),
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
