import path from "node:path";
import { BrowserWindow } from "electron";
import type { CreateWindowPayload } from "../shell-protocol.ts";

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
        const [x, y] = win.isDestroyed() ? [0, 0] : win.getPosition();
        const [width, height] = win.isDestroyed() ? [0, 0] : win.getSize();
        this.callbacks.onWindowEvent(windowId, wireEvent, { x, y, width, height });
      });
    }
    win.webContents.once("did-finish-load", () => {
      this.callbacks.onHandle(windowId, win.isDestroyed() ? null : win.getNativeWindowHandle());
    });
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
    const win = new BrowserWindow({
      x: payload.frame.x,
      y: payload.frame.y,
      width: payload.frame.width,
      height: payload.frame.height,
      show: false,
      frame: !payload.borderless,
      transparent: payload.transparent,
      resizable: payload.resizable ?? true,
      alwaysOnTop: payload.alwaysOnTop,
      skipTaskbar: payload.skipTaskbar,
      // Overlay surfaces must never steal focus from the game; the raw
      // WS_EX_NOACTIVATE style applied backend-side reinforces this.
      focusable: !payload.transparent,
      hasShadow: !payload.transparent,
      webPreferences: { preload: this.preloadPath, contextIsolation: true, sandbox: false },
    });
    this.register(payload.windowId, win);
    // The backend hands us a root-relative view path ("/views/…?port=&ticket=");
    // the launcher URL is already fully-qualified against the app:// scheme.
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
      case "getBounds": return win.getBounds();
      case "setBounds": {
        win.setBounds({
          x: Number(params?.["x"]),
          y: Number(params?.["y"]),
          width: Number(params?.["width"]),
          height: Number(params?.["height"]),
        });
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
