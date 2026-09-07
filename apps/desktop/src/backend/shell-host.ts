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

export interface RuntimeHostContext {
  launcherCommand<T = unknown>(method: string, params?: unknown): Promise<T>;
  dispatchWindowEvent(windowId: string, event: string, data: unknown): void;
}

export interface ShellHost {
  readonly kind: "neutralino" | "electron";

  initialize(context: RuntimeHostContext): Promise<void>;

  broadcast(event: string, data: unknown): Promise<void>;

  createWindow(windowId: string, options: CreateWindowOptions): Promise<void>;

  /**
   * Under Neutralino the runtime routes these straight to the window's own renderer
   * session, so the host never sees them; Electron owns its windows in the main
   * process and handles them here.
   */
  windowCommand<T = unknown>(window: HostWindowRef, method: string, params?: unknown): Promise<T>;

  nativeWindowHandle(window: HostWindowRef): unknown;

  getDisplays(): NativeDisplay[];

  configureOverlayWindow(window: HostWindowRef, clickThrough: boolean): Promise<boolean>;
  setOverlayWindowVisible(window: HostWindowRef, visible: boolean): void;

  /** When omitted, the caller falls back to the pids of tracked window sessions. */
  isAppProcess?(processId: number): boolean;

  setTray(icon: string, items: TrayItem[]): void;
  onTrayClick(handler: (action: string) => void): void;

  openExternal(target: string): Promise<void>;
  showOpenDialog(options: OpenDialogOptions): Promise<string[]>;
  showFolderDialog(options: { title: string; defaultPath?: string }): Promise<string | undefined>;
  showSaveDialog(options: SaveDialogOptions): Promise<string | undefined>;
  showMessageBox(options: MessageBoxOptions): Promise<unknown>;
  showNotification(options: { title: string; body: string }): void;

  onOwnerGone(handler: () => void): void;

  exit(): Promise<void>;
}
