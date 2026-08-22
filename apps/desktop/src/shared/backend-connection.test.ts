import { describe, expect, test } from "bun:test";

import { backendConnectionFromSearch, backendConnectionUrl } from "./backend-connection.ts";

describe("Neutralino child backend connection URL", () => {
  test("uses one shell-safe query parameter and round-trips the connection", () => {
    const connection = { port: 43125, ticket: "32e2d281-2445-49aa-bd09-b2a9336704e7" };
    const url = backendConnectionUrl("/views/overlayview/index.html", connection);

    expect(url).not.toMatch(/[&%]/);
    expect(url).toStartWith("/views/overlayview/index.html?desktopBackend=");
    expect(url.split("=")[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(backendConnectionFromSearch(new URL(url, "http://localhost").search)).toEqual(connection);
  });

  test("accepts the legacy two-parameter URL", () => {
    expect(backendConnectionFromSearch("?backendPort=43125&ticket=legacy-ticket")).toEqual({
      port: 43125,
      ticket: "legacy-ticket",
    });
  });
});
