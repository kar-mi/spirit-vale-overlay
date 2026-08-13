import { expect, test } from "bun:test";
import { classIconUrl } from "./class-icon.ts";

test("classIconUrl resolves names and archetype ids with a stable fallback", () => {
  expect(classIconUrl("Paladin")).toEndWith("class-paladin.webp");
  expect(classIconUrl(22)).toEndWith("class-gunslinger.webp");
  expect(classIconUrl(undefined)).toEndWith("class-weaver.webp");
});
