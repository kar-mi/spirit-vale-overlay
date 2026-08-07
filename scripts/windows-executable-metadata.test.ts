import { expect, test } from "bun:test";

import { toWindowsVersion } from "./windows-executable-metadata.ts";

test("pads a semantic version to the four-part Windows form", () => {
  expect(toWindowsVersion("0.9.0")).toBe("0.9.0.0");
  expect(toWindowsVersion("1.2.3.4")).toBe("1.2.3.4");
});

test("keeps prerelease versions numeric", () => {
  expect(toWindowsVersion("1.2.3-beta.4")).toBe("1.2.3.0");
});

test("clamps parts to the Windows 16-bit range", () => {
  expect(toWindowsVersion("70000.1.2")).toBe("65535.1.2.0");
});
