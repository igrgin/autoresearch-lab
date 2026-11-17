import { metadataReply } from './security/metadata-policy';
import { ResearchSecurityHost } from './research/security-port';
import { CodexHost } from './codex/host';
import { StdioAuthRpc, stopCodexAuthentication } from './codex/stdio';
import { CodexStoreClient } from './codex/store-client';
import { admitCodexValue } from './codex/admission';
import type { CodexReply, CodexStoreCommand, CodexStoreValue, ChooseAgent } from './codex/contract';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, utilityProcess } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateProject, ProjectReply, ProjectRequest, ProjectRecord, WorkspaceProjects } from './projects';
import type { ImportAction, ImportRecord, ImportRequest, StartImport } from './imports';
import type { ShellStatus } from './shell';
import type { ConfigurationReply, ConfigurationRequest, ConfigurationValue } from './configuration';
import { ConfigurationClient } from './configuration/client';
import { createSecurityHost } from './security/electron-vault';
import { CREDENTIAL_HELP, ENTRY_CATEGORIES, validEntry } from './security/entry-contract';
import { assertId, newId } from './security/common';
import type { Envelope } from './security/recording';
import { requestImport } from './importer/host';
import { ImportPolicyHost, type ImportPolicyRequest } from './importer/policy';
import { RunpodAdapter } from './providers/runpod';
import { VastConnection } from './providers/vast-connection';
import { vastFailure } from './providers/vast';
import { ClaudeHost } from './claude/host';
import { ownClaudePublication } from './claude/publication';
import { runClaudeWorker } from './claude/electron-worker';
import { ClaudeChoice, ClaudeFailure, ClaudeReply } from './claude/contracts';
import { SelectionClient } from './claude/selection-client';
import type { SelectionCommand, SelectionValue } from './claude/store';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

declare const CREDENTIAL_WINDOW_WEBPACK_ENTRY: string;
declare const CREDENTIAL_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
let credentialWindow: BrowserWindow | null = null;
let security: ReturnType<typeof createSecurityHost>;
let vast: VastConnection;
let window: BrowserWindow | null = null;
let coordinator: ReturnType<typeof utilityProcess.fork> | null = null;
let quitting = false;
const codexClient = new CodexStoreClient({ available: () => coordinator !== null,
  post: message => { if (!coordinator) throw new Error(); coordinator.postMessage(message); } }, command => {
  const release = security.matcher.holdMatchingPolicy();
  try { admitCodexValue(security.matcher, command); return release; } catch (error) { release(); throw error; }
});
const requestCodexStore = (command: CodexStoreCommand): Promise<CodexStoreValue> => codexClient.request(command);
let startupFailure = 'Workspace startup failed. Restart the application.';
type HostValue = ProjectRecord | WorkspaceProjects | ImportRecord[];
const selections = new Map<string, { paths: string[]; directory: boolean }>();
const pending = new Map<string, { resolve: (reply: ProjectReply<HostValue>) => void; timer: ReturnType<typeof setTimeout> }>();
const selectionClient = new SelectionClient(message => {
  if (!coordinator) throw new ClaudeFailure('unavailable');
  coordinator.postMessage(message);
}, undefined, undefined, command => {
  if (!coordinator) throw new ClaudeFailure('unavailable');
  return ownClaudePublication(security.matcher, security.recording, command);
});
const requestSelection = (selection: SelectionCommand): Promise<SelectionValue> => selectionClient.request(selection);

function requestProjects(request: ProjectRequest | ImportRequest): Promise<ProjectReply<HostValue>> {
  return new Promise((resolve) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: { code: 'unavailable', origin: 'project_catalog', operationId: request.operationId,
        message: 'The workspace has not replied. Refresh the project list before retrying; creation may have completed.', effect: 'partial', retry: 'after_reconcile' } });
    }, 90_000);
    pending.set(id, { resolve, timer });
    coordinator?.postMessage({ id, request });
  });
}

