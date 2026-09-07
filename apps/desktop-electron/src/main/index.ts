import net from "node:net";
import crypto from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import {
  app,
  dialog,
  ipcMain,
  nativeImage,
  net as electronNet,
  protocol,
  shell,
  BrowserWindow,
  Menu,
  Notification,
  session,
  Tray,
} from "electron";
import { WindowHost, iconPathFor } from "./window-host.ts";
import { installPrivacyGuard } from "./privacy-guard.ts";
import type { StartupFailure } from "@svoverlay/desktop/src/shared/protocol.ts";
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

const windowHost = new WindowHost(
  path.join(import.meta.dirname, "preload.cjs"),
  iconPathFor(resourcesRoot),
  {
    onWindowEvent: (windowId, event, data) => sendToBackend({ t: "window-event", windowId, event, data }),
    onHandle: (windowId, handle) => sendToBackend({
      t: "window-handle",
      windowId,
      handle: handle ? handle.toString("base64") : null,
    }),
  },
);

const shellToken = crypto.randomBytes(24).toString("hex");
let backendSocket: net.Socket | undefined;
let backendProcess: ChildProcess | undefined;
let tray: Tray | undefined;
let quitting = false;
let backendReportedFatal = false;
let backendFailure: StartupFailure | undefined;

function sendToBackend(event: ShellEvent): void {
  if (backendSocket?.writable) backendSocket.write(encodeMessage(event));
}

