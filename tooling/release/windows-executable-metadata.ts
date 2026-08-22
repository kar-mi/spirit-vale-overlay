import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ResEdit from "resedit";

const language = { lang: 1033, codepage: 1200 } as const;

export const productName = "Spirit Vale Overlay";
export const companyName = "kar-mi";
export const legalCopyright = "Copyright (C) 2026 kar-mi. Licensed under the GNU AGPL v3.";

export interface WindowsExecutableMetadata {
  fileDescription: string;
  version: string;
}

export function toWindowsVersion(version: string): string {
  const parts = version.split(/[.+-]/, 4).map((part) => Number.parseInt(part, 10));
  const numbers = [0, 1, 2, 3].map((index) => {
    const value = parts[index];
    return Number.isFinite(value) ? Math.min(Math.max(value!, 0), 65535) : 0;
  });
  return numbers.join(".");
}

export async function setWindowsExecutableMetadata(
  executablePath: string,
  metadata: WindowsExecutableMetadata,
): Promise<void> {
  const executable = ResEdit.NtExecutable.from(await readFile(executablePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const windowsVersion = toWindowsVersion(metadata.version);
  const values = {
    CompanyName: companyName,
    FileDescription: metadata.fileDescription,
    FileVersion: windowsVersion,
    InternalName: path.basename(executablePath, ".exe"),
    LegalCopyright: legalCopyright,
    OriginalFilename: path.basename(executablePath),
    ProductName: productName,
    ProductVersion: windowsVersion,
  };

  const existing = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const versionInfoList = existing.length > 0 ? existing : [
    ResEdit.Resource.VersionInfo.create({
      lang: language.lang,
      fixedInfo: {
        fileFlagsMask: 0x3f,
        fileOS: ResEdit.Resource.VersionFileOS.NT_Windows32,
        fileType: ResEdit.Resource.VersionFileType.App,
      },
      strings: [{ ...language, values }],
    }),
  ];

  for (const versionInfo of versionInfoList) {
    for (const existingLanguage of versionInfo.getAllLanguagesForStringValues()) {
      if (existingLanguage.lang !== language.lang || existingLanguage.codepage !== language.codepage) {
        versionInfo.removeAllStringValues(existingLanguage);
      }
    }
    versionInfo.setStringValues(language, values);
    versionInfo.replaceAvailableLanguages([language]);
    versionInfo.setFileVersion(windowsVersion, language.lang);
    versionInfo.setProductVersion(windowsVersion, language.lang);
    versionInfo.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(executable);
  await writeFile(executablePath, new Uint8Array(executable.generate()));
}
