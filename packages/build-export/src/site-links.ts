
import type { V2Build } from "./build.ts";

export const SITE_ORIGIN = "https://spiritvalers.com";

export function encodeBuildFragment(build: V2Build): string {
  return Buffer.from(JSON.stringify(build), "utf8").toString("base64url");
}

export function decodeBuildFragment(payload: string): V2Build {
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as V2Build;
}

export function buildPlannerLink(build: V2Build, origin: string = SITE_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/simulator#b=${encodeBuildFragment(build)}`;
}
