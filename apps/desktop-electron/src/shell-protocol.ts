

export interface ShellSocketConfig {
  port: number;
  token: string;
}

export function readShellSocketConfig(): ShellSocketConfig | undefined {
  const raw = process.env["SPIRIT_VALE_SHELL"];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<ShellSocketConfig>;
    if (typeof parsed.port === "number" && typeof parsed.token === "string") {
      return { port: parsed.port, token: parsed.token };
    }
  } catch {}
  return undefined;
}

export interface CreateWindowPayload {
  windowId: string;
  url: string;
  title: string;
  frame: { x: number; y: number; width: number; height: number };
  borderless: boolean;
  transparent: boolean;
  resizable: boolean | undefined;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
}

export interface TrayItemPayload {
  type: "item" | "divider";
  label?: string;
  action?: string;
}

/** Backend -> main. */
export type ShellRequest =
  | { t: "hello"; token: string }
  | { t: "create-window"; payload: CreateWindowPayload }
  | { t: "window-command"; id: number; windowId: string; method: string; params?: unknown }
  | { t: "broadcast"; event: string; data: unknown }
  | { t: "set-tray"; icon: string; items: TrayItemPayload[] }
  | { t: "open-external"; id: number; target: string }
  | { t: "dialog"; id: number; kind: "open" | "folder" | "save" | "message"; options: unknown }
  | { t: "notification"; title: string; body: string }
  | { t: "exit" };

/** Main -> backend. */
export type ShellEvent =
  | { t: "hello-ok" }
  | { t: "window-handle"; windowId: string; handle: string | null }
  | { t: "window-event"; windowId: string; event: string; data: unknown }
  | { t: "reply"; id: number; ok: true; value: unknown }
  | { t: "reply"; id: number; ok: false; error: string }
  | { t: "tray-click"; action: string };

export function encodeMessage(message: ShellRequest | ShellEvent): string {
  return `${JSON.stringify(message)}\n`;
}

/** Splits a growing buffer of newline-delimited JSON into parsed messages. */
export class LineDecoder<T> {
  private buffer = "";
  push(chunk: string): T[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    const messages: T[] = [];
    for (const part of parts) {
      if (!part.trim()) continue;
      try { messages.push(JSON.parse(part) as T); } catch {}
    }
    return messages;
  }
}
