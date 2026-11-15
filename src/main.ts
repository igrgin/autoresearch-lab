import { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard, utilityProcess } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateProject, ProjectReply, ProjectRequest, ProjectRecord, WorkspaceProjects } from './projects';
import type { ShellStatus } from './shell';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let window: BrowserWindow | null = null;
let coordinator: ReturnType<typeof utilityProcess.fork> | null = null;
let quitting = false;
const pending = new Map<string, { resolve: (reply: ProjectReply<ProjectRecord | WorkspaceProjects>) => void; timer: ReturnType<typeof setTimeout> }>();

function requestProjects(request: ProjectRequest): Promise<ProjectReply<ProjectRecord | WorkspaceProjects>> {
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

function admit(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Untrusted workspace request.');
  }
}

function startCoordinator(): Promise<ShellStatus> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'coordinator.cjs'), [app.getPath('userData')], {
      serviceName: 'Autoresearch Lab Coordinator',
    });
    coordinator = child;
    let ready = false;
    const timer = setTimeout(() => {
      reject(new Error('The workspace coordinator did not start in time.'));
    }, 15_000);
    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (message && typeof message === 'object' && 'coordinator' in message && message.coordinator === 'failed' && 'message' in message && typeof message.message === 'string') {
        reject(new Error(message.message));
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
    child.on('message', (message: { id?: string; reply?: ProjectReply<ProjectRecord | WorkspaceProjects> }) => {
      if (!message?.id || !message.reply) return;
      const waiting = pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      waiting.resolve(message.reply);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      for (const waiting of pending.values()) clearTimeout(waiting.timer);
      pending.clear();
      if (!ready) reject(new Error('The workspace coordinator exited during startup.'));
      else if (!quitting) {
        dialog.showErrorBox('Workspace unavailable', 'The workspace coordinator stopped. Please restart Autoresearch Lab.');
        app.quit();
      }
    });
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 520,
    title: 'Autoresearch Lab', backgroundColor: '#f5f6f8',
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
    const status = await startCoordinator();
    ipcMain.handle('shell:get-status', (event) => {
      admit(event);
      return status;
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
    ipcMain.handle('projects:copy-location', async (event, projectId: string) => {
      admit(event);
      const operationId = randomUUID();
      const reply = await requestProjects({ kind: 'open', operationId, projectId });
      if (!reply.ok) return reply;
      if (!('projectId' in reply.value)) throw new Error('Invalid project response.');
      try { clipboard.writeText(reply.value.location); return { ok: true, value: null }; }
      catch { return { ok: false, error: { code: 'unavailable', origin: 'project_catalog', operationId,
        message: 'The project path could not be copied. Select and copy its full path instead.', effect: 'none', retry: 'same_key' } }; }
    });
    ipcMain.handle('projects:reveal', async (event, projectId: string) => {
      admit(event);
      const operationId = randomUUID();
      const reply = await requestProjects({ kind: 'open', operationId, projectId });
      if (!reply.ok) return reply;
      // Resolve and validate through the catalog; the renderer never supplies a path.
      if (!('projectId' in reply.value)) throw new Error('Invalid project response.');
      try {
        const failure = await shell.openPath(reply.value.location);
        if (!failure) return { ok: true, value: null };
      } catch { /* Only a safe host error crosses the bridge. */ }
      return { ok: false, error: { code: 'unavailable', origin: 'project_catalog', operationId,
        message: 'Finder could not open this project folder. Restore folder access and retry.', effect: 'none', retry: 'same_key' } };
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { role: 'windowMenu' },
    ]));
    await createWindow();
    app.on('activate', () => { if (!window) void createWindow(); });
  }).catch((error: unknown) => {
    dialog.showErrorBox('Unable to open Autoresearch Lab', error instanceof Error ? error.message : 'Workspace startup failed.');
    process.exitCode = 1;
    app.quit();
  });
}

// This shell cannot start runs. Active-run close/quit coordination is owned by #73.
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { coordinator?.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
