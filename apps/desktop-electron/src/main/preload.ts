import { contextBridge, ipcRenderer } from "electron";

const bridge = {
  onBackendReady: (handler: (payload: { port: number; ticket: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { port: number; ticket: string }): void => handler(payload);
    ipcRenderer.on("sv:backend-ready", listener);
    return () => ipcRenderer.removeListener("sv:backend-ready", listener);
  },
  onBackendFatal: (handler: (payload: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => handler(payload);
    ipcRenderer.on("sv:backend-fatal", listener);
    return () => ipcRenderer.removeListener("sv:backend-fatal", listener);
  },
  openPath: (target: string): Promise<void> => ipcRenderer.invoke("sv:open-path", target),
  quit: (): Promise<void> => ipcRenderer.invoke("sv:quit"),
};

export type SpiritValeBridge = typeof bridge;

contextBridge.exposeInMainWorld("spiritVale", bridge);
