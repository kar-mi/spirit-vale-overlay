import type { RPCSchema } from "@svoverlay/contracts/rpc";
import type { WindowChromeRequests } from "@svoverlay/contracts/window-rpc";

export type BuildExportStatus = "waiting" | "ready";

export interface BuildExportCharacter {
  name: string;
  cls: string;
  base?: string;
  level: number;
  jobLevel: number;
  equipmentCount: number;
  artifactCount: number;
  gemCount: number;
  cardCount: number;
  skillCount: number;
  grimoireCount: number;
  inspectedAt?: string;
  weaponSetCount?: number;
}

export interface BuildExportUnresolvedGroup {
  group: string;
  items: string[];
}

export interface BuildExportSource {
  id: string;
  name: string;
  kind: "self" | "inspected";
  cls: string;
  level: number;
  inspectedAt?: string;
}

export interface BuildExportState {
  status: BuildExportStatus;
  statusDetail: string;
  character?: BuildExportCharacter;
  sources: BuildExportSource[];
  searchQuery: string;
  inspectedCount: number;
  selectedId: string;
  unresolved: BuildExportUnresolvedGroup[];
  missing: number;
  notes: string[];
  snapshotGameBuild: string;
  snapshotGameLabel: string;
  snapshotGeneratedAt: string;
  attribution: readonly string[];
  siteOrigin: string;
  lastExportedAt?: string;
}

export type BuildExportRpc = {
  bun: RPCSchema<{
    requests: WindowChromeRequests & {
      getState: { params: Record<string, never>; response: BuildExportState };
      exportToPlanner: { params: Record<string, never>; response: BuildExportState };
      getPlannerLink: { params: Record<string, never>; response: { link: string } };
      openSite: { params: Record<string, never>; response: void };
      selectCharacter: { params: { id: string }; response: BuildExportState };
      setSearch: { params: { query: string }; response: BuildExportState };
      deleteInspectedCharacter: { params: { id: string }; response: BuildExportState };
      clearInspectedCharacters: { params: Record<string, never>; response: BuildExportState };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: BuildExportState } }>;
};
