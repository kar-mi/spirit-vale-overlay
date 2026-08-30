export const MARKET_PROTOCOL_VERSION = 2 as const;
export const MARKET_PACKAGE_VERSION = "2.0.0";
export const MARKET_API_URL = "https://market-api.spiritvalers.com";

export interface MarketUploadStat {
  type: number;
  name?: string;
  value?: number;
  percent: boolean;
}

export interface MarketUploadObservation {
  reportId: string;
  listingKey: string;
  listingVersion: number;
  payloadHash: string;
  itemType: number;
  itemId: string;
  displayName: string | null;
  unitPrice: number;
  quantity: number;
  status: number;
  stats: MarketUploadStat[];
  observedAt: string;
  expiresAt: string | null;
}

export interface MarketObservationBatch {
  protocolVersion: typeof MARKET_PROTOCOL_VERSION;
  batchId: string;
  marketId: string;
  sentAt: string;
  collector: {
    version: string;
    gameBuild: string;
    marketPackageVersion: string;
  };
  observations: MarketUploadObservation[];
}

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalObservationPayload(
  observation: Pick<MarketUploadObservation,
    "itemType" | "itemId" | "displayName" | "unitPrice" | "quantity" | "status" | "stats" | "expiresAt"
  >,
): string {
  const stats = [...observation.stats]
    .map((stat): MarketUploadStat => ({
      type: stat.type,
      ...(stat.name === undefined ? {} : { name: stat.name }),
      ...(stat.value === undefined ? {} : { value: stat.value }),
      percent: stat.percent,
    }))
    .sort((left, right) => left.type - right.type
      || (left.name ?? "").localeCompare(right.name ?? "")
      || (left.value ?? 0) - (right.value ?? 0)
      || Number(left.percent) - Number(right.percent));
  return JSON.stringify([
    observation.itemType,
    observation.itemId,
    observation.displayName,
    observation.unitPrice,
    observation.quantity,
    observation.status,
    stats.map((stat) => [stat.type, stat.name ?? null, stat.value ?? null, stat.percent]),
    observation.expiresAt,
  ]);
}
