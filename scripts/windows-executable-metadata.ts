import { readFile, writeFile } from "node:fs/promises";
import * as ResEdit from "resedit";

export async function setWindowsExecutableProductName(executablePath: string, productName: string): Promise<void> {
  const executable = ResEdit.NtExecutable.from(await readFile(executablePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const versionInfoList = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);

  for (const versionInfo of versionInfoList) {
    versionInfo.setStringValues(
      { lang: 1033, codepage: 1200 },
      { FileDescription: productName, ProductName: productName },
    );
    versionInfo.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(executable);
  await writeFile(executablePath, new Uint8Array(executable.generate()));
}
