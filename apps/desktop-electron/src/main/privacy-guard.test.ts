import { describe, expect, test } from "bun:test";

import { isRemoteNetworkUrl } from "./privacy-guard.ts";

describe("Electron privacy guard", () => {
  test("blocks remote renderer traffic", () => {
    for (const url of [
      "https://example.com/telemetry",
      "http://example.com/pixel",
      "wss://example.com/socket",
      "ws://example.com/socket",
    ]) {
      expect(isRemoteNetworkUrl(url)).toBe(true);
    }
  });

  test("allows the loopback backend socket", () => {
    for (const url of [
      "ws://127.0.0.1:43125/rpc",
      "ws://localhost:43125/rpc",
      "ws://[::1]:43125/rpc",
      "http://127.0.0.1:43125/",
    ]) {
      expect(isRemoteNetworkUrl(url)).toBe(false);
    }
  });

  test("allows packaged application resources", () => {
    for (const url of [
      "app://-/views/launcherview/index.html",
      "file:///C:/Spirit%20Vale/icon.png",
      "data:text/plain,local",
    ]) {
      expect(isRemoteNetworkUrl(url)).toBe(false);
    }
  });
});
