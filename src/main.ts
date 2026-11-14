import { app, BrowserWindow, dialog, ipcMain, Menu, utilityProcess } from 'electron';
import path from 'node:path';
import type { ShellStatus } from './shell';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

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
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted shell request.');
      }
      return status;
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
