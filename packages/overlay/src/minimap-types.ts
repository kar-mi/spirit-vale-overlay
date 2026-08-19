import type { RPCSchema } from "electrobun";

export interface MinimapLootDrop {
  objectId: number;
  x: number;
  z: number;
  displayName?: string;
  spriteId?: string;
  rarity?: number;
  lootType?: number;
}

export interface MinimapState {
  visible: boolean;
  player?: { x: number; z: number };
  loot: MinimapLootDrop[];
  rarityFilter: number;
}

export type MinimapRpc = {
  bun: RPCSchema<{ requests: {
    getState: { params: Record<string, never>; response: MinimapState };
    setRarityFilter: { params: { rarity: number }; response: MinimapState };
  } }>;
  webview: RPCSchema<{ messages: { stateChanged: MinimapState } }>;
};
