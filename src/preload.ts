import { contextBridge, ipcRenderer } from 'electron';
import type { ShellBridge } from './shell';

const bridge: ShellBridge = {
  getStatus: () => ipcRenderer.invoke('shell:get-status'),
};
contextBridge.exposeInMainWorld('lab', bridge);
