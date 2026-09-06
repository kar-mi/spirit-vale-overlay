import { contextBridge, ipcRenderer } from "electron";

// The only renderer-owned native surface under Electron: the custom-titlebar
// actions and the frameless-drag frame accessors. Everything else (window
// lifecycle, overlay styles, dialogs, tray) is driven from the backend/main.

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const bridge = {
  windowAction: (action: "minimize" | "close"): Promise<void> => ipcRenderer.invoke("sv:window-action", action),
  getWindowFrame: (): Promise<WindowFrame> => ipcRenderer.invoke("sv:get-window-frame"),
  setWindowFrame: (frame: WindowFrame): Promise<void> => ipcRenderer.invoke("sv:set-window-frame", frame),
  onBackendReady: (handler: (payload: { port: number; ticket: string }) => void): void => {
    ipcRenderer.on("sv:backend-ready", (_event, payload) => handler(payload));
  },
  onBackendFatal: (handler: (payload: unknown) => void): void => {
    ipcRenderer.on("sv:backend-fatal", (_event, payload) => handler(payload));
  },
  openPath: (target: string): Promise<void> => ipcRenderer.invoke("sv:open-path", target),
  quit: (): Promise<void> => ipcRenderer.invoke("sv:quit"),
};

export type SpiritValeBridge = typeof bridge;

contextBridge.exposeInMainWorld("spiritVale", bridge);
