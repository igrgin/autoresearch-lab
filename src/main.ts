import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, utilityProcess } from 'electron';
import path from 'node:path';
import type { ShellStatus } from './shell';
import { createSecurityHost } from './security/electron-vault';
import { CREDENTIAL_HELP, ENTRY_CATEGORIES, validEntry } from './security/entry-contract';
import { assertId, newId } from './security/common';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

declare const CREDENTIAL_WINDOW_WEBPACK_ENTRY: string;
declare const CREDENTIAL_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
let credentialWindow: BrowserWindow | null = null;
let security: ReturnType<typeof createSecurityHost>;
let window: BrowserWindow | null = null;
let coordinator: ReturnType<typeof utilityProcess.fork> | null = null;
let quitting = false;

function startCoordinator(): Promise<ShellStatus> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'coordinator.cjs'), [], {
      serviceName: 'Autoresearch Lab Coordinator',
    });
    coordinator = child;
    let ready = false;
    const timer = setTimeout(() => {
      reject(new Error('The workspace coordinator did not start in time.'));
    }, 15_000);
    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (!message || typeof message !== 'object' || !('coordinator' in message) ||
          message.coordinator !== 'ready' || !('sqliteVersion' in message) || typeof message.sqliteVersion !== 'string') {
        reject(new Error('The workspace coordinator returned an invalid startup response.'));
        return;
      }
      ready = true;
      resolve({ coordinator: 'ready', sqliteVersion: message.sqliteVersion });
    });
    child.once('exit', () => {
      clearTimeout(timer);
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
    title: 'Autoresearch Lab', backgroundColor: '#f5f6f8',
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
        await security.credentials.replace(input.id, input.value);
        return { ok: true, message: 'Replacement saved. This app can use the new value.' };
      } catch { return { ok: false, message: 'Replacement failed. Unlock credential storage and try again.' }; }
    });
    ipcMain.handle('credentials:revoke', async (event, id: unknown) => {
      if (!trustedEntry(event)) return { ok: false, message: 'This credential request is not authorized.' };
      try {
        assertId(id); await security.initialize();
        if (!userCredential(id)) throw new Error();
        await security.credentials.revoke(id);
        return { ok: true, message: 'App access revoked. Revoke the credential with its issuing service too.' };
      } catch { return { ok: false, message: 'App revocation failed. Check credential storage.' }; }
    });
    const status = await startCoordinator();
    ipcMain.handle('shell:get-status', (event) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted shell request.');
      }
      return status;
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
    dialog.showErrorBox('Unable to open Autoresearch Lab', 'Workspace startup failed. Restart the application.');
    process.exitCode = 1;
    app.quit();
  });
}

// This shell cannot start runs. Active-run close/quit coordination is owned by #73.
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { coordinator?.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
