/**
 * The handoff into spiritvalers.com's build planner.
 *
 * No site change is needed: `simulator.html` already boots a build out of the URL fragment
 * (`#b=<payload>` -> `SVUtil.decB` -> `applyBuild` -> a fresh local draft). `decB` is
 * `base64url(utf8(JSON))` — `btoa(unescape(encodeURIComponent(json)))` with `+`->`-`, `/`->`_`
 * and padding stripped — so the encoder must produce exactly that and nothing fancier.
 *
 * A fragment never leaves the browser: no request, no Referer header, no server log, no edge
 * cache entry. The player's character is not uploaded anywhere by opening this link.
 */

import type { V2Build } from "./build.ts";

export const SITE_ORIGIN = "https://spiritvalers.com";

/** base64url of the UTF-8 JSON with padding stripped — the exact inverse of the site's `decB`. */
export function encodeBuildFragment(build: V2Build): string {
  return Buffer.from(JSON.stringify(build), "utf8").toString("base64url");
}

export function decodeBuildFragment(payload: string): V2Build {
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as V2Build;
}

export function buildPlannerLink(build: V2Build, origin: string = SITE_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/simulator#b=${encodeBuildFragment(build)}`;
}
