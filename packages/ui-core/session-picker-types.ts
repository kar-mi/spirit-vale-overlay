import type { RPCSchema } from "electrobun";

export interface SessionPickerItem {
  id: string;
  createdAt: string;
  summary: string;
  active: boolean;
  disabled: boolean;
}

export interface SessionPickerState {
  title: string;
  canOpenLogFolder: boolean;
  status: "loading" | "ready" | "error";
  statusDetail: string;
  sessions: SessionPickerItem[];
}

export type SessionPickerRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: SessionPickerState };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
    messages: {
      refresh: Record<string, never>;
      openSession: { id: string };
      openLogFolder: Record<string, never>;
      chooseFile: Record<string, never>;
      windowAction: { action: "minimize" | "close" };
    };
  }>;
  webview: RPCSchema<{
    messages: { stateChanged: SessionPickerState };
  }>;
};
