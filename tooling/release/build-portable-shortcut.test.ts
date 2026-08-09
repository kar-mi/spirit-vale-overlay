import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const source = await readFile(path.join(import.meta.dir, "portable-shortcut.cs"), "utf8");
const script = await readFile(path.join(import.meta.dir, "build-portable-shortcut.ps1"), "utf8");

test("portable shortcut disables absolute-path and object tracking", () => {
  expect(source).toContain("IShellLinkDataList");
  expect(source).toContain("ForceNoLinkInfo");
  expect(source).toContain("ForceNoLinkTrack");
  expect(source).toContain("flags | ForceNoLinkInfo | ForceNoLinkTrack");
  expect(script).toContain("portable-shortcut.cs");
});

test.skipIf(process.platform !== "win32")("portable shortcut resolves after its folder is copied", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "svo-shortcut-"));
  const original = path.join(root, "original");
  const copied = path.join(root, "copied");
  try {
    await mkdir(path.join(original, "bin"), { recursive: true });
    await writeFile(path.join(original, "bin", "launcher.exe"), "probe");
    const build = Bun.spawnSync([
      "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(import.meta.dir, "build-portable-shortcut.ps1"),
      "-OutputPath", path.join(original, "Spirit Vale Overlay.lnk"),
      "-TargetPath", path.join(original, "bin", "launcher.exe"),
    ]);
    expect(build.exitCode).toBe(0);
    await cp(original, copied, { recursive: true });
    await rm(original, { recursive: true, force: true });

    const escapedDirectory = copied.replaceAll("'", "''");
    const resolve = Bun.spawnSync([
      "powershell", "-NoProfile", "-Command",
      `$shell = New-Object -ComObject Shell.Application; $folder = $shell.NameSpace('${escapedDirectory}'); `
      + "$link = $folder.ParseName('Spirit Vale Overlay.lnk').GetLink; $link.Resolve(1); $link.Path",
    ]);
    expect(resolve.exitCode).toBe(0);
    expect(new TextDecoder().decode(resolve.stdout).trim().toLowerCase())
      .toBe(path.join(copied, "bin", "launcher.exe").toLowerCase());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
