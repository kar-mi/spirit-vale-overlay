import path from "node:path";

import type { CombinedSchema, RpcInstance } from "../shared/rpc.ts";
import { defineRpc } from "../shared/rpc.ts";
import { backendConnectionUrl } from "../shared/backend-connection.ts";
import { DesktopRpcServer, type Session } from "../backend/rpc-server.ts";
import { NeutralinoClient } from "../backend/neutralino-client.ts";
import {
  configureOverlayWindow,
  findWindowHandle,
  getDisplays,
  setOverlayWindowVisible,
} from "../backend/win32.ts";

console.log("hello from ./desktop/frontend/runtime.ts");

type Frame = { x: number; y: number; width: number; height: number };
type Handler = (...args: unknown[]) => void;

class RuntimeEvents {
  private readonly listeners = new Map<string, Set<Handler>>();
  on(name: string, handler: Handler): void {
    const entries = this.listeners.get(name) ?? new Set<Handler>();
    entries.add(handler);
    this.listeners.set(name, entries);
  }
  off(name: string, handler: Handler): void { this.listeners.get(name)?.delete(handler); }
  once(name: string, handler: Handler): void {
    const wrapper: Handler = (...args) => { this.off(name, wrapper); handler(...args); };
    this.on(name, wrapper);
  }
  emit(name: string, payload: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
}

const events = new RuntimeEvents();
let native: NeutralinoClient | undefined;
let server: DesktopRpcServer | undefined;
let launcherSession: Session | undefined;
let announceTimer: ReturnType<typeof setInterval> | undefined;
let appVersion = "0.0.0";
let nextWindowId = 0;
let shuttingDown = false;
const sessions = new Map<string, Session>();
const windows = new Map<string, BrowserWindow>();
const pendingWindows = new Set<BrowserWindow>();
const trays = new Set<Tray>();

export function isDesktopWindowProcess(processId: number): boolean {
  for (const session of sessions.values()) {
    if (session.processId === processId) return true;
  }
  return false;
}

// Each child window (combat, overlay, rewards, etc.) is its own Neutralino OS
// process, spawned as a child of the root app the same way the bun extension is.
// If we are exiting because the root app disappeared out from under us rather
// than through the normal RPC-driven window-close sequence, nothing else will
// ever tell those processes to close, leaving them stuck on screen. Kill them
// directly by their tracked OS pid before we exit ourselves.
export function terminateAllWindowProcesses(): void {
  for (const session of sessions.values()) {
    if (session.processId === undefined) continue;
    try { process.kill(session.processId); } catch {}
  }
}

export async function initializeNeutralinoRuntime(options: { version: string }): Promise<void> {
  appVersion = options.version;

  console.log("native = await NeutralinoClient.fromStdin();");
  native = await NeutralinoClient.fromStdin();
  console.log(":", native);

  console.log("server = new DesktopRpcServer();");
  server = new DesktopRpcServer();
  console.log(":", server);

  server.onSession = attachSession;
  server.onClose = detachSession;
  server.onWindowEvent = receiveWindowEvent;
  native.on("trayMenuItemClicked", (data) => {
    const action = String((data as { id?: string })?.id ?? "");
    for (const tray of trays) tray.dispatch(action);
  });
  native.onClose(() => {
    if (shuttingDown) return;
    terminateAllWindowProcesses();
    process.exit(0);
  });
  announceTimer = setInterval(() => void announceLauncher(), 750);
  await announceLauncher();
}

async function announceLauncher(): Promise<void> {
  if (!native || !server || launcherSession || shuttingDown) return;
  const ticket = server.issueWindow("launcher");

  console.log("announceLauncher()");

  await native.call("app.broadcast", { event: "desktopBackendReady", data: { port: server.port, ticket } });
}

function attachSession(session: Session): void {
  sessions.set(session.windowId, session);
  if (session.windowId === "launcher") {
    launcherSession = session;
    if (announceTimer) clearInterval(announceTimer);
    announceTimer = undefined;
    for (const window of [...pendingWindows]) void launchWindow(window);
  }
  windows.get(session.windowId)?.attach(session);
}

function detachSession(session: Session): void {
  if (sessions.get(session.windowId) !== session) return;
  sessions.delete(session.windowId);
  if (launcherSession === session) launcherSession = undefined;
  windows.get(session.windowId)?.detach(session);
}

function receiveWindowEvent(session: Session, event: string, data: unknown): void {
  windows.get(session.windowId)?.receiveEvent(event, data);
}

async function launchWindow(window: BrowserWindow): Promise<void> {
  if (!server || !launcherSession || window.launched || window.id === "launcher") return;
  pendingWindows.delete(window);
  window.launched = true;
  const ticket = server.issueWindow(window.id);
  const url = backendConnectionUrl(window.url.replace("views://", "/views/"), { port: server.port, ticket });
  try {
    await launcherSession.command("createWindow", {
      url,
      options: {
        title: window.title,
        ...window.frame,
        borderless: window.titleBarStyle === "hidden",
        transparent: window.transparent,
        hidden: true,
        alwaysOnTop: window.alwaysOnTop,
        exitProcessOnClose: true,
        injectGlobals: true,
        injectClientLibrary: false,
        useLogicalPixels: false,
        processArgs: `--window-skip-taskbar=${window.skipTaskbar} --window-use-saved-state=false`,
      },
    });
  } catch (error) {
    window.launched = false;
    pendingWindows.add(window);
    console.error(`[neutralino] could not launch ${window.title}:`, error);
  }
}

class RuntimeWebview {
  readonly id: string;
  constructor(private readonly owner: { id: string; command<T = unknown>(method: string, params?: unknown): Promise<T> }) { this.id = `${owner.id}-view`; }
  executeJavascript(script: string): void { void this.owner.command("executeJavascript", { script }); }
}

interface WindowOptions<Schema extends CombinedSchema = CombinedSchema> {
  title: string;
  url: string;
  frame: Frame;
  titleBarStyle?: string;
  transparent?: boolean;
  hidden?: boolean;
  rpc: RpcInstance<Schema, "bun">;
}

export class BrowserWindow<Schema extends CombinedSchema = CombinedSchema> {
  readonly id: string;
  readonly webview: RuntimeWebview;
  readonly title: string;
  readonly url: string;
  readonly titleBarStyle?: string;
  readonly transparent: boolean;
  frame: Frame;
  launched = false;
  alwaysOnTop = false;
  skipTaskbar = false;
  private session?: Session;
  private maximized = false;
  private closed = false;
  private desiredVisible: boolean;
  private clickThrough = false;
  private readonly rpc: RpcInstance<Schema, "bun">;

