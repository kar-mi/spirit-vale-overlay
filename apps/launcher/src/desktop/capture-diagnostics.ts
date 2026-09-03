import type {
  CapturedFishNetPacket,
  CapturedLiteNetLibPacket,
} from "@kar-mi/spirit-vale-tools-capture";
import type { JsonData, JsonLinesLogger, JsonObject } from "@kar-mi/spirit-vale-tools-logging";

const PRE_AUTH_MS = 5_000;
const POST_AUTH_MS = 10_000;
const PRE_AUTH_BYTE_LIMIT = 8 * 1024 * 1024;
const TRANSITION_BYTE_LIMIT = 32 * 1024 * 1024;

interface BufferedLiteNetPacket {
  capturedAtMs: number;
  bytes: number;
  data: JsonObject;
}

export class CaptureDiagnostics {
  private logger?: JsonLinesLogger;
  private buffer: BufferedLiteNetPacket[] = [];
  private bufferBytes = 0;
  private dropped = 0;
  private transitionId = 0;
  private transitionUntilMs = 0;
  private transitionBytes = 0;
  private transitionTruncated = false;

  constructor(readonly enabled: boolean) {}

  setLogger(logger: JsonLinesLogger | undefined): void {
    this.logger = logger;
  }

  logPacketAdmission(
    packet: CapturedFishNetPacket,
    decision: "accepted" | "rejected" | "buffered",
    reason: string | undefined,
    activeConnectionId: string | undefined,
  ): void {
    if (!this.enabled) return;
    this.logger?.log("capture.packetAdmission", jsonObject({
      decision,
      reason,
      activeConnectionId,
      packetConnectionId: packet.connectionId,
      tick: packet.tick,
      packetName: packet.packetName,
      rpcName: packet.rpcName,
      objectId: packet.objectId,
      rpcResolution: packet.rpcResolution,
    }));
  }

  logStatusPacket(packet: CapturedFishNetPacket, phase: "input" | "output", statusEvents?: unknown): void {
    if (!this.enabled) return;
    this.logger?.log("capture.statusPacket", jsonObject({
      phase,
      ...fishNetPacketDiagnostic(packet),
      ...(statusEvents === undefined ? {} : { statusEvents }),
    }));
  }

  logUnclassified(packet: CapturedFishNetPacket): void {
    if (this.enabled) this.logger?.log("fishnet.packet", fishNetPacketDiagnostic(packet));
  }

  consumeLiteNet(packet: CapturedLiteNetLibPacket): void {
    if (!this.enabled) return;
    const capturedAtMs = packet.udpPacket.capturedAt.getTime();
    const bytes = packet.packet.raw.length;
    const data = liteNetPacketDiagnostic(packet);
    if (capturedAtMs <= this.transitionUntilMs) {
      if (this.transitionBytes + bytes <= TRANSITION_BYTE_LIMIT) {
        this.transitionBytes += bytes;
        this.logger?.log("capture.liteNetPacket", jsonObject({
          transitionId: this.transitionId,
          phase: "after-authenticated",
          ...data,
        }));
      } else if (!this.transitionTruncated) {
        this.transitionTruncated = true;
        this.logger?.log("capture.diagnosticLimit", {
          transitionId: this.transitionId,
          phase: "after-authenticated",
          byteLimit: TRANSITION_BYTE_LIMIT,
        });
      }
      return;
    }

    this.buffer.push({ capturedAtMs, bytes, data });
    this.bufferBytes += bytes;
    const oldestAllowed = capturedAtMs - PRE_AUTH_MS;
    while (this.buffer[0]
      && (this.buffer[0].capturedAtMs < oldestAllowed || this.bufferBytes > PRE_AUTH_BYTE_LIMIT)) {
      const removed = this.buffer.shift()!;
      this.bufferBytes -= removed.bytes;
      this.dropped += 1;
    }
  }

  beginTransition(packet: CapturedFishNetPacket): void {
    if (!this.enabled) return;
    const capturedAtMs = packet.liteNetPacket?.udpPacket.capturedAt.getTime() ?? Date.now();
    this.transitionId += 1;
    this.transitionUntilMs = capturedAtMs + POST_AUTH_MS;
    this.transitionBytes = 0;
    this.transitionTruncated = false;
    this.logger?.log("capture.mapTransition", {
      transitionId: this.transitionId,
      tick: packet.tick,
      connectionId: packet.connectionId,
      bufferedLiteNetPackets: this.buffer.length,
      bufferedLiteNetBytes: this.bufferBytes,
      droppedBufferedPackets: this.dropped,
      preAuthenticatedMs: PRE_AUTH_MS,
      postAuthenticatedMs: POST_AUTH_MS,
    });
    for (const entry of this.buffer) {
      this.transitionBytes += entry.bytes;
      this.logger?.log("capture.liteNetPacket", jsonObject({
        transitionId: this.transitionId,
        phase: "before-authenticated",
        ...entry.data,
      }));
    }
    this.buffer = [];
    this.bufferBytes = 0;
    this.dropped = 0;
  }

  clear(): void {
    this.buffer = [];
    this.bufferBytes = 0;
    this.dropped = 0;
    this.transitionUntilMs = 0;
    this.transitionBytes = 0;
    this.transitionTruncated = false;
  }
}

export function fishNetPacketDiagnostic(packet: CapturedFishNetPacket): JsonObject {
  return jsonObject({
    tick: packet.tick,
    connectionId: packet.connectionId,
    packetId: packet.packetId,
    packetName: packet.packetName,
    objectId: packet.objectId,
    ownerConnectionId: packet.ownerConnectionId,
    rpcName: packet.rpcName,
    rpcResolution: packet.rpcResolution,
    networkBehaviourType: packet.networkBehaviourType,
    networkBehaviourIndex: packet.networkBehaviourIndex,
    decodedFields: packet.decodedFields,
    syncName: packet.syncName,
    broadcastName: packet.broadcastName,
    linkId: packet.linkId,
    linkResolved: packet.linkResolved,
    registeredObjectId: packet.registeredObjectId,
    registeredComponentIndex: packet.registeredComponentIndex,
    registeredRpcHash: packet.registeredRpcHash,
    rpcHash: packet.rpcHash,
    rpcPayloadLength: packet.rpcPayloadLength,
    payloadHex: packet.payload,
    undecodedPayloadHex: packet.undecodedPayload,
    rawHex: packet.raw,
  });
}

function liteNetPacketDiagnostic(packet: CapturedLiteNetLibPacket): JsonObject {
  const udp = packet.udpPacket;
  const liteNet = packet.packet;
  return jsonObject({
    capturedAt: udp.capturedAt,
    direction: udp.direction,
    sourceIP: udp.sourceIP,
    sourcePort: udp.sourcePort,
    destinationIP: udp.destinationIP,
    destinationPort: udp.destinationPort,
    interfaceIndex: udp.interfaceIndex,
    truncated: udp.truncated,
    property: liteNet.property,
    connectionNumber: liteNet.connectionNumber,
    sequence: "sequence" in liteNet ? liteNet.sequence : undefined,
    channel: "channel" in liteNet ? liteNet.channel : undefined,
    fragment: "fragment" in liteNet ? liteNet.fragment : undefined,
    mergePath: packet.mergePath,
    rawHex: liteNet.raw,
  });
}

function jsonObject(value: object): JsonObject {
  return jsonValue(value) as JsonObject;
}

function jsonValue(value: unknown): JsonData {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => entry === undefined ? [] : [[key, jsonValue(entry)]]));
  }
  return String(value);
}
