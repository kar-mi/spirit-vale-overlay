import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ResEdit from "resedit";

/** The English (United States) / Unicode string table every Windows shell reads by default. */
const language = { lang: 1033, codepage: 1200 } as const;

export const productName = "Spirit Vale Overlay";
export const companyName = "kar-mi";
export const legalCopyright = "Copyright (C) 2026 kar-mi. Licensed under the GNU AGPL v3.";

export interface WindowsExecutableMetadata {
  /** Shown as the file's "Description" in Explorer and in the Task Manager process list. */
  fileDescription: string;
  /** Marketing version as `major.minor.patch`; padded to the four-part Windows form. */
  version: string;
}

/** Windows wants four numeric parts, while package.json carries three (plus any prerelease tag). */
export function toWindowsVersion(version: string): string {
  const parts = version.split(/[.+-]/, 4).map((part) => Number.parseInt(part, 10));
  const numbers = [0, 1, 2, 3].map((index) => {
    const value = parts[index];
    return Number.isFinite(value) ? Math.min(Math.max(value!, 0), 65535) : 0;
  });
  return numbers.join(".");
}

/**
 * Writes a complete version-resource block into a Windows executable.
 *
 * An unsigned EXE whose Explorer property sheet is blank is one of the strongest heuristic signals
 * antivirus engines score on. This helper is intentionally limited to unsigned project launchers;
 * signed third-party executables such as bun.exe must never pass through it. Some compilers emit a
 * `VS_VERSION_INFO` block whose string table is present but empty, so the values have to be written
 * into the language Windows actually resolves. Any other string table is dropped —
 * Windows reads the first translation it is offered, so a leftover empty one wins and shows blanks.
 * Executables with no block at all get a freshly created one.
 */
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
