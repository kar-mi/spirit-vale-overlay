import type { RPCSchema } from "electrobun";
import type { WindowChromeRequests } from "@svoverlay/contracts/window-rpc";

export type BuildExportStatus = "waiting" | "ready";

export interface BuildExportCharacter {
  name: string;
  /** The planner's class id, which is also the game archetype name. */
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
  /** ISO timestamp of the inspect this came from. Absent for your own character. */
  inspectedAt?: string;
  /** Present only for a Gunslinger with stored weapon-swap sets. */
  weaponSetCount?: number;
}

export interface BuildExportUnresolvedGroup {
  group: string;
  items: string[];
}

/** One exportable character: your own, or a player you inspected. */
export interface BuildExportSource {
  /** `self`, or `inspect:<character name>`. */
  id: string;
  name: string;
  kind: "self" | "inspected";
  cls: string;
  level: number;
  /** ISO timestamp of the inspect that produced this entry. Absent for your own character. */
  inspectedAt?: string;
}

export interface BuildExportState {
  status: BuildExportStatus;
  statusDetail: string;
  character?: BuildExportCharacter;
  /** Your character first, then inspected players most-recent first. */
  sources: BuildExportSource[];
  /** Current roster filter, matched against inspected IGN and class. */
  searchQuery: string;
  /** Number of persisted inspected players before the current filter. */
  inspectedCount: number;
  selectedId: string;
  /** Everything the pinned catalog could not resolve, so the player is never quietly misled. */
  unresolved: BuildExportUnresolvedGroup[];
  missing: number;
  notes: string[];
  /** Game build the pinned snapshot came from, so a stale snapshot is visible rather than silent. */
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
      /** Hands the build to the planner in the default browser. */
      exportToPlanner: { params: Record<string, never>; response: BuildExportState };
      /** The planner link, so the view can put it on the clipboard. */
      getPlannerLink: { params: Record<string, never>; response: { link: string } };
      /** Attribution link, required by the snapshot's licence grant. */
      openSite: { params: Record<string, never>; response: void };
      /** Switches which captured character is being exported. */
      selectCharacter: { params: { id: string }; response: BuildExportState };
      setSearch: { params: { query: string }; response: BuildExportState };
      deleteInspectedCharacter: { params: { id: string }; response: BuildExportState };
      clearInspectedCharacters: { params: Record<string, never>; response: BuildExportState };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: BuildExportState } }>;
};
