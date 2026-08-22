import type { RPCSchema } from "electrobun";
import type { SpiritValeLocation } from "./location.ts";

export interface SessionPickerItem {
  id: string;
  createdAt: string;
  summary: string;
  locations?: SpiritValeLocation[];
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
      openSettings: Record<string, never>;
    };
  }>;
  webview: RPCSchema<{
    messages: { stateChanged: SessionPickerState };
  }>;
};
