import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CapturedFishNetPacket,
  CapturedLiteNetLibPacket,
  CaptureConfig,
} from "@kar-mi/spirit-vale-tools-capture";
import type { PacketCapture } from "@kar-mi/spirit-vale-tools-capture/capture";
import { getCurrentExecutableNames } from "@svoverlay/desktop-platform/executable-names";

import { CaptureCoordinator, type CaptureCoordinatorOptions } from "./capture-coordinator.ts";
import type { Clock, ClockTimer } from "./clock.ts";

export type TestPacket = Omit<CapturedFishNetPacket, "liteNetPacket" | "connectionId"> & { connectionId?: string };

export class FakeCapture extends EventEmitter {
  readonly configs: CaptureConfig[] = [];
  failDeviceName?: string;
  initialTargetState: "waiting" | "active" = "waiting";

  constructor(private readonly startError?: Error) {
    super();
  }

  async start(config: CaptureConfig): Promise<void> {
    this.configs.push(config);
    if (this.startError) throw this.startError;
    if (this.failDeviceName !== undefined && config.deviceName === this.failDeviceName) {
      throw new Error("synthetic adapter unavailable");
    }
    this.target(this.initialTargetState, this.initialTargetState === "active" ? [4242] : []);
    this.emit("started");
  }

  async stop(): Promise<void> {
    this.emit("stopped");
  }

  packet(packet: TestPacket): void {
    const raw = packet.raw;
    const captured: CapturedFishNetPacket = {
      connectionId: "test-connection",
      liteNetPacket: capturedLiteNetPacket(new Date(), raw),
      ...packet,
    };
    this.emit("fishNetPacket", captured);
  }

  liteNet(packet: CapturedLiteNetLibPacket): void {
    this.emit("liteNetPacket", packet);
  }

  udp(packet: CapturedLiteNetLibPacket["udpPacket"]): void {
    this.emit("udpPacket", packet);
  }

  connection(connectionId: string, state: "opened" | "closed"): void {
    this.emit("connection", { connectionId, state });
  }

  fail(error: Error): void {
    this.emit("error", error);
  }

  target(state: "waiting" | "active", processIds: number[] = []): void {
    this.emit("targetStatus", {
      processName: getCurrentExecutableNames().gameProcess,
      state,
      processIds,
    });
  }
}

export class TestClock implements Clock {
  private currentMs = Date.UTC(2026, 0, 1);
  private nextId = 1;
  private readonly tasks = new Map<number, {
    callback: () => void | Promise<void>;
    dueAtMs: number;
    intervalMs?: number;
  }>();

  now(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void | Promise<void>, delayMs: number): ClockTimer {
    return this.schedule(callback, delayMs);
  }

  clearTimeout(timer: ClockTimer): void {
    this.tasks.delete(timer as unknown as number);
  }

  setInterval(callback: () => void | Promise<void>, delayMs: number): ClockTimer {
    return this.schedule(callback, delayMs, delayMs);
  }

  clearInterval(timer: ClockTimer): void {
    this.clearTimeout(timer);
  }

  async advanceBy(durationMs: number): Promise<void> {
    const targetMs = this.currentMs + durationMs;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAtMs <= targetMs)
        .sort(([leftId, left], [rightId, right]) => left.dueAtMs - right.dueAtMs || leftId - rightId)[0];
      if (next === undefined) break;
      const [id, task] = next;
      this.currentMs = task.dueAtMs;
      if (task.intervalMs === undefined) this.tasks.delete(id);
      else task.dueAtMs += task.intervalMs;
      await task.callback();
    }
    this.currentMs = targetMs;
  }

  private schedule(
    callback: () => void | Promise<void>,
    delayMs: number,
    intervalMs?: number,
  ): ClockTimer {
    const id = this.nextId++;
    this.tasks.set(id, {
      callback,
      dueAtMs: this.currentMs + Math.max(0, delayMs),
      ...(intervalMs === undefined ? {} : { intervalMs }),
    });
    return id as unknown as ClockTimer;
  }
}

interface CoordinatorHarnessOptions {
  capture?: FakeCapture;
  clock?: TestClock;
  options?: Omit<CaptureCoordinatorOptions, "logDirectory" | "captureFactory" | "clock">;
}

export async function withCoordinator(
  harness: CoordinatorHarnessOptions,
  run: (context: {
    coordinator: CaptureCoordinator;
    capture: FakeCapture;
    clock: TestClock;
    directory: string;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-"));
  const capture = harness.capture ?? new FakeCapture();
  const clock = harness.clock ?? new TestClock();
  const coordinator = new CaptureCoordinator({
    ...harness.options,
    logDirectory: directory,
    captureFactory: () => capture as unknown as PacketCapture,
    clock,
  });
  try {
    await coordinator.start();
    await run({ coordinator, capture, clock, directory });
  } finally {
    try {
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function capturedLiteNetPacket(capturedAt: Date, raw: Buffer): CapturedLiteNetLibPacket {
  return {
    mergePath: [],
    packet: {
      propertyId: 1,
      property: "channeled",
      connectionNumber: 0,
      fragmented: false,
      sequence: 1,
      channel: 0,
      raw,
      payload: raw,
    },
    udpPacket: {
      timestampTicks: 0n,
      capturedAt,
      interfaceIndex: 1,
      subinterfaceIndex: 0,
      direction: "inbound",
      loopback: false,
      ipVersion: 4,
      sourceIP: "127.0.0.1",
      destinationIP: "127.0.0.1",
      sourcePort: 7000,
      destinationPort: 7001,
      truncated: false,
      payload: raw,
      protocol: "udp",
    },
  };
}
