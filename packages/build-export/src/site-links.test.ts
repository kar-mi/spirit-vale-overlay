import { describe, expect, test } from "bun:test";
import type { V2Build } from "./build.ts";
import { buildPlannerLink, decodeBuildFragment, encodeBuildFragment } from "./site-links.ts";

const build: V2Build = {
  v: 2,
  cls: "Gunslinger",
  name: "Nevaris \u2014 caf\u00e9",
  overview: "",
  lv: 121,
  job: 70,
  attr: { STR: 1, VIT: 1, AGI: 99, DEX: 99, INT: 1, LUK: 60 },
  eq: {},
  arti: { rune: null, jewel: null, scroll: null, relic: null },
  skills: {},
  grim: [null, null, null],
};

describe("planner handoff", () => {
  test("round-trips a build through the fragment", () => {
    expect(decodeBuildFragment(encodeBuildFragment(build))).toEqual(build);
  });

  test("encodes base64url with padding stripped, matching the site's decB", () => {
    // decB is btoa(unescape(encodeURIComponent(json))) with + -> -, / -> _ and no padding.
    const fragment = encodeBuildFragment(build);
    expect(fragment).not.toContain("=");
    expect(fragment).not.toContain("+");
    expect(fragment).not.toContain("/");

    const reference = Buffer.from(JSON.stringify(build), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(fragment).toBe(reference);
  });

  test("survives non-ASCII, which a naive btoa would throw on", () => {
    expect(decodeBuildFragment(encodeBuildFragment(build)).name).toBe("Nevaris \u2014 caf\u00e9");
  });

  test("targets the planner page and puts the build in the fragment, never the query", () => {
    const link = buildPlannerLink(build);
    expect(link.startsWith("https://spiritvalers.com/simulator#b=")).toBe(true);
    expect(new URL(link).search).toBe("");
  });

  test("honours a local origin and never doubles the slash", () => {
    expect(buildPlannerLink(build, "http://localhost:8124/")).toContain("http://localhost:8124/simulator#b=");
  });
});
