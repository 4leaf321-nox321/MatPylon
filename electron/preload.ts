import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type EngineStatus, type MatPylonApi } from "@shared/ipc";

const api: MatPylonApi = {
  getStatus: () => ipcRenderer.invoke(CHANNELS.getStatus),
  onStatus: (listener) => {
    const handler = (_e: unknown, status: EngineStatus) => listener(status);
    ipcRenderer.on(CHANNELS.status, handler);
    return () => ipcRenderer.off(CHANNELS.status, handler);
  },
  getAutoLaunch: () => ipcRenderer.invoke(CHANNELS.getAutoLaunch),
  setAutoLaunch: (enabled) => ipcRenderer.invoke(CHANNELS.setAutoLaunch, enabled),
};

contextBridge.exposeInMainWorld("matpylon", api);
