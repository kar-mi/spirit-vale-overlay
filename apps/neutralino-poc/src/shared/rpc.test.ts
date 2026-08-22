import { describe, expect, test } from "bun:test";
import { defineRpc, type CombinedSchema, type Transport } from "./rpc.ts";
import type { RpcPacket } from "./protocol.ts";

interface TestSchema extends CombinedSchema {
  bun: { requests: { add: { params: { left: number; right: number }; response: number } }; messages: Record<string, never> };
  webview: { requests: Record<string, never>; messages: { changed: number } };
}

describe("Neutralino POC RPC", () => {
  test("correlates requests and delivers messages", async () => {
    const pair = transportPair();
    let changed = 0;
    const bun = defineRpc<TestSchema, "bun">("bun", { handlers: { requests: { add: ({ left, right }) => left + right }, messages: {} } });
    const web = defineRpc<TestSchema, "webview">("webview", { handlers: { requests: {}, messages: { changed: (value) => { changed = value; } } } });
    bun.setTransport(pair.left);
    web.setTransport(pair.right);
    expect(await web.request.add({ left: 20, right: 22 })).toBe(42);
    bun.send.changed(7);
    expect(changed).toBe(7);
  });
});

function transportPair(): { left: Transport; right: Transport } {
  let leftHandler: (packet: RpcPacket) => void = () => {};
  let rightHandler: (packet: RpcPacket) => void = () => {};
  return {
    left: { send: (packet) => rightHandler(packet), registerHandler: (handler) => { leftHandler = handler; } },
    right: { send: (packet) => leftHandler(packet), registerHandler: (handler) => { rightHandler = handler; } },
  };
}
