import { describe, expect, test } from "bun:test";

const root = `${import.meta.dir}/..`;

describe("Electron shell configuration", () => {
  test("packages a plain unpacked folder, never electron-builder's portable target", async () => {
    const builder = await Bun.file(`${root}/electron-builder.yml`).text();
    expect(builder).toMatch(/target:\s*\n\s*- dir/);
    expect(builder).not.toMatch(/target:\s*\n\s*- portable/);
    // The backend sidecars must be real files: bun:ffi / bun:sqlite / Bun.spawn
    // cannot load from inside an asar archive.
    expect(builder).toContain("resources/extensions/**");
  });

  test("keeps the renderer <-> backend wire protocol identical to the Neutralino build", async () => {
    const viewSource = await Bun.file(`${root}/src/frontend/view.ts`).text();
    expect(viewSource).toContain("ws://127.0.0.1:${connection.port}/rpc");
    expect(viewSource).toContain('kind: "hello", ticket: connection.ticket');
    expect(viewSource).toContain("watchBackendReconnecting");
  });

  test("swaps only the view module at bundle time", async () => {
    const buildSource = await Bun.file(`${root}/src/build.ts`).text();
    expect(buildSource).toContain("@svoverlay\\/desktop-runtime\\/view");
    expect(buildSource).toContain("src/frontend/view.ts");
    // The backend runtime alias is shared, never swapped.
    expect(buildSource).not.toContain("desktop-runtime$");
  });

  test("stages the version from the workspace package.json", async () => {
    const buildSource = await Bun.file(`${root}/src/build.ts`).text();
    expect(buildSource).toContain('Bun.file(path.join(workspace, "package.json")).json()');
  });
});
