import net from "node:net";
import crypto from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app, ipcMain, protocol, BrowserWindow } from "electron";
import { NativeApi } from "./native-api.ts";
import { WindowHost, iconPathFor } from "./window-host.ts";
import {
  LineDecoder,
  encodeMessage,
  type ShellEvent,
  type ShellRequest,
} from "../shell-protocol.ts";

const bundleRoot = app.isPackaged ? path.dirname(process.resourcesPath) : app.getAppPath();
const resourcesRoot = path.join(bundleRoot, "resources");
const PORTABLE = existsSync(path.join(bundleRoot, ".spirit-vale-portable"));
if (PORTABLE) {
  const runtimeDir = path.join(bundleRoot, "data", "runtime");
  for (const [key, sub] of [["userData", "user-data"], ["sessionData", "session"], ["temp", "temp"]] as const) {
    const dir = path.join(runtimeDir, sub);
    mkdirSync(dir, { recursive: true });
    app.setPath(key, dir);
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const windowHost = new WindowHost(path.join(import.meta.dirname, "preload.cjs"), {
  onWindowEvent: (windowId, event, data) => sendToBackend({ t: "window-event", windowId, event, data }),
  onHandle: (windowId, handle) => sendToBackend({
    t: "window-handle",
    windowId,
    handle: handle ? handle.toString("base64") : null,
  }),
});
const nativeApi = new NativeApi(resourcesRoot, (action) => sendToBackend({ t: "tray-click", action }));

let backendSocket: net.Socket | undefined;
let backendProcess: ChildProcess | undefined;
const decoder = new LineDecoder<ShellRequest>();

function sendToBackend(event: ShellEvent): void {
  backendSocket?.write(encodeMessage(event));
}

function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

async function handleBackendRequest(message: ShellRequest): Promise<void> {
  switch (message.t) {
    case "hello":
      sendToBackend({ t: "hello-ok" });
      return;
    case "create-window":
      windowHost.create(message.payload);
      return;
    case "broadcast":
      broadcastToRenderers(message.event === "desktopBackendFatal" ? "sv:backend-fatal" : "sv:backend-ready", message.data);
      return;
    case "set-tray":
      nativeApi.setTray(message.icon, message.items);
      return;
    case "notification":
      nativeApi.showNotification({ title: message.title, body: message.body });
      return;
    case "exit":
      app.quit();
      return;
    case "window-command": {
      try {
        const value = await windowHost.runCommand(message.windowId, message.method, message.params as Record<string, unknown> | undefined);
        sendToBackend({ t: "reply", id: message.id, ok: true, value });
      } catch (error) {
        sendToBackend({ t: "reply", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    case "open-external": {
      try {
        await nativeApi.openExternal(message.target);
        sendToBackend({ t: "reply", id: message.id, ok: true, value: undefined });
      } catch (error) {
        sendToBackend({ t: "reply", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    case "dialog": {
      try {
        const options = message.options as never;
        const value = message.kind === "open" ? await nativeApi.showOpenDialog(options)
          : message.kind === "folder" ? await nativeApi.showFolderDialog(options)
          : message.kind === "save" ? await nativeApi.showSaveDialog(options)
          : await nativeApi.showMessageBox(options);
        sendToBackend({ t: "reply", id: message.id, ok: true, value });
      } catch (error) {
        sendToBackend({ t: "reply", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
  }
}

function startShellSocket(): Promise<{ port: number; token: string }> {
  const token = crypto.randomBytes(24).toString("hex");
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      backendSocket = socket;
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const message of decoder.push(chunk)) void handleBackendRequest(message);
      });
      socket.on("close", () => { backendSocket = undefined; });
    });
    (server as unknown as NodeJS.EventEmitter).on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ port: address.port, token });
      else reject(new Error("Could not bind the shell control socket."));
    });
  });
}

function spawnBackend(shell: { port: number; token: string }): void {
  const bun = path.join(resourcesRoot, "extensions", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  const entry = path.join(resourcesRoot, "extensions", "backend", "index.js");
  backendProcess = spawn(bun, ["--no-orphans", entry], {
    cwd: bundleRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      SPIRIT_VALE_ROOT: bundleRoot,
      SPIRIT_VALE_VERSION: app.getVersion(),
      SPIRIT_VALE_SHELL: JSON.stringify(shell),
    },
  });
  (backendProcess as unknown as NodeJS.EventEmitter).on("exit", (code: number | null) => {
    // The backend owns application logic; if it dies the shell has nothing to show.
    if (!app.isPackaged) console.error(`backend exited with code ${code}`);
  });
}

function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    // app://-/views/launcherview/index.html -> resources/views/launcherview/index.html
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    const target = path.join(resourcesRoot, relative);
    if (!target.startsWith(resourcesRoot)) return new Response("Forbidden", { status: 403 });
    const { readFile } = await import("node:fs/promises");
    try {
      const body = await readFile(target);
      return new Response(body, { headers: { "content-type": contentType(target) } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

ipcMain.handle("sv:window-action", (event, action: "minimize" | "close") => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === "minimize") win.minimize();
  else win.close();
});
ipcMain.handle("sv:get-window-frame", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
});
ipcMain.handle("sv:set-window-frame", (event, frame: { x: number; y: number; width: number; height: number }) => {
  BrowserWindow.fromWebContents(event.sender)?.setBounds(frame);
});
ipcMain.handle("sv:open-path", (_event, target: string) => nativeApi.openExternal(target));
ipcMain.handle("sv:quit", () => app.quit());

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const launcher = windowHost.get("launcher");
    if (launcher) { launcher.show(); launcher.focus(); }
  });

  void app.whenReady().then(async () => {
    registerAppProtocol();
    const shell = await startShellSocket();
    spawnBackend(shell);
    windowHost.createLauncher("app://-/views/launcherview/index.html", iconPathFor(resourcesRoot));
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    windowHost.destroyAll();
    nativeApi.dispose();
    backendProcess?.kill();
  });
}
