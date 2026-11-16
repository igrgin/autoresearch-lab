import { contextBridge, ipcRenderer } from 'electron';
import type { CredentialEntry } from './security/entry-contract';
contextBridge.exposeInMainWorld('credentialEntry', {
  save: (entry: CredentialEntry) => ipcRenderer.invoke('credentials:register', entry),
  list: () => ipcRenderer.invoke('credentials:list'),
  help: (category: string) => ipcRenderer.invoke('credentials:help', category),
  copyHelp: (category: string) => ipcRenderer.invoke('credentials:copy-help', category),
  replace: (id: string, value: string) => ipcRenderer.invoke('credentials:replace', { id, value }),
  revoke: (id: string) => ipcRenderer.invoke('credentials:revoke', id),
});
