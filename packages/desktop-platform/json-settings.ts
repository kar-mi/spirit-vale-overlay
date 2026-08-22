import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

export interface WriteJsonFileOptions {
  pretty?: boolean;
  uniqueTemp?: boolean;
}

export async function writeJsonFileAtomic(
  file: string,
  value: unknown,
  options: WriteJsonFileOptions = {},
): Promise<void> {
  const contents = options.pretty === false ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`;
  const temporary = options.uniqueTemp ? `${file}.${crypto.randomUUID()}.tmp` : `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}
