import { expect, test } from "bun:test";
import { withPerMonitorV2Manifest } from "./windows-dpi-manifest.ts";

test("adds PMv2 settings while preserving the existing manifest", () => {
  const original = `<?xml version="1.0"?><assembly><trustInfo>keep-me</trustInfo></assembly>`;
  const patched = withPerMonitorV2Manifest(original);

  expect(patched).toContain("<trustInfo>keep-me</trustInfo>");
  expect(patched).toContain("<dpiAware");
  expect(patched).toContain("true/pm");
  expect(patched).toContain("PerMonitorV2, PerMonitor");
  expect(withPerMonitorV2Manifest(patched)).toBe(patched);
});