  constructor(options: WindowOptions<Schema>) {
    this.title = options.title;
    this.url = options.url;
    this.frame = { ...options.frame };
    this.titleBarStyle = options.titleBarStyle;
    this.transparent = options.transparent === true;
    this.desiredVisible = options.hidden !== true;
    this.rpc = options.rpc;
    this.id = options.url.includes("launcherview") ? "launcher" : `${viewName(options.url)}-${++nextWindowId}`;
    this.webview = new RuntimeWebview(this);
    windows.set(this.id, this as BrowserWindow);
    const connected = sessions.get(this.id);
    if (connected) this.attach(connected);
    if (this.id === "launcher") {
      this.launched = true;
      if (launcherSession) this.attach(launcherSession);
    } else {
      pendingWindows.add(this as BrowserWindow);
      void launchWindow(this as BrowserWindow);
    }
  }

  get ptr(): unknown { return this.session?.processId ? findWindowHandle(this.session.processId) : undefined; }

  attach(session: Session): void {
    this.session = session;
    this.rpc.setTransport(session.transport());
    events.emit(`dom-ready-${this.webview.id}`, { data: {} });
    void this.applyNativeState();
  }

  detach(session: Session): void {
    if (this.session !== session) return;
    this.session = undefined;
    this.rpc.close("Window closed.");
    this.emitClose();
  }

