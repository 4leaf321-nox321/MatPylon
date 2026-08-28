import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type EngineStatus, type MatPylonApi } from "@shared/ipc";

const api: MatPylonApi = {
  getStatus: () => ipcRenderer.invoke(CHANNELS.getStatus),
  onStatus: (listener) => {
    const handler = (_e: unknown, status: EngineStatus) => listener(status);
    ipcRenderer.on(CHANNELS.status, handler);
    return () => ipcRenderer.off(CHANNELS.status, handler);
  },
  sendNow: () => ipcRenderer.invoke(CHANNELS.sendNow),
  pause: () => ipcRenderer.invoke(CHANNELS.pause),
  resume: () => ipcRenderer.invoke(CHANNELS.resume),
  getConfig: () => ipcRenderer.invoke(CHANNELS.getConfig),
  setConfig: (config) => ipcRenderer.invoke(CHANNELS.setConfig, config),
  hasToken: () => ipcRenderer.invoke(CHANNELS.hasToken),
  setToken: (token) => ipcRenderer.invoke(CHANNELS.setToken, token),
  testConnection: (url, tls) => ipcRenderer.invoke(CHANNELS.testConnection, url, tls),
  registerConnector: (url, name, ws) => ipcRenderer.invoke(CHANNELS.registerConnector, url, name, ws),
  listFiles: (status) => ipcRenderer.invoke(CHANNELS.listFiles, status),
  requeue: (id) => ipcRenderer.invoke(CHANNELS.requeue, id),
  pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
  pickFile: (filters) => ipcRenderer.invoke(CHANNELS.pickFile, filters),
  listFilenames: (dir, limit) => ipcRenderer.invoke(CHANNELS.listFilenames, dir, limit),
  logTail: (lines) => ipcRenderer.invoke(CHANNELS.logTail, lines),
  openLogFolder: () => ipcRenderer.invoke(CHANNELS.openLogFolder),
  openDataFolder: () => ipcRenderer.invoke(CHANNELS.openDataFolder),
  exportConfig: () => ipcRenderer.invoke(CHANNELS.exportConfig),
  importConfig: () => ipcRenderer.invoke(CHANNELS.importConfig),
  paths: () => ipcRenderer.invoke(CHANNELS.paths),
  getAutoLaunch: () => ipcRenderer.invoke(CHANNELS.getAutoLaunch),
  setAutoLaunch: (enabled) => ipcRenderer.invoke(CHANNELS.setAutoLaunch, enabled),
};

contextBridge.exposeInMainWorld("matpylon", api);