function requestImports(request: ImportRequest): Promise<ProjectReply<ImportRecord[]>> {
  return requestImport(request, async input => {
    const reply = await requestProjects(input);
    if (!reply.ok) return reply;
    if (!Array.isArray(reply.value)) throw new Error('Invalid import response');
    return { ok: true, value: reply.value };
  }, security);
}

const configurationClient = new ConfigurationClient({ available: () => coordinator !== null,
  post: message => { if (!coordinator) throw new Error(); coordinator.postMessage(message); } }, request => {
  const release = security.matcher.holdMatchingPolicy();
  try { security.assertSafeConfiguration(request); return release; } catch (error) { release(); throw error; }
}, value => security.assertSafeConfiguration(value));

function admit(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Untrusted workspace request.');
  }
}

// Admission inside a host may await IO. Stamp only the generation under which
// the complete operation ran; preload independently fences in-transit replies.
function metadataHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    admit(event);
    const generation = security.matcher.matchingGeneration;
    const value = await listener(event, ...args);
    if (generation !== security.matcher.matchingGeneration) throw new Error('Credential protection changed. Reload metadata; a save may already have completed.');
    return metadataReply(value, generation);
  });
}

function startCoordinator(): Promise<ShellStatus> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'coordinator.cjs'), [app.getPath('userData')], {
      serviceName: 'Autoresearch Lab Coordinator',
    });
    coordinator = child;
    const importPolicy = new ImportPolicyHost(async meta => {
      await security.initialize();
      const release = security.matcher.holdMatchingPolicy();
      try { security.recording.metadataRevision(meta); return release; }
      catch (error) { release(); throw error; }
    }, message => child.postMessage(message), { recheck: record => security.recording.recheck(record), metadataRevision: meta => security.recording.metadataRevision(meta) });
    child.on('message', (message: ImportPolicyRequest) => { if (message?.channel === 'import_matching') importPolicy.receive(message); });
    let ready = false;
    const timer = setTimeout(() => {
      reject(new Error('The workspace coordinator did not start in time.'));
    }, 15_000);
    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (message && typeof message === 'object' && 'coordinator' in message && message.coordinator === 'failed' && 'message' in message && typeof message.message === 'string') {
        // Preserve the catalog's actionable startup guidance without forwarding raw diagnostics.
        startupFailure = 'Workspace storage could not open. Check application-data folder permissions and free disk space. If this workspace was created by a newer app, reopen it with that version. Existing files were left intact.';
        reject(new Error(startupFailure));
        return;
      }
      if (!message || typeof message !== 'object' || !('coordinator' in message) ||
          message.coordinator !== 'ready' || !('sqliteVersion' in message) || typeof message.sqliteVersion !== 'string') {
        reject(new Error('The workspace coordinator returned an invalid startup response.'));
        return;
      }
      ready = true;
      resolve({ coordinator: 'ready', sqliteVersion: message.sqliteVersion });
    });
    child.on('message', async (message: { id?: string; reply?: ProjectReply<HostValue>; configurationReply?: ConfigurationReply<ConfigurationValue>; importAdmissionId?: string; names?: string[] }) => {
      if (message?.id && message.configurationReply) {
        configurationClient.receive(message.id, message.configurationReply);
        return;
      }
      if (message?.importAdmissionId) {
        let allowed = false;
        try { await security.initialize(); allowed = security.checkImportNames(message.names); } catch { /* Fail closed without recording raw names or storage diagnostics. */ }
        child.postMessage({ importAdmissionId: message.importAdmissionId, allowed });
        return;
      }
      if (!message?.id || !message.reply) return;
      const waiting = pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      waiting.resolve(message.reply);
    });
    child.on('message', (message: { configurationAdmissionId?: string; configurationRequestId?: string; value?: unknown }) => {
      if (!message?.configurationAdmissionId) return;
      const allowed = typeof message.configurationRequestId === 'string' && configurationClient.admit(message.configurationRequestId, message.value);
      child.postMessage({ configurationAdmissionId: message.configurationAdmissionId, allowed });
    });
    const researchSecurity = new ResearchSecurityHost(() => security.initialize(), security.matcher, security.recording,
      reply => child.postMessage(reply));
    child.on('message', (message: Parameters<typeof researchSecurity.receive>[0]) => {
      if (message?.channel === 'research_security') void researchSecurity.receive(message);
    });
    child.on('message', (message: { channel?: string; id?: string; meta?: Envelope }) => {
      if (message?.channel !== 'import_metadata_revision' || !message.id || !message.meta) return;
      const { id, meta } = message;
      void security.initialize().then(() => {
        const revision = security.recording.metadataRevision(meta);
        child.postMessage({ channel: 'import_metadata_revision', id, ok: true, revision });
      }).catch(() => child.postMessage({ channel: 'import_metadata_revision', id, ok: false }));
    });
    child.on('message', (message: { id?: string; codexReply?: CodexReply<CodexStoreValue> }) => {
      if (!message?.id || !message.codexReply) return;
      codexClient.receive(message.id, message.codexReply);
    });
    child.on('message', (message: { id?: string; selectionReply?: ClaudeReply<SelectionValue> }) => {
      if (!message?.id || !message.selectionReply) return;
      selectionClient.receive(message.id, message.selectionReply);
    });
    child.once('exit', () => {
      researchSecurity.unavailable();
      importPolicy.close();
      selectionClient.unavailable();
      codexClient.unavailable(); coordinator = null;
      clearTimeout(timer);
      for (const waiting of pending.values()) clearTimeout(waiting.timer);
      pending.clear();
      configurationClient.unavailable();
      if (!ready) reject(new Error('The workspace coordinator exited during startup.'));
      else if (!quitting) {
        dialog.showErrorBox('Workspace unavailable', 'The workspace coordinator stopped. Please restart Autoresearch Lab.');
        app.quit();
      }
    });
  });
}

