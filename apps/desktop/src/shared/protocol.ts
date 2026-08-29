export type RpcPacket =
  | { type: "request"; id: number; method: string; params: unknown }
  | { type: "response"; id: number; success: true; payload: unknown }
  | { type: "response"; id: number; success: false; error?: string }
  | { type: "message"; id: string; payload: unknown };

export type ClientPacket =
  | { kind: "hello"; ticket: string; processId?: number }
  | { kind: "rpc"; packet: RpcPacket }
  | { kind: "window-result"; id: number; result?: unknown; error?: string }
  | { kind: "window-event"; event: string; data?: unknown };

export type ServerPacket =
  | { kind: "ready"; windowId: string; role: "launcher" | "overlay" | "window" }
  | { kind: "rpc"; packet: RpcPacket }
  | { kind: "window-command"; id: number; method: string; params?: unknown }
  | { kind: "fatal"; message: string };

export interface BackendReady {
  port: number;
  ticket: string;
}

export interface StartupFailure {
  phase: string;
  operation: string;
  message: string;
  path?: string;
  code?: string;
  applicationPath?: string;
  logPaths?: string[];
}
