import type { RPCSchema } from "@svoverlay/contracts/rpc";
import type { LocalizedText } from "@svoverlay/i18n/messages";
import type { SpiritValeLocation } from "./location.ts";
import type { SessionDateRange } from "./session-summary-journal.ts";

export interface SessionPickerItem {
  id: string;
  createdAt: string;
  /** Composed by the tools packages, so English. Absent when the session could not be inspected. */
  summary?: string;
  locations?: SpiritValeLocation[];
  active: boolean;
  disabled: boolean;
}

export interface SessionZoneFilter {
  selected: string[];
  available: SpiritValeLocation[];
}

export interface SessionPickerState {
  title: LocalizedText;
  canOpenLogFolder: boolean;
  status: "loading" | "ready" | "error";
  statusDetail: LocalizedText;
  sessions: SessionPickerItem[];
  dateRange?: SessionDateRange;
  zoneFilter?: SessionZoneFilter;
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
