import type { RpcPacket } from "./protocol.ts";
import type { DesktopRPCSchema } from "@svoverlay/contracts/rpc";

export type CombinedSchema = DesktopRPCSchema;

type Side = "bun" | "webview";
type Other<S extends Side> = S extends "bun" ? "webview" : "bun";
type Requests<S extends CombinedSchema, K extends Side> = S[K]["requests"];
type Messages<S extends CombinedSchema, K extends Side> = S[K]["messages"];
type RequestProxy<S extends CombinedSchema, K extends Side> = {
  [M in keyof Requests<S, Other<K>>]: (
    params: Requests<S, Other<K>>[M] extends { params: infer P } ? P : never,
  ) => Promise<Requests<S, Other<K>>[M] extends { response: infer R } ? R : void>;
};
type SendProxy<S extends CombinedSchema, K extends Side> = {
  [M in keyof Messages<S, Other<K>>]: (payload: Messages<S, Other<K>>[M]) => void;
};
type RequestHandlers<S extends CombinedSchema, K extends Side> = {
  [M in keyof Requests<S, K>]: (
    params: Requests<S, K>[M] extends { params: infer P } ? P : never,
  ) => unknown;
};
type MessageHandlers<S extends CombinedSchema, K extends Side> = {
  [M in keyof Messages<S, K>]: (payload: Messages<S, K>[M]) => void;
};

export interface RpcInstance<S extends CombinedSchema, K extends Side> {
  request: RequestProxy<S, K>;
  send: SendProxy<S, K>;
  proxy: { request: RequestProxy<S, K>; send: SendProxy<S, K> };
  setTransport(transport: Transport): void;
  close(reason?: string): void;
}

export interface Transport {
  send(message: RpcPacket): void;
  registerHandler(handler: (message: RpcPacket) => void): void;
}

export function defineRpc<Schema extends CombinedSchema, LocalSide extends Side>(
  side: LocalSide,
  config: {
    maxRequestTime?: number;
    handlers: {
      requests?: Partial<RequestHandlers<Schema, LocalSide>>;
      messages?: Partial<MessageHandlers<Schema, LocalSide>>;
    };
  },
) {
  void side;
  let transport: Transport | undefined;
  let nextId = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer?: Timer }>();

  console.log("defineRpc() ... const request = new Proxy({}, { ");
  const request = new Proxy({}, {
    get: (_target, method: string) => (params: unknown) => new Promise((resolve, reject) => {
      console.log("if (!transport)", transport);

      if (!transport) return reject(new Error("RPC transport is not connected."));
      const id = ++nextId;
      const max = config.maxRequestTime ?? 30_000;
      const entry: { resolve(value: unknown): void; reject(error: Error): void; timer?: Timer } = { resolve, reject };

      console.log("if (max !== Infinity) entry.timer = setTimeout(() => { ...");

      if (max !== Infinity) entry.timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC request timed out: ${method}`));
      }, max);

      pending.set(id, entry);
      const packet: RpcPacket = { type: "request", id, method, params };
      console.log("Sent RPC request:", pending, id, entry, transport, packet);
      transport.send(packet);
    }),
  }) as RequestProxy<Schema, LocalSide>;

  const send = new Proxy({}, {
    get: (_target, id: string) => (payload: unknown) => transport?.send({ type: "message", id, payload }),
  }) as SendProxy<Schema, LocalSide>;

  async function receive(packet: RpcPacket): Promise<void> {
    if (packet.type === "response") {
      const entry = pending.get(packet.id);
      if (!entry) return;
      pending.delete(packet.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (packet.success) entry.resolve(packet.payload);
      else entry.reject(new Error(packet.error ?? "RPC request failed."));
      return;
    }
    if (packet.type === "message") {
      const handler = (config.handlers.messages as Record<string, ((payload: unknown) => void) | undefined> | undefined)?.[packet.id];
      handler?.(packet.payload);
      return;
    }
    if (packet.type === "request") {
      const handler = (config.handlers.requests as Record<string, ((params: unknown) => unknown) | undefined> | undefined)?.[packet.method];
      if (!handler) {
        transport?.send({ type: "response", id: packet.id, success: false, error: `No handler for ${packet.method}` });
        return;
      }
      try {
        transport?.send({ type: "response", id: packet.id, success: true, payload: await handler(packet.params) });
      } catch (error) {
        transport?.send({ type: "response", id: packet.id, success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return {
    request,
    send,
    proxy: { request, send },
    setTransport(next: Transport): void {
      transport = next;
      next.registerHandler((packet) => void receive(packet));
    },
    close(reason = "RPC connection closed."): void {
      for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
      pending.clear();
    },
  } satisfies RpcInstance<Schema, LocalSide>;
}
