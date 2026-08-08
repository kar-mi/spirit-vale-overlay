import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("pass-through shortcut helper is compiled as a windowless native message-loop process", async () => {
  const script = await readFile(path.join(import.meta.dir, "build-pass-through-shortcuts.ps1"), "utf8");
  const source = await readFile(path.join(import.meta.dir, "pass-through-shortcuts.cs"), "utf8");

  expect(script).toContain('"/target:winexe"');
  expect(script).toContain("pass-through-shortcuts.cs");
  expect(source).toContain("WH_KEYBOARD_LL");
  expect(source).toContain("CallNextHookEx");
  expect(source).toContain("PostThreadMessage");
});
