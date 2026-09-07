import { contextBridge, ipcRenderer, webFrame } from "electron";

// Per-frame, unlike webContents.setZoomFactor, which Chromium keys by origin and would
// therefore leak between windows sharing app://.
const zoomArgument = process.argv.find((argument) => argument.startsWith("--sv-zoom="));
if (zoomArgument) webFrame.setZoomFactor(Number(zoomArgument.slice("--sv-zoom=".length)));

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
