import path from "node:path";
import { Notification, Tray, dialog, nativeImage, shell, Menu } from "electron";
import type { TrayItemPayload } from "../shell-protocol.ts";

// The `os.*` surface from the Neutralino runtime, reimplemented on Electron's
// dialog / shell / Notification / Tray. Kept deliberately thin: the backend
// already normalises option shapes before they reach the shell socket.

interface DialogFilter { name: string; extensions: string[] }

export class NativeApi {
  private tray?: Tray;

  constructor(
    private readonly resourcesRoot: string,
    private readonly onTrayClick: (action: string) => void,
  ) {}

  async showOpenDialog(options: { title: string; defaultPath?: string; multiSelections?: boolean; filters?: DialogFilter[] }): Promise<string[]> {
    const properties: Array<"openFile" | "multiSelections"> = ["openFile"];
    if (options.multiSelections) properties.push("multiSelections");
    const result = await dialog.showOpenDialog({ title: options.title, defaultPath: options.defaultPath, filters: options.filters, properties });
    return result.canceled ? [] : result.filePaths;
  }

  async showFolderDialog(options: { title: string; defaultPath?: string }): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({ title: options.title, defaultPath: options.defaultPath, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  }

  async showSaveDialog(options: { title: string; defaultPath?: string; filters?: DialogFilter[] }): Promise<string | undefined> {
    const result = await dialog.showSaveDialog({ title: options.title, defaultPath: options.defaultPath, filters: options.filters });
    return result.canceled ? undefined : result.filePath;
  }

  async showMessageBox(options: { title: string; content: string; choice: "OK" | "YES_NO"; icon: "INFO" | "WARNING" | "ERROR" }): Promise<{ selectedOption: number }> {
    const buttons = options.choice === "YES_NO" ? ["Yes", "No"] : ["OK"];
    const type = options.icon === "WARNING" ? "warning" : options.icon === "ERROR" ? "error" : "info";
    const result = await dialog.showMessageBox({ title: options.title, message: options.content, type, buttons });
    return { selectedOption: result.response };
  }

  showNotification(options: { title: string; body: string }): void {
    if (!Notification.isSupported()) return;
    new Notification({ title: options.title, body: options.body }).show();
  }

  async openExternal(target: string): Promise<void> {
    if (/^[a-z]+:\/\//i.test(target)) {
      await shell.openExternal(target);
      return;
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  }

  setTray(icon: string, items: TrayItemPayload[]): void {
    const iconFile = path.join(this.resourcesRoot, icon.replace(/^views:\/\//, "views/"));
    const image = nativeImage.createFromPath(iconFile);
    if (!this.tray) {
      this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
      this.tray.setToolTip("Spirit Vale Overlay");
    }
    const menu = Menu.buildFromTemplate(items.map((item, index) => item.type === "divider"
      ? { type: "separator" as const }
      : { label: item.label ?? "", click: () => this.onTrayClick(item.action ?? `item-${index}`) }));
    this.tray.setContextMenu(menu);
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}
