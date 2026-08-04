import type { RPCSchema } from "electrobun";
import type { WindowChromeRequests } from "@spiritvale/ui-core/window-rpc";

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
  /** Present only for a Gunslinger with stored weapon-swap sets. */
  weaponSetCount?: number;
}

export interface BuildExportUnresolvedGroup {
  group: string;
  items: string[];
}

export interface BuildExportState {
  status: BuildExportStatus;
  statusDetail: string;
  character?: BuildExportCharacter;
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
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: BuildExportState } }>;
};