  receiveEvent(event: string, data: unknown): void {
    if (event === "windowMove") {
      const point = data as Partial<Frame>;
      this.frame = { ...this.frame, x: Number(point.x ?? this.frame.x), y: Number(point.y ?? this.frame.y) };
      events.emit(`move-${this.id}`, { data: { ...this.frame } });
    } else if (event === "windowResize") {
      const size = data as Partial<Frame>;
      this.frame = { ...this.frame, width: Number(size.width ?? this.frame.width), height: Number(size.height ?? this.frame.height) };
      events.emit(`resize-${this.id}`, { data: { ...this.frame } });
    } else if (event === "windowMaximize") {
      this.maximized = true;
      events.emit(`maximize-${this.id}`, { data });
    } else if (event === "windowRestore") {
      this.maximized = false;
      events.emit(`restore-${this.id}`, { data });
    } else if (event === "windowClose") this.emitClose();
    else events.emit(`${event.replace(/^window/, "").toLowerCase()}-${this.id}`, { data });
  }

  command<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.session?.command<T>(method, params) ?? Promise.reject(new Error(`${this.title} is not connected.`));
  }

  show(): void { this.desiredVisible = true; void this.applyVisibility(true); }
  showInactive(): void { this.show(); }
  hide(): void { this.desiredVisible = false; void this.applyVisibility(false); }
  activate(): void { void this.command("focus"); }
  minimize(): void { void this.command("minimize"); }
  maximize(): void { this.maximized = true; void this.command("maximize"); }
  unmaximize(): void { this.maximized = false; void this.command("unmaximize"); }
  close(): void { this.closed = true; void this.command("close").catch(() => this.emitClose()); }
  setAlwaysOnTop(enabled: boolean): void { this.alwaysOnTop = enabled; void this.command("setAlwaysOnTop", { enabled }).catch(() => {}); }
  hideFromTaskbar(): void { this.skipTaskbar = true; if (this.session) void this.applyNativeState(); }
  setClickThrough(enabled: boolean): void { this.clickThrough = enabled; if (this.session) void this.applyNativeState(); }
  setFrame(x: number, y: number, width: number, height: number): void {
    this.frame = { x, y, width, height };
    void this.command("setBounds", this.frame).catch(() => {});
  }
  setSize(width: number, height: number): void { this.setFrame(this.frame.x, this.frame.y, width, height); }
  getFrame(): Frame { return { ...this.frame }; }
  isMaximized(): boolean { return this.maximized; }

  private async applyNativeState(): Promise<void> {
    const pid = this.session?.processId;
    if (!pid) return;
    await this.command("setAlwaysOnTop", { enabled: this.alwaysOnTop }).catch(() => {});
    if (this.transparent) {
      const ready = await configureOverlayWindow(pid, this.clickThrough);
      if (!ready && this.clickThrough) return;
    }
    await this.applyVisibility(this.desiredVisible);
  }

  private async applyVisibility(visible: boolean): Promise<void> {
    const pid = this.session?.processId;
    if (this.transparent && pid) {
      setOverlayWindowVisible(pid, visible, this.frame);
      return;
    }
    await this.command(visible ? "show" : "hide").catch(() => {});
  }

  private emitClose(): void {
    if (this.closed && !windows.has(this.id)) return;
    this.closed = true;
    windows.delete(this.id);
    pendingWindows.delete(this as BrowserWindow);
    events.emit(`close-${this.id}`, { data: {} });
  }
}

export class BrowserView {
  readonly id: string = "";
  static defineRPC<Schema extends CombinedSchema>(config: Parameters<typeof defineRpc<Schema, "bun">>[1]) {
    return defineRpc<Schema, "bun">("bun", config);
  }
}

