import { readFile } from "node:fs/promises";

/** Loads JSON settings, returning a fresh default value when the file is absent or invalid. */
export async function loadJsonSettings<T>(
  file: string,
  validate: (candidate: unknown) => T,
  defaults: () => T,
): Promise<T> {
  try {
    return validate(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return defaults();
  }
}
