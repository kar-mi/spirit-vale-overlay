import { NeutralinoClient } from "./neutralino-client.ts";
import {
  applyOverlayWindowStyles,
  findWindowHandle,
  getDisplays,
  setOverlayWindowVisible,
} from "./win32.ts";
import type {
  CreateWindowOptions,
  HostWindowRef,
  MessageBoxOptions,
  OpenDialogOptions,
  RuntimeHostContext,
  SaveDialogOptions,
  ShellHost,
  TrayItem,
} from "./shell-host.ts";

// The ShellHost for the Neutralino build. Everything here is behaviour lifted
// verbatim from the pre-injection `runtime.ts`: the extension socket, the
// launcher-session-routed `window.create`, the `os.*` native calls, and the
// overlay-window style-settling poll.

export class NeutralinoShellHost implements ShellHost {
  readonly kind = "neutralino" as const;
  private native?: NeutralinoClient;
  private context?: RuntimeHostContext;
  private trayClick?: (action: string) => void;
  private ownerGone?: () => void;

  async initialize(context: RuntimeHostContext): Promise<void> {
    this.context = context;
    this.native = await NeutralinoClient.fromStdin();
    this.native.on("trayMenuItemClicked", (data) => {
      const action = String((data as { id?: string })?.id ?? "");
      this.trayClick?.(action);
    });
    this.native.onClose(() => this.ownerGone?.());
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    await this.native?.call("app.broadcast", { event, data });
  }

  async createWindow(_windowId: string, options: CreateWindowOptions): Promise<void> {
    const command = this.context?.launcherCommand;
    if (!command) throw new Error("The launcher window is not connected.");
    await command("createWindow", {
      url: options.url,
      options: {
        title: options.title,
        ...options.frame,
        borderless: options.borderless,
        transparent: options.transparent,
        resizable: options.resizable,
        hidden: true,
        alwaysOnTop: options.alwaysOnTop,
        exitProcessOnClose: true,
        injectGlobals: true,
        injectClientLibrary: false,
        useLogicalPixels: false,
        processArgs: `--window-skip-taskbar=${options.skipTaskbar} --window-use-saved-state=false`,
      },
    });
  }

  windowCommand<T = unknown>(): Promise<T> {
    // Neutralino windows are driven from their own renderer via `@neutralinojs/lib`,
    // so `runtime.ts` routes window commands through the session, never here.
    return Promise.reject(new Error("NeutralinoShellHost does not run window commands."));
  }

  nativeWindowHandle(window: HostWindowRef): unknown {
    return window.processId ? findWindowHandle(window.processId) : undefined;
  }

  getDisplays() {
    return getDisplays();
  }

  async configureOverlayWindow(window: HostWindowRef, clickThrough: boolean): Promise<boolean> {
    const pid = window.processId;
    if (!pid) return false;
    let stableChecks = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const handle = findWindowHandle(pid);
      // Neutralino applies its own final styles shortly after creating the HWND.
      // Require several consecutive checks so we do not report a transient success.
      stableChecks = handle && applyOverlayWindowStyles(handle, clickThrough) ? stableChecks + 1 : 0;
      if (stableChecks >= 4) return true;
      await Bun.sleep(50);
    }
    return false;
  }

  setOverlayWindowVisible(window: HostWindowRef, visible: boolean): void {
    const handle = window.processId ? findWindowHandle(window.processId) : undefined;
    if (handle) setOverlayWindowVisible(handle, visible);
  }

  setTray(icon: string, items: TrayItem[]): void {
    const menuItems = items.map((item, index) => item.type === "divider"
      ? { id: `separator-${index}`, text: "-" }
      : { id: item.action ?? `item-${index}`, text: item.label ?? "" });
    void this.native?.call("os.setTray", { icon: icon.replace("views://", "/resources/views/"), menuItems });
  }

  onTrayClick(handler: (action: string) => void): void {
    this.trayClick = handler;
  }

  async openExternal(target: string): Promise<void> {
    await this.native?.call("os.open", { url: target });
  }

  async showOpenDialog(options: OpenDialogOptions): Promise<string[]> {
    return await this.native?.call<string[]>("os.showOpenDialog", {
      title: options.title,
      defaultPath: options.defaultPath,
      multiSelections: options.multiSelections,
      filters: options.filters,
    }) ?? [];
  }

  async showFolderDialog(options: { title: string; defaultPath?: string }): Promise<string | undefined> {
    return await this.native?.call<string>("os.showFolderDialog", {
      title: options.title,
      defaultPath: options.defaultPath,
    });
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | undefined> {
    return await this.native?.call<string>("os.showSaveDialog", {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
  }

  async showMessageBox(options: MessageBoxOptions): Promise<unknown> {
    return await this.native?.call("os.showMessageBox", { ...options });
  }

  showNotification(options: { title: string; body: string }): void {
    void this.native?.call("os.showNotification", { title: options.title, content: options.body });
  }

  onOwnerGone(handler: () => void): void {
    this.ownerGone = handler;
  }

  async exit(): Promise<void> {
    await this.native?.call("app.exit").catch(() => {});
    this.native?.close();
  }
}