export const Screen = {
  getAllDisplays: () => getDisplays().map((display, index) => ({ ...display, id: String(index) })),
  getPrimaryDisplay: () => {
    const displays = Screen.getAllDisplays();
    return displays.find((display) => display.isPrimary) ?? displays[0] ?? {
      id: "0",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
      isPrimary: true,
    };
  },
};

export class Tray {
  private handler?: (event: unknown) => void;
  constructor(private readonly options: { title: string; image: string; width?: number; height?: number }) { trays.add(this); }
  setMenu(items: Array<{ type: string; label?: string; action?: string }>): void {
    const menuItems = items.map((item, index) => item.type === "divider"
      ? { id: `separator-${index}`, text: "-" }
      : { id: item.action ?? `item-${index}`, text: item.label ?? "" });
    void native?.call("os.setTray", { icon: this.options.image.replace("views://", "/resources/views/"), menuItems });
  }
  on(name: string, handler: (event: unknown) => void): void { if (name === "tray-clicked") this.handler = handler; }
  dispatch(action: string): void { this.handler?.({ data: { action } }); }
}

export const Utils = {
  paths: { documents: path.join(process.env.USERPROFILE ?? process.cwd(), "Documents") },
  openExternal: (url: string) => { void native?.call("os.open", { url }); },
  openPath: (target: string) => native?.call("os.open", { url: target }),
  showItemInFolder: (target: string) => { void native?.call("os.open", { url: path.dirname(target) }); },
  openFileDialog: async (options: { canChooseDirectory?: boolean; canChooseFiles?: boolean; startingFolder?: string; allowsMultipleSelection?: boolean; allowedFileTypes?: string | string[] }) => {
    if (options.canChooseDirectory) {
      const selected = await native?.call<string>("os.showFolderDialog", { title: "Select folder", defaultPath: options.startingFolder });
      return selected ? [selected] : [];
    }
    const extensions = typeof options.allowedFileTypes === "string" ? [options.allowedFileTypes] : options.allowedFileTypes;
    const filters = extensions ? [{ name: extensions.map((extension) => `.${extension}`).join(", "), extensions }] : undefined;
    return await native?.call<string[]>("os.showOpenDialog", { title: "Select file", defaultPath: options.startingFolder, multiSelections: options.allowsMultipleSelection, filters }) ?? [];
  },
  showSaveDialog: async (options: { defaultPath?: string; filters?: string[] }) => {
    const filters = options.filters ? [{ name: options.filters.map((extension) => `.${extension}`).join(", "), extensions: options.filters }] : undefined;
    return native?.call<string>("os.showSaveDialog", { title: "Save file", defaultPath: options.defaultPath, filters });
  },
  showMessageBox: async (options: { title: string; message: string; type?: string; buttons?: string[]; defaultId?: number; cancelId?: number }) => native?.call("os.showMessageBox", {
    title: options.title,
    content: options.message,
    choice: options.buttons?.length === 2 ? "YES_NO" : "OK",
    icon: options.type === "warning" ? "WARNING" : options.type === "error" ? "ERROR" : "INFO",
  }),
  showNotification: (options: { title: string; body: string }) => { void native?.call("os.showNotification", { title: options.title, content: options.body }); },
  quit: () => { void quitRuntime(); },
};

async function quitRuntime(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (announceTimer) clearInterval(announceTimer);
  server?.stop();
  await native?.call("app.exit").catch(() => {});
  native?.close();
  process.exit(0);
}

function viewName(url: string): string { return /views:\/\/([^/]+)/.exec(url)?.[1] ?? "window"; }

export const PATHS = { VIEWS_FOLDER: path.join(path.resolve(import.meta.dir, "../.."), "resources", "views") };

const DesktopRuntime = { events, Updater: { getLocalInfo: async () => ({ version: appVersion }) } };
export default DesktopRuntime;