async function openCredentialSettings() {
  if (credentialWindow) { credentialWindow.focus(); return; }
  credentialWindow = new BrowserWindow({ width: 1000, height: 790, minWidth: 740, minHeight: 650, title: 'Credential settings',
    backgroundColor: '#f5f7f6',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: { preload: CREDENTIAL_WINDOW_PRELOAD_WEBPACK_ENTRY, nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: false } });
  credentialWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  credentialWindow.webContents.on('will-navigate', event => event.preventDefault());
  credentialWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  credentialWindow.on('closed', () => { credentialWindow = null; });
  await credentialWindow.loadURL(CREDENTIAL_WINDOW_WEBPACK_ENTRY);
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 520,
    title: 'Autoresearch Lab', backgroundColor: '#f6f8f7',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { window = null; });
  await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    security = createSecurityHost();
    security.matcher.onMatchingPolicyChanged(() => {
      if (window && !window.isDestroyed()) window.webContents.send('configuration:invalidate', security.matcher.matchingGeneration);
    });
    // Barriers never join the vault queue: a registration may be waiting for an
    // uncertain writer's matching lease, and reconciliation must stay usable.
    ipcMain.handle('metadata:revision', event => { admit(event); return security.matcher.matchingGeneration; });
    ipcMain.handle('metadata:ready', async event => {
      admit(event);
      try { security.credentials.list(); }
      catch { try { await security.initialize(); } catch { /* Domain reads explain locked storage. */ } }
      return security.matcher.matchingGeneration;
    });
    const runpod = new RunpodAdapter(security.credentials, security.sanitizer);
    ipcMain.handle('shell:credential-settings', event => { admit(event); return openCredentialSettings(); });
    metadataHandle('runpod:credentials', async event => {
      admit(event);
      try {
        await security.initialize();
        return { ok: true, credentials: security.credentials.list()
          .filter(entry => entry.category === 'runpod' && entry.status === 'active')
          .map(entry => ({ id: entry.id, label: entry.label || 'Runpod API key' })) };
      } catch { return { ok: false, message: 'Unlock credential storage in Credential settings, then refresh credentials.' }; }
    });
    // All provider reads pass through the actual host-owned adapter and scoped vault.
    metadataHandle('runpod:discover', async (event, credentialId: string) => {
      admit(event);
      try { await security.initialize(); } catch { /* Adapter returns a safe authentication error. */ }
      return runpod.discover(credentialId);
    });
    metadataHandle('runpod:inspect', async (event, credentialId: string, resourceId: string) => {
      admit(event);
      try { await security.initialize(); } catch { /* No raw storage diagnostics cross IPC. */ }
      return runpod.inspect(credentialId, resourceId);
    });
    vast = new VastConnection(security.credentials, security.recording);
    ipcMain.handle('credentials:register', async (event, input: unknown) => {
      if (!credentialWindow || event.sender !== credentialWindow.webContents ||
          event.senderFrame !== credentialWindow.webContents.mainFrame || !validEntry(input)) {
        return { ok: false, message: 'This credential request is not authorized.' };
      }
      try {
        await security.initialize();
        await security.credentials.register(input.category, newId(), input.label, input.value);
        return { ok: true, message: 'Credential saved on this Mac.' };
      } catch {
        return { ok: false, message: 'Credential storage is unavailable or the entry is invalid. Unlock the Keychain and try again.' };
      }
    });
    const trustedEntry = (event: Electron.IpcMainInvokeEvent) => credentialWindow && event.sender === credentialWindow.webContents &&
      event.senderFrame === credentialWindow.webContents.mainFrame;
    const userCredential = (id: string) => {
      const entry = security.credentials.list().find(entry => entry.id === id);
      return entry && ENTRY_CATEGORIES.includes(entry.category as typeof ENTRY_CATEGORIES[number]);
    };
    ipcMain.handle('credentials:vast-session', async (event, input: { id?: unknown; value?: unknown }) => {
      if (!trustedEntry(event)) return { ok: false, message: 'This credential request is not authorized.' };
      try {
        assertId(input?.id);
        if (typeof input.value !== 'string') throw new Error();
        await security.initialize(); await vast.setSession(input.id, input.value);
        return { ok: true, message: 'Vast session available until expiry or app restart. Retry discovery in Compute.' };
      } catch { return { ok: false, message: 'Could not use this session. Select an active Vast API key and unlock credential storage.' }; }
    });
    ipcMain.handle('credentials:help', async (event, category: unknown) => {
      if (!trustedEntry(event) || typeof category !== 'string' || !ENTRY_CATEGORIES.includes(category as typeof ENTRY_CATEGORIES[number])) {
        return { ok: false, message: 'This credential request is not authorized.' };
      }
      const help = CREDENTIAL_HELP[category as typeof ENTRY_CATEGORIES[number]];
      try {
        if (!help.url) return { ok: false, message: 'This credential has no external guide.' };
        await shell.openExternal(help.url);
        return { ok: true, message: 'Credential guide opened in your browser.' };
      } catch { return { ok: false, message: 'Could not open the guide. Check your default browser.' }; }
    });
    ipcMain.handle('credentials:list', async event => {
      if (!trustedEntry(event)) return [];
      try { await security.initialize(); return security.credentials.list().filter(entry => ENTRY_CATEGORIES.includes(entry.category as typeof ENTRY_CATEGORIES[number])); } catch { throw new Error('Unlock credential storage and try again.'); }
    });
    ipcMain.handle('credentials:copy-help', (event, category: unknown) => {
      if (!trustedEntry(event) || typeof category !== 'string' || !ENTRY_CATEGORIES.includes(category as typeof ENTRY_CATEGORIES[number])) {
        return { ok: false, message: 'This credential request is not authorized.' };
      }
      const url = CREDENTIAL_HELP[category as typeof ENTRY_CATEGORIES[number]].url;
      if (!url) return { ok: false, message: 'No credential page address is available.' };
      try { clipboard.writeText(url); return { ok: true, message: 'Address copied.' }; }
      catch { return { ok: false, message: 'Could not copy the address. Select and copy it manually.' }; }
    });
    ipcMain.handle('credentials:replace', async (event, input: { id?: unknown; value?: unknown }) => {
      if (!trustedEntry(event)) return { ok: false, message: 'This credential request is not authorized.' };
      try {
        assertId(input?.id);
        if (typeof input.value !== 'string' || !input.value || input.value.length > 65536) throw new Error();
        await security.initialize();
        if (!userCredential(input.id)) throw new Error();
        await vast.clearSession(input.id);
        await security.credentials.replace(input.id, input.value);
        return { ok: true, message: 'Replacement saved. This app can use the new value.' };
      } catch { return { ok: false, message: 'Replacement failed. Unlock credential storage and try again.' }; }
    });
    ipcMain.handle('credentials:revoke', async (event, id: unknown) => {
      if (!trustedEntry(event)) return { ok: false, message: 'This credential request is not authorized.' };
      try {
        assertId(id); await security.initialize();
        if (!userCredential(id)) throw new Error();
        await vast.clearSession(id);
        await security.credentials.revoke(id);
        return { ok: true, message: 'App access revoked. Revoke the credential with its issuing service too.' };
      } catch { return { ok: false, message: 'App revocation failed. Check credential storage.' }; }
    });
    const status = await startCoordinator();
    metadataHandle('vast:credentials', async event => {
      admit(event);
      try { await security.initialize(); return { ok: true, value: vast.choices() }; }
      catch { return vastFailure('authentication_required', newId()); }
    });
    metadataHandle('vast:discover', async (event, id: unknown) => {
      admit(event);
      try { assertId(id); await security.initialize(); return await vast.discover(id); }
      catch { return vastFailure('authentication_required', newId()); }
    });
    ipcMain.handle('vast:settings', async event => { admit(event); await openCredentialSettings(); });
    const codexExecutable = app.isPackaged ? path.join(process.resourcesPath, 'codex') :
      path.join(app.getAppPath(), 'node_modules/@openai/codex-runtime/vendor/aarch64-apple-darwin/bin/codex');
    const codex = new CodexHost(security, requestCodexStore, signal => StdioAuthRpc.start(codexExecutable, path.join(app.getPath('userData'), 'private-codex'), signal));
    metadataHandle('codex:reconcile-save', (event, requestId: string) => { admit(event); return codex.execute(() => codex.reconcileSave(requestId)); });
    metadataHandle('codex:settings', event => { admit(event); return codex.execute(() => codex.settings()); });
    metadataHandle('codex:recovery', (event, projectId?: string) => { admit(event); return codex.execute(() => codex.recovery(projectId)); });
    ipcMain.handle('codex:credentials', event => { admit(event); return openCredentialSettings(); });
    metadataHandle('codex:authenticate', (event, credentialRef: string) => {
      admit(event); return codex.execute(async () => { assertId(credentialRef); return codex.catalog(credentialRef); });
    });
    metadataHandle('codex:models', event => { admit(event); return codex.execute(() => codex.catalog()); });
    metadataHandle('codex:default', (event, choice: ChooseAgent, requestId: string) => { admit(event); return codex.execute(() => { assertId(requestId); return codex.saveDefault(choice, requestId); }); });
    metadataHandle('codex:run-get', (event, projectId: string) => { admit(event); return codex.execute(() => codex.runSelection(projectId)); });
    metadataHandle('codex:run-save', (event, projectId: string, expectedRevision: number, choice: ChooseAgent, requestId: string) => {
      admit(event); return codex.execute(() => { assertId(requestId); return codex.saveRunSelection(projectId, expectedRevision, choice, requestId); });
    });
    const claude = new ClaudeHost(security.credentials, security.recording, security.initialize, runClaudeWorker, requestSelection,
      async projectId => (await requestProjects({ kind: 'open', projectId, operationId: randomUUID() })).ok);
    metadataHandle('claude:settings', event => { admit(event); return claude.reply(() => claude.settings()); });
    metadataHandle('claude:recovery', event => { admit(event); return claude.reply(() => claude.recovery()); });
    ipcMain.handle('claude:credentials', event => { admit(event); return openCredentialSettings(); });
    metadataHandle('claude:discover', (event, id: string) => { admit(event); return claude.reply(() => { assertId(id); return claude.discover(id); }); });
    metadataHandle('claude:save', (event, choice: ClaudeChoice, revision: number, requestId: string) => {
      admit(event); return claude.reply(() => {
        try { assertId(requestId); } catch { throw new ClaudeFailure('invalid_input'); }
        return claude.save(choice, revision, requestId);
      });
    });
    metadataHandle('claude:qualify', (event, choice: ClaudeChoice) => { admit(event); return claude.reply(() => claude.qualify(choice)); });
    metadataHandle('claude:runs', (event, projectId: string) => { admit(event); return claude.reply(() => { assertId(projectId); return claude.runs(projectId); }); });
    metadataHandle('claude:save-run', (event, input: { projectId: string; runId: string; snapshotId: string; choice: ClaudeChoice }) => {
      admit(event); return claude.reply(() => {
        assertId(input?.projectId); assertId(input?.runId); assertId(input?.snapshotId);
        return claude.saveRun(input);
      });
    });
    ipcMain.handle('shell:get-status', (event) => {
      admit(event);
      return status;
    });
    metadataHandle('configuration:request', async (event, request: ConfigurationRequest) => {
      admit(event);
      try {
        assertId(request?.operationId);
        // Load app-owned current/retired matching values before admitting semantic
        // settings. Reject unsafe settings instead of saving redacted semantics.
        await security.initialize();
        security.assertSafeConfiguration(request);
        const reply = await configurationClient.request(request);
        security.assertSafeConfiguration(reply);
        return reply;
      } catch {
        return { ok: false, error: { code: 'unavailable', origin: 'run_configuration', operationId: '',
          message: 'Settings could not be safely admitted. Remove credentials from choices, unlock credential storage and reload. Saved choices may need review if a credential was registered later.', effect: 'unknown', retry: 'after_reconcile' } };
      }
    });
    ipcMain.handle('projects:list', (event) => {
      admit(event);
      return requestProjects({ kind: 'list', operationId: randomUUID() });
    });
    ipcMain.handle('projects:create', (event, input: CreateProject) => {
      admit(event);
      return requestProjects({ kind: 'create', operationId: input?.requestId, input });
    });
    for (const kind of ['open', 'recover'] as const) {
      ipcMain.handle(`projects:${kind}`, (event, projectId: string) => {
        admit(event);
        return requestProjects({ kind, operationId: randomUUID(), projectId });
      });
    }
    metadataHandle('imports:select', async (event, kind: unknown) => {
      admit(event);
      if (kind !== 'directory' && kind !== 'files') throw new Error('Invalid selection');
      const result = await dialog.showOpenDialog(window!, { title: 'Select local dataset', properties: kind === 'directory' ? ['openDirectory'] : ['openFile', 'multiSelections'],
        ...(kind === 'files' ? { filters: [{ name: 'Supported dataset files', extensions: ['jpg', 'jpeg', 'png', 'csv', 'jsonl', 'txt'] }] } : {}) });
      if (result.canceled || !result.filePaths.length) return null;
      const selectionId = randomUUID();
      if (selections.size >= 100) selections.clear();
      selections.set(selectionId, { paths: result.filePaths, directory: kind === 'directory' });
      return { selectionId, fileCount: result.filePaths.length, directory: kind === 'directory' };
    });
    metadataHandle('imports:start', (event, projectId: string, input: StartImport) => {
      admit(event);
      const selected = selections.get(input?.selectionId);
      if (!selected || (input.mode === 'move' && !selected.directory)) throw new Error('Select the dataset again. Move needs one dedicated directory.');
      return requestImports({ kind: 'imports:start', operationId: input.requestId, projectId, sourcePaths: selected.paths, destinationName: input.destinationName, mode: input.mode });
    });
    metadataHandle('imports:list', (event, projectId: string) => {
      admit(event); return requestImports({ kind: 'imports:list', operationId: randomUUID(), projectId });
    });
    metadataHandle('imports:action', (event, projectId: string, importId: string, expectedRevision: number, action: ImportAction) => {
      admit(event); return requestImports({ kind: 'imports:action', operationId: randomUUID(), projectId, importId, expectedRevision, action });
    });
    ipcMain.handle('projects:copy-workspace-location', async (event) => {
      admit(event);
      const operationId = randomUUID();
      const reply = await requestProjects({ kind: 'list', operationId });
      if (!reply.ok) return reply;
      if (!('projectsFolder' in reply.value)) throw new Error('Invalid workspace response.');
      try {
        clipboard.writeText(reply.value.projectsFolder);
        return { ok: true, value: null };
      } catch {
        return { ok: false, error: { code: 'unavailable', origin: 'project_catalog', operationId,
          message: 'The workspace path could not be copied. Select and copy the displayed path instead.', effect: 'none', retry: 'same_key' } };
      }
    });
    for (const kind of ['location', 'repository'] as const) ipcMain.handle(`projects:copy-${kind}`, async (event, projectId: string) => {
      admit(event);
      const operationId = randomUUID();
      const reply = await requestProjects({ kind: 'open', operationId, projectId });
      if (!reply.ok) return reply;
      if (!('projectId' in reply.value)) throw new Error('Invalid project response.');
      try { clipboard.writeText(reply.value[kind]); return { ok: true, value: null }; }
      catch { return { ok: false, error: { code: 'unavailable', origin: 'project_catalog', operationId,
        message: 'The requested project path could not be copied. Select and copy its full path instead.', effect: 'none', retry: 'same_key' } }; }
    });
    for (const kind of ['location', 'repository'] as const) ipcMain.handle(kind === 'location' ? 'projects:reveal' : 'projects:reveal-repository', async (event, projectId: string) => {
      admit(event);
      const operationId = randomUUID();
      const reply = await requestProjects({ kind: 'open', operationId, projectId });
      if (!reply.ok) return reply;
      // Resolve and validate through the catalog; the renderer never supplies a path.
      if (!('projectId' in reply.value)) throw new Error('Invalid project response.');
      try {
        const failure = await shell.openPath(reply.value[kind]);
        if (!failure) return { ok: true, value: null };
      } catch { /* Only a safe host error crosses the bridge. */ }
      return { ok: false, error: { code: 'unavailable', origin: 'project_catalog', operationId,
        message: 'Finder could not open the requested project folder. Restore folder access and retry.', effect: 'none', retry: 'same_key' } };
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'about' }, { id: 'credential-settings', label: 'Credential settings…', click: () => { void openCredentialSettings(); } },
        { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { role: 'windowMenu' },
    ]));
    await createWindow();
    app.on('activate', () => { if (!window) void createWindow(); });
  }).catch(() => {
    dialog.showErrorBox('Unable to open Autoresearch Lab', startupFailure);
    process.exitCode = 1;
    app.quit();
  });
}

// This shell cannot start runs. Active-run close/quit coordination is owned by #73.
app.on('before-quit', () => { quitting = true; stopCodexAuthentication(); });
app.on('will-quit', () => { coordinator?.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
