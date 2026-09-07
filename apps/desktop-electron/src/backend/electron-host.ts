import net from "node:net";
import type { Pointer } from "bun:ffi";
import { getDisplays, setOverlayWindowVisible as showWindowNative } from "@svoverlay/desktop/src/backend/win32.ts";
import { disableWindowTransitions } from "@svoverlay/desktop-platform/win32";
import type {
  CreateWindowOptions,
  HostWindowRef,
  MessageBoxOptions,
  OpenDialogOptions,
  RuntimeHostContext,
  SaveDialogOptions,
  ShellHost,
  TrayItem,
} from "@svoverlay/desktop/src/backend/shell-host.ts";
import {
  LineDecoder,
  encodeMessage,
  readShellSocketConfig,
  type ShellEvent,
  type ShellRequest,
} from "../shell-protocol.ts";


function handleFromBase64(value: string): Pointer {
  const bytes = Buffer.from(value, "base64");
  const hwnd = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true);
  return Number(hwnd) as unknown as Pointer;
}

export class ElectronShellHost implements ShellHost {
  readonly kind = "electron" as const;
  private socket?: net.Socket;
  private readonly decoder = new LineDecoder<ShellEvent>();
  private nextRequestId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly handles = new Map<string, Pointer>();
  private context?: RuntimeHostContext;
  private trayClick?: (action: string) => void;
  private ownerGone?: () => void;
  private readonly mainProcessId = process.ppid;

  async initialize(context: RuntimeHostContext): Promise<void> {
    this.context = context;
    const config = readShellSocketConfig();
    if (!config) throw new Error("SPIRIT_VALE_SHELL was not provided by the Electron shell.");
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: config.port }, () => {
        this.socket = socket;
        this.send({ t: "hello", token: config.token });
        resolve();
      });
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const message of this.decoder.push(chunk)) this.receive(message);
      });
      socket.on("error", reject);
      socket.on("close", () => this.ownerGone?.());
    });
  }

  private send(message: ShellRequest): void {
    this.socket?.write(encodeMessage(message));
  }

  private request<T>(message: { t: string } & Record<string, unknown>): Promise<T> {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket?.write(encodeMessage({ ...message, id } as ShellRequest));
    });
  }

  private receive(message: ShellEvent): void {
    switch (message.t) {
      case "window-handle": {
        if (message.handle === null) return;
        this.handles.set(message.windowId, handleFromBase64(message.handle));
        return;
      }
      case "window-event":
        this.context?.dispatchWindowEvent(message.windowId, message.event, message.data);
        return;
      case "tray-click":
        this.trayClick?.(message.action);
        return;
      case "reply": {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error));
        return;
      }
    }
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    this.send({ t: "broadcast", event, data });
  }

  async createWindow(windowId: string, options: CreateWindowOptions): Promise<void> {
    this.send({
      t: "create-window",
      payload: {
        windowId,
        url: options.url,
        title: options.title,
        frame: options.frame,
        borderless: options.borderless,
        transparent: options.transparent,
        resizable: options.resizable,
        alwaysOnTop: options.alwaysOnTop,
        skipTaskbar: options.skipTaskbar,
      },
    });
  }

  windowCommand<T = unknown>(window: HostWindowRef, method: string, params?: unknown): Promise<T> {
    return this.request<T>({ t: "window-command", windowId: window.windowId, method, params });
  }

  nativeWindowHandle(window: HostWindowRef): unknown {
    return this.handles.get(window.windowId);
  }

  getDisplays() {
    return getDisplays();
  }

  async configureOverlayWindow(window: HostWindowRef, clickThrough: boolean): Promise<boolean> {
    // Electron owns showing these windows, so the platform transition has to be turned off
    // on the HWND rather than sidestepped by showing them behind Electron's back.
    disableWindowTransitions(this.handles.get(window.windowId));
    return await this.windowCommand(window, "setIgnoreMouseEvents", { enabled: clickThrough })
      .then(() => true, () => false);
  }

  setOverlayWindowVisible(window: HostWindowRef, visible: boolean): void {
    const handle = this.handles.get(window.windowId);
    if (handle && showWindowNative(handle, visible)) return;
    void this.windowCommand(window, visible ? "show" : "hide").catch(() => {});
  }

  isAppProcess(processId: number): boolean {
    return processId === this.mainProcessId;
  }

  setTray(icon: string, items: TrayItem[]): void {
    this.send({ t: "set-tray", icon, items });
  }

  onTrayClick(handler: (action: string) => void): void {
    this.trayClick = handler;
  }

  async openExternal(target: string): Promise<void> {
    await this.request<void>({ t: "open-external", target });
  }

  showOpenDialog(options: OpenDialogOptions): Promise<string[]> {
    return this.request<string[]>({ t: "dialog", kind: "open", options });
  }

  showFolderDialog(options: { title: string; defaultPath?: string }): Promise<string | undefined> {
    return this.request<string | undefined>({ t: "dialog", kind: "folder", options });
  }

  showSaveDialog(options: SaveDialogOptions): Promise<string | undefined> {
    return this.request<string | undefined>({ t: "dialog", kind: "save", options });
  }

  showMessageBox(options: MessageBoxOptions): Promise<unknown> {
    return this.request<unknown>({ t: "dialog", kind: "message", options });
  }

  showNotification(options: { title: string; body: string }): void {
    this.send({ t: "notification", title: options.title, body: options.body });
  }

  onOwnerGone(handler: () => void): void {
    this.ownerGone = handler;
  }

  async exit(): Promise<void> {
    this.send({ t: "exit" });
    this.socket?.end();
  }
}
