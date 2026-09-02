import type { CapturedLiteNetLibPacket } from "@kar-mi/spirit-vale-tools-capture";
import type { PacketCapture } from "@kar-mi/spirit-vale-tools-capture/capture";

import type { CaptureHealthWarning, CaptureWarningCode } from "../launcher/types.ts";

type CaptureStage = "waiting" | "udp" | "litenet" | "fishnet";

export interface CaptureHealthReport {
  title: string;
  reason: string;
  details: Readonly<Record<string, string | number | boolean | undefined>>;
}

export interface CaptureHealthMonitorOptions {
  capture: PacketCapture;
  diagnosticLogging: boolean;
  deviceName?: string;
  stallWarningMs: number;
  onLiteNetPacket: (packet: CapturedLiteNetLibPacket) => void;
  onChange: () => void;
  onWarning: (report: CaptureHealthReport) => void;
}

export class CaptureHealthMonitor {
  private warningValue?: CaptureHealthWarning;
  private stage: CaptureStage = "waiting";
  private stageSinceMs = Date.now();
  private stageTimer?: ReturnType<typeof setTimeout>;
  private udpPacketCount = 0;
  private liteNetPacketCount = 0;
  private fishNetPacketCount = 0;
  private lastFishNetPacketAtMs?: number;
  private captureWarningCount = 0;
  private lastCaptureWarning?: string;
  private readonly reportedStallStages = new Set<string>();
  private targetActive = false;

  private readonly captureUdpPacket = (): void => {
    this.options.capture.off("udpPacket", this.captureUdpPacket);
    this.observe("udp");
  };

  private readonly captureLiteNetPacket = (packet: CapturedLiteNetLibPacket): void => {
    if (!this.options.diagnosticLogging) this.options.capture.off("liteNetPacket", this.captureLiteNetPacket);
    this.observe("litenet");
    this.options.onLiteNetPacket(packet);
  };

  constructor(private readonly options: CaptureHealthMonitorOptions) {
    this.armListeners();
  }

  warning(): CaptureHealthWarning | undefined {
    return this.warningValue;
  }

  setTargetActive(active: boolean): void {
    this.targetActive = active;
    if (active) this.scheduleWarning();
    else this.clearTimer();
  }

  observeFishNet(): void {
    this.observe("fishnet");
  }

  observeCaptureWarning(message: string): void {
    this.captureWarningCount += 1;
    this.lastCaptureWarning = message;
  }

  reset(): void {
    this.clearTimer();
    this.armListeners();
    const changed = this.warningValue !== undefined;
    this.warningValue = undefined;
    this.stage = "waiting";
    this.stageSinceMs = Date.now();
    this.udpPacketCount = 0;
    this.liteNetPacketCount = 0;
    this.fishNetPacketCount = 0;
    this.lastFishNetPacketAtMs = undefined;
    this.captureWarningCount = 0;
    this.lastCaptureWarning = undefined;
    this.reportedStallStages.clear();
    if (changed) this.options.onChange();
  }

  private observe(stage: Exclude<CaptureStage, "waiting">): void {
    const observedAtMs = Date.now();
    if (stage === "udp") this.udpPacketCount += 1;
    else if (stage === "litenet") this.liteNetPacketCount += 1;
    else {
      this.options.capture.off("udpPacket", this.captureUdpPacket);
      if (!this.options.diagnosticLogging) this.options.capture.off("liteNetPacket", this.captureLiteNetPacket);
      this.fishNetPacketCount += 1;
      this.lastFishNetPacketAtMs = observedAtMs;
      if (this.warningValue) {
        this.warningValue = undefined;
        this.options.onChange();
      }
      if (this.stage === "fishnet") {
        if (this.stageTimer === undefined && this.targetActive) this.scheduleWarning();
        return;
      }
    }
    if (stageRank(stage) <= stageRank(this.stage)) return;
    this.stage = stage;
    this.stageSinceMs = observedAtMs;
    const changed = this.warningValue !== undefined;
    this.warningValue = undefined;
    this.clearTimer();
    if (this.targetActive) this.scheduleWarning();
    if (changed) this.options.onChange();
  }

  private scheduleWarning(): void {
    this.clearTimer();
    const elapsed = this.stage === "fishnet" && this.lastFishNetPacketAtMs !== undefined
      ? Date.now() - this.lastFishNetPacketAtMs
      : 0;
    this.stageTimer = setTimeout(() => {
      this.stageTimer = undefined;
      this.publishWarning();
    }, Math.max(0, this.options.stallWarningMs - elapsed));
    this.stageTimer.unref?.();
  }

  private publishWarning(): void {
    if (!this.targetActive) return;
    if (this.stage === "fishnet" && this.lastFishNetPacketAtMs !== undefined
      && Date.now() - this.lastFishNetPacketAtMs < this.options.stallWarningMs) {
      this.scheduleWarning();
      return;
    }
    const warning = warningForStage(this.stage);
    this.warningValue = { ...warning, detectedAt: new Date().toISOString() };
    this.options.onChange();
    if (this.reportedStallStages.has(warning.code)) return;
    this.reportedStallStages.add(warning.code);
    this.options.onWarning({
      title: "Capture is still waiting for usable game data",
      reason: warning.message,
      details: {
        "Capture stage": this.stage,
        "Stage waiting since": new Date(this.stageSinceMs).toISOString(),
        "Target-owned UDP packets": this.udpPacketCount,
        "LiteNetLib packets": this.liteNetPacketCount,
        "FishNet packets": this.fishNetPacketCount,
        "Capture warnings": this.captureWarningCount,
        "Latest capture warning": this.lastCaptureWarning,
        "Network adapter": this.options.deviceName ?? "Automatic selection",
      },
    });
  }

  private armListeners(): void {
    this.options.capture.off("udpPacket", this.captureUdpPacket);
    this.options.capture.on("udpPacket", this.captureUdpPacket);
    this.options.capture.off("liteNetPacket", this.captureLiteNetPacket);
    this.options.capture.on("liteNetPacket", this.captureLiteNetPacket);
  }

  private clearTimer(): void {
    if (this.stageTimer !== undefined) clearTimeout(this.stageTimer);
    this.stageTimer = undefined;
  }
}

function stageRank(stage: CaptureStage): number {
  return ["waiting", "udp", "litenet", "fishnet"].indexOf(stage);
}

function warningForStage(stage: CaptureStage): { code: CaptureWarningCode; message: string } {
  if (stage === "waiting") return {
    code: "no-game-udp",
    message: "Still waiting for game network traffic. Capture remains active; check the adapter or VPN route if this continues.",
  };
  if (stage === "udp") return {
    code: "unrecognized-game-udp",
    message: "Game traffic is arriving, but it has not produced LiteNetLib data yet. Capture remains active.",
  };
  if (stage === "litenet") return {
    code: "fishnet-decode-stalled",
    message: "Game traffic is arriving, but no FishNet data has decoded yet. Capture remains active.",
  };
  return {
    code: "fishnet-data-delayed",
    message: "Decoded game data has paused. Capture remains active and will recover automatically when packets resume.",
  };
}