function reply(id: number, run: () => unknown | Promise<unknown>): void {
  void (async () => {
    try {
      sendToBackend({ t: "reply", id, ok: true, value: await run() });
    } catch (error) {
      sendToBackend({ t: "reply", id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
}

function handleBackendRequest(message: ShellRequest): void {
  switch (message.t) {
    case "create-window":
      reply(message.id, () => windowHost.create(message.payload).then(() => undefined));
      return;
    case "broadcast": {
      const channel = message.event === "desktopBackendFatal" ? "sv:backend-fatal" : "sv:backend-ready";
      if (channel === "sv:backend-fatal") {
        backendReportedFatal = true;
        backendFailure = message.data as StartupFailure;
      }
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, message.data);
      return;
    }
    case "set-tray":
      setTray(message.icon, message.items);
      return;
    case "notification":
      if (Notification.isSupported()) new Notification({ title: message.title, body: message.body }).show();
      return;
    case "exit":
      app.quit();
      return;
    case "window-command":
      reply(message.id, () => windowHost.runCommand(message.windowId, message.method, message.params as Record<string, unknown> | undefined));
      return;
    case "open-external":
      reply(message.id, () => openExternal(message.target));
      return;
    case "dialog":
      reply(message.id, () => showDialog(message.kind, message.options));
      return;
  }
}

interface DialogFilter { name: string; extensions: string[] }

async function showDialog(kind: "open" | "folder" | "save" | "message", options: unknown): Promise<unknown> {
  const config = options as {
    title: string;
    defaultPath?: string;
    multiSelections?: boolean;
    filters?: DialogFilter[];
    content?: string;
    choice?: "OK" | "YES_NO";
    icon?: "INFO" | "WARNING" | "ERROR";
  };
  if (kind === "open") {
    const properties: Array<"openFile" | "multiSelections"> = ["openFile"];
    if (config.multiSelections) properties.push("multiSelections");
    const result = await dialog.showOpenDialog({ ...config, properties });
    return result.canceled ? [] : result.filePaths;
  }
  if (kind === "folder") {
    const result = await dialog.showOpenDialog({ ...config, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  }
  if (kind === "save") {
    const result = await dialog.showSaveDialog(config);
    return result.canceled ? undefined : result.filePath;
  }
  const result = await dialog.showMessageBox({
    title: config.title,
    message: config.content ?? "",
    type: config.icon === "WARNING" ? "warning" : config.icon === "ERROR" ? "error" : "info",
    buttons: config.choice === "YES_NO" ? ["Yes", "No"] : ["OK"],
  });
  return { selectedOption: result.response };
}

async function openExternal(target: string): Promise<void> {
  if (/^[a-z]+:\/\//i.test(target)) {
    await shell.openExternal(target);
    return;
  }
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

function setTray(icon: string, items: Array<{ type: "item" | "divider"; label?: string; action?: string }>): void {
  const image = nativeImage.createFromPath(path.join(resourcesRoot, icon.replace(/^views:\/\//, "views/")));
  if (!tray) {
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.setToolTip("Spirit Vale Overlay");
  }
  tray.setContextMenu(Menu.buildFromTemplate(items.map((item, index) => item.type === "divider"
    ? { type: "separator" as const }
    : { label: item.label ?? "", click: () => sendToBackend({ t: "tray-click", action: item.action ?? `item-${index}` }) })));
}

function startShellSocket(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      if (backendSocket) {
        socket.destroy();
        return;
      }
      let authenticated = false;
      const decoder = new LineDecoder<ShellRequest>();
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const message of decoder.push(chunk)) {
          if (!authenticated) {
            if (message.t !== "hello" || message.token !== shellToken) {
              socket.destroy();
              return;
            }
            authenticated = true;
            backendSocket = socket;
            continue;
          }
          handleBackendRequest(message);
        }
      });
      const drop = (): void => { if (backendSocket === socket) backendSocket = undefined; };
      // The backend peer going away (killed, crashed) surfaces as an unhandled 'error' on the
      // socket, which Electron would otherwise escalate to its main-process error dialog.
      socket.on("error", drop);
      socket.on("close", drop);
    });
    (server as unknown as NodeJS.EventEmitter).on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Could not bind the shell control socket."));
    });
  });
}

function spawnBackend(port: number): void {
  const bun = path.join(resourcesRoot, "extensions", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  const entry = path.join(resourcesRoot, "extensions", "backend", "index.js");
  // don't show bun.exe console
  const pipeOutput = app.isPackaged ? "ignore" : "inherit";
  backendProcess = spawn(bun, ["--no-orphans", entry], {
    cwd: bundleRoot,
    stdio: ["ignore", pipeOutput, pipeOutput],
    windowsHide: true,
    env: {
      ...process.env,
      SPIRIT_VALE_ROOT: bundleRoot,
      SPIRIT_VALE_VERSION: app.getVersion(),
      SPIRIT_VALE_SHELL: JSON.stringify({ port, token: shellToken }),
    },
  });
  backendProcess.on("error", (error) => reportBackendFailure({
    phase: "backend process",
    operation: "spawn",
    message: error.message,
    applicationPath: bundleRoot,
    logPaths: [path.join(bundleRoot, "electron-backend.log")],
  }));
  backendProcess.on("exit", (code: number | null) => {
    if (!app.isPackaged) console.error(`backend exited with code ${code}`);
    if (!quitting && !backendReportedFatal) reportBackendFailure({
      phase: "backend process",
      operation: "run",
      message: `The Electron backend exited unexpectedly${code === null ? "." : ` with code ${code}.`}`,
      applicationPath: bundleRoot,
      logPaths: [path.join(bundleRoot, "electron-backend.log")],
    });
  });
}

function reportBackendFailure(failure: StartupFailure): void {
  if (backendFailure) return;
  backendReportedFatal = true;
  backendFailure = failure;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("sv:backend-fatal", failure);
}

function registerAppProtocol(): void {
  protocol.handle("app", (request) => {
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const target = path.resolve(resourcesRoot, relative);
    if (target !== resourcesRoot && !target.startsWith(resourcesRoot + path.sep)) {
      return Promise.resolve(new Response("Forbidden", { status: 403 }));
    }
    return electronNet.fetch(pathToFileURL(target).toString());
  });
}

ipcMain.handle("sv:open-path", (_event, target: string) => openExternal(target));
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
    installPrivacyGuard(session.defaultSession);
    registerAppProtocol();
    spawnBackend(await startShellSocket());
    const launcher = windowHost.createLauncher("app://-/views/launcherview/index.html");
    launcher.webContents.once("did-finish-load", () => {
      if (backendFailure) launcher.webContents.send("sv:backend-fatal", backendFailure);
    });
    // launcher has to drive the quit, or the app lingers in the tray.
    launcher.on("closed", () => app.quit());
  });

  app.on("window-all-closed", () => app.quit());

  // Give the backend time to exit on its own before tearing anything down;
  app.on("before-quit", (event) => {
    tray?.destroy();
    const child = backendProcess;
    if (quitting || !child || child.exitCode !== null || child.signalCode !== null) {
      windowHost.destroyAll();
      return;
    }
    quitting = true;
    event.preventDefault();
    backendSocket?.destroy();
    const finish = (): void => {
      clearTimeout(forceTimer);
      windowHost.destroyAll();
      app.quit();
    };
    const forceTimer = setTimeout(() => { try { child.kill(); } catch {} finish(); }, 5000);
    (child as unknown as NodeJS.EventEmitter).once("exit", finish);
  });
}
