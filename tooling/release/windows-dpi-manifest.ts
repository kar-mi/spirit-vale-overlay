import { readFile, writeFile } from "node:fs/promises";
import { NtExecutable, NtExecutableResource } from "pe-library";

const RT_MANIFEST = 24;
const APPLICATION_MANIFEST = 1;
const DPI_SETTINGS = `
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
    </windowsSettings>
  </application>`;

export function withPerMonitorV2Manifest(manifest: string): string {
  if (/PerMonitorV2/i.test(manifest)) return manifest;
  const closingAssembly = manifest.lastIndexOf("</assembly>");
  if (closingAssembly < 0) throw new Error("Windows executable manifest has no closing assembly element.");
  return manifest.slice(0, closingAssembly) + DPI_SETTINGS + "\n" + manifest.slice(closingAssembly);
}

export async function patchWindowsDpiManifest(executablePath: string): Promise<void> {
  const input = await readFile(executablePath);
  const executable = NtExecutable.from(input);
  const resources = NtExecutableResource.from(executable);
  const manifests = resources.getResourceEntriesAsString(RT_MANIFEST, APPLICATION_MANIFEST);
  if (manifests.length === 0) throw new Error(`No application manifest found in ${executablePath}.`);
  for (const [language, manifest] of manifests) {
    resources.replaceResourceEntryFromString(
      RT_MANIFEST,
      APPLICATION_MANIFEST,
      language,
      withPerMonitorV2Manifest(manifest),
    );
  }
  resources.outputResource(executable);
  await writeFile(executablePath, new Uint8Array(executable.generate()));
}

export async function readWindowsManifest(executablePath: string): Promise<string> {
  const executable = NtExecutable.from(await readFile(executablePath));
  const resources = NtExecutableResource.from(executable);
  return resources.getResourceEntriesAsString(RT_MANIFEST, APPLICATION_MANIFEST)
    .map(([, manifest]) => manifest)
    .join("\n");
}
