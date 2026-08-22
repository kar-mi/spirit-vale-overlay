import { FishNetCharacterTracker } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterSnapshot, CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import type { CapturedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";

const CHARACTER_CALLBACK_RPCS = new Set(["LoadCharacter_T", "CharacterCallback_T"]);
const ACTIVE_CHARACTER_CONNECTION_ID = "spiritvale-active-character";
const ACTIVE_CHARACTER_OBJECT_ID = -1;

type CharacterTracker = Pick<
  FishNetCharacterTracker,
  "consume" | "current" | "currentArchetypeId" | "setCached" | "state" | "subscribe"
>;

interface LocalCharacterRouterOptions {
  tracker?: CharacterTracker;
  onHandled?: () => void;
  onError?: (packet: CapturedFishNetPacket, error: unknown) => void;
}

export class LocalCharacterRouter {
  private readonly tracker: CharacterTracker;
  private physicalPlayerObjectId?: number;

  constructor(private readonly options: LocalCharacterRouterOptions = {}) {
    this.tracker = options.tracker ?? new FishNetCharacterTracker();
  }

  consumeBeforeAdmission(packet: CapturedFishNetPacket): boolean {
    if (!isCharacterCallback(packet)) return false;
    return this.consume(packet, false);
  }

  consumeAdmitted(packet: CapturedFishNetPacket): boolean {
    if (isCharacterCallback(packet) || packet.packetName === "authenticated") return false;
    return this.consume(packet, true);
  }

  physicalObjectId(): number | undefined {
    return this.physicalPlayerObjectId;
  }

  state(): CharacterViewState {
    return this.tracker.state();
  }

  setCached(snapshot: CharacterSnapshot | undefined): void {
    this.tracker.setCached(snapshot);
  }

  current(): CharacterSnapshot | undefined {
    return this.tracker.current();
  }

  currentArchetypeId(): number | undefined {
    return this.tracker.currentArchetypeId();
  }

  subscribe(listener: (state: CharacterViewState) => void): () => void {
    return this.tracker.subscribe(listener);
  }

  private consume(packet: CapturedFishNetPacket, normalizeConnection: boolean): boolean {
    try {
      const localObjectPacket = packet.packetName === "serverRpc"
        || packet.objectId !== undefined && packet.objectId === this.physicalPlayerObjectId;
      const characterPacket = normalizeConnection
        ? {
            ...packet,
            connectionId: ACTIVE_CHARACTER_CONNECTION_ID,
            ...(localObjectPacket ? { objectId: ACTIVE_CHARACTER_OBJECT_ID } : {}),
          }
        : packet;
      const handled = this.tracker.consume(characterPacket);
      if (packet.packetName === "serverRpc" && packet.objectId !== undefined) {
        this.physicalPlayerObjectId = packet.objectId;
      }
      if (handled) this.options.onHandled?.();
      return handled;
    } catch (error) {
      this.options.onError?.(packet, error);
      return true;
    }
  }
}

function isCharacterCallback(packet: CapturedFishNetPacket): boolean {
  return packet.rpcName !== undefined && CHARACTER_CALLBACK_RPCS.has(packet.rpcName);
}
