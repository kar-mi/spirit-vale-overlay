import { describe, expect, test } from "bun:test";

import { findAvailableUpdate, isNewerVersion, versionFromTag } from "./update-check.ts";

describe("release update checks", () => {
  test("recognizes the app release tag format", () => {
    expect(versionFromTag("app-v0.6.5")).toBe("0.6.5");
    expect(versionFromTag("v0.6.5")).toBeUndefined();
  });

  test("compares semantic release versions", () => {
    expect(isNewerVersion("0.7.0", "0.6.4")).toBe(true);
    expect(isNewerVersion("0.6.5", "0.6.4")).toBe(true);
    expect(isNewerVersion("0.6.4", "0.6.4")).toBe(false);
    expect(isNewerVersion("0.6.3", "0.6.4")).toBe(false);
  });

  test("returns a newer published GitHub release", async () => {
    const update = await findAvailableUpdate("0.6.4", async () => new Response(JSON.stringify({
      tag_name: "app-v0.6.5",
      html_url: "https://github.com/kar-mi/spirit-vale-overlay/releases/tag/app-v0.6.5",
    }), { status: 200 }));
    expect(update).toEqual({
      version: "0.6.5",
      url: "https://github.com/kar-mi/spirit-vale-overlay/releases/tag/app-v0.6.5",
    });
  });

  test("does not notify for failed, draft, or older releases", async () => {
    const unavailable = await findAvailableUpdate("0.6.4", async () => new Response("", { status: 503 }));
    const draft = await findAvailableUpdate("0.6.4", async () => new Response(JSON.stringify({
      tag_name: "app-v0.6.5", html_url: "https://example.test", draft: true,
    })));
    const older = await findAvailableUpdate("0.6.4", async () => new Response(JSON.stringify({
      tag_name: "app-v0.6.3", html_url: "https://example.test",
    })));
    expect(unavailable).toBeUndefined();
    expect(draft).toBeUndefined();
    expect(older).toBeUndefined();
  });
});
