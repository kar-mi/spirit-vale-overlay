import path from "node:path";
import { BrowserWindow, screen } from "electron";
import type { CreateWindowPayload } from "../shell-protocol.ts";

interface Rect { x: number; y: number; width: number; height: number }

// The backend speaks physical pixels throughout (its displays come from Win32
// EnumDisplayMonitors, and Neutralino windows are created with useLogicalPixels:false),
// but Electron's window bounds are DIPs. Convert at this boundary so overlay tiles land
// where the backend placed them on a scaled display.
export const toDip = (rect: Rect, win?: BrowserWindow): Rect =>
  process.platform === "win32" ? screen.screenToDipRect(win ?? null, rect) : rect;
export const toPhysical = (rect: Rect, win?: BrowserWindow): Rect =>
  process.platform === "win32" ? screen.dipToScreenRect(win ?? null, rect) : rect;

export interface WindowHostCallbacks {
  onWindowEvent(windowId: string, event: string, data: unknown): void;
  onHandle(windowId: string, handle: Buffer | null): void;
}

const FORWARDED_EVENTS: Array<[string, string]> = [
  ["move", "windowMove"],
  ["resize", "windowResize"],
  ["focus", "windowFocus"],
  ["blur", "windowBlur"],
  ["minimize", "windowMinimize"],
  ["restore", "windowRestore"],
  ["maximize", "windowMaximize"],
  ["unmaximize", "windowRestore"],
  ["close", "windowClose"],
];

export class WindowHost {
  private readonly windows = new Map<string, BrowserWindow>();

  constructor(
    private readonly preloadPath: string,
    private readonly callbacks: WindowHostCallbacks,
  ) {}

  get(windowId: string): BrowserWindow | undefined {
    return this.windows.get(windowId);
  }

  register(windowId: string, win: BrowserWindow): void {
    this.windows.set(windowId, win);
    win.once("closed", () => this.windows.delete(windowId));
    for (const [nativeEvent, wireEvent] of FORWARDED_EVENTS) {
      win.on(nativeEvent as never, () => {
        const bounds = win.isDestroyed()
          ? { x: 0, y: 0, width: 0, height: 0 }
          : toPhysical(win.getBounds(), win);
        this.callbacks.onWindowEvent(windowId, wireEvent, bounds);
      });
    }
    this.callbacks.onHandle(windowId, win.getNativeWindowHandle());
  }

  createLauncher(url: string, iconPath: string): BrowserWindow {
    const win = new BrowserWindow({
      width: 1024,
      height: 720,
      show: true,
      frame: false,
      icon: iconPath,
      backgroundColor: "#0c110e",
      webPreferences: { preload: this.preloadPath, contextIsolation: true, sandbox: false },
    });
    this.register("launcher", win);
    void win.loadURL(url);
    return win;
  }

  create(payload: CreateWindowPayload): BrowserWindow {
    const frame = toDip(payload.frame);
    const win = new BrowserWindow({
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      show: false,
      frame: !payload.borderless,
      transparent: payload.transparent,
      resizable: payload.resizable ?? true,
      alwaysOnTop: payload.alwaysOnTop,
      skipTaskbar: payload.skipTaskbar,
      hasShadow: !payload.transparent,
      webPreferences: { preload: this.preloadPath, contextIsolation: true, sandbox: false },
    });
    this.register(payload.windowId, win);
    void win.loadURL(payload.url.startsWith("/") ? `app://-${payload.url}` : payload.url);
    return win;
  }

  async runCommand(windowId: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    const win = this.windows.get(windowId);
    if (!win || win.isDestroyed()) throw new Error(`Window ${windowId} is not available.`);
    switch (method) {
      case "show": win.showInactive(); return undefined;
      case "hide": win.hide(); return undefined;
      case "focus": win.focus(); return undefined;
      case "minimize": win.minimize(); return undefined;
      case "maximize": win.maximize(); return undefined;
      case "unmaximize": win.unmaximize(); return undefined;
      case "close": win.close(); return undefined;
      case "isMaximized": return win.isMaximized();
      case "setAlwaysOnTop": win.setAlwaysOnTop(Boolean(params?.["enabled"])); return undefined;
      case "setSkipTaskbar": win.setSkipTaskbar(Boolean(params?.["enabled"])); return undefined;
      case "setIgnoreMouseEvents": win.setIgnoreMouseEvents(Boolean(params?.["enabled"])); return undefined;
      case "getBounds": return toPhysical(win.getBounds(), win);
      case "setBounds": {
        win.setBounds(toDip({
          x: Number(params?.["x"]),
          y: Number(params?.["y"]),
          width: Number(params?.["width"]),
          height: Number(params?.["height"]),
        }, win));
        return undefined;
      }
      case "openExternal": return undefined;
      case "executeJavascript": return win.webContents.executeJavaScript(String(params?.["script"]));
      default: throw new Error(`Unknown window command: ${method}`);
    }
  }

  destroyAll(options: { preserveLauncher?: boolean } = {}): void {
    for (const [windowId, win] of this.windows) {
      if (options.preserveLauncher && windowId === "launcher") continue;
      if (!win.isDestroyed()) win.destroy();
    }
  }
}

export function iconPathFor(resourcesRoot: string): string {
  return path.join(resourcesRoot, "views", "assets", "app-icon.ico");
}
