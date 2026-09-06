import type { NativeDisplay } from "./win32.ts";

export interface HostWindowRef {
  readonly windowId: string;
  readonly processId: number | undefined;
}

export interface CreateWindowOptions {
  url: string;
  title: string;
  frame: { x: number; y: number; width: number; height: number };
  borderless: boolean;
  transparent: boolean;
  resizable: boolean | undefined;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
}

export interface TrayItem {
  type: "item" | "divider";
  label?: string;
  action?: string;
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title: string;
  defaultPath?: string;
  multiSelections?: boolean;
  filters?: DialogFilter[];
}

export interface SaveDialogOptions {
  title: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

export interface MessageBoxOptions {
  title: string;
  content: string;
  choice: "OK" | "YES_NO";
  icon: "INFO" | "WARNING" | "ERROR";
}

/** Runtime-owned services a ShellHost needs back from `runtime.ts`. */
export interface RuntimeHostContext {
  /** Run a native command in the launcher window's renderer (Neutralino window API). */
  launcherCommand<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Feed a native window event (move/resize/close/focus/blur) into the window registry. */
  dispatchWindowEvent(windowId: string, event: string, data: unknown): void;
}

export interface ShellHost {
  readonly kind: "neutralino" | "electron";

  /** Establish the connection to the native shell. */
  initialize(context: RuntimeHostContext): Promise<void>;

  /** Deliver a `desktopBackendReady` / `desktopBackendFatal` style event to every window. */
  broadcast(event: string, data: unknown): Promise<void>;

  createWindow(windowId: string, options: CreateWindowOptions): Promise<void>;

  /**
   * Run a per-window command (show/hide/focus/setBounds/…). Under Neutralino the
   * runtime routes these straight to the window's own renderer session; a shell
   * that owns its windows in the native process (Electron) handles them here.
   */
  windowCommand<T = unknown>(window: HostWindowRef, method: string, params?: unknown): Promise<T>;

  /** Native window handle (Win32 HWND) for the FFI helpers, or undefined if not resolvable yet. */
  nativeWindowHandle(window: HostWindowRef): unknown;

  getDisplays(): NativeDisplay[];

  /** Apply overlay (tool-window / click-through) styles; resolves true once they stick. */
  configureOverlayWindow(window: HostWindowRef, clickThrough: boolean): Promise<boolean>;
  setOverlayWindowVisible(window: HostWindowRef, visible: boolean): void;

  /** True when `processId` belongs to this app; when omitted, the caller falls back to tracked session pids. */
  isAppProcess?(processId: number): boolean;

  setTray(icon: string, items: TrayItem[]): void;
  onTrayClick(handler: (action: string) => void): void;

  openExternal(target: string): Promise<void>;
  showOpenDialog(options: OpenDialogOptions): Promise<string[]>;
  showFolderDialog(options: { title: string; defaultPath?: string }): Promise<string | undefined>;
  showSaveDialog(options: SaveDialogOptions): Promise<string | undefined>;
  showMessageBox(options: MessageBoxOptions): Promise<unknown>;
  showNotification(options: { title: string; body: string }): void;

  /** The owning shell process disappeared out from under the backend. */
  onOwnerGone(handler: () => void): void;

  exit(): Promise<void>;
}
