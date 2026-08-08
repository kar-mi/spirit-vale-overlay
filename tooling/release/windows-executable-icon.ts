import { readFile, writeFile } from "node:fs/promises";
import * as ResEdit from "resedit";

export async function replaceWindowsExecutableIcon(executablePath: string, iconPath: string): Promise<void> {
  const executable = ResEdit.NtExecutable.from(await readFile(executablePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const icons = ResEdit.Data.IconFile.from(await readFile(iconPath)).icons.map((icon) => icon.data);
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);

  if (iconGroups.length === 0) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icons);
  } else {
    for (const iconGroup of iconGroups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        iconGroup.id,
        iconGroup.lang,
        icons,
      );
    }
  }

  resources.outputResource(executable);
  await writeFile(executablePath, new Uint8Array(executable.generate()));
}
