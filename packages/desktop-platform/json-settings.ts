import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

export interface WriteJsonFileOptions {
  /** Pretty-prints with 2-space indentation and a trailing newline. Defaults to true. */
  pretty?: boolean;
  /**
   * Gives the temporary file a random suffix rather than the plain `.tmp` one, so two writers that
   * might target the same path around the same time can never collide on the same temp file.
   * Defaults to false — only needed where more than one process/writer saves the same file.
   */
  uniqueTemp?: boolean;
}

/**
 * Writes `value` as JSON to `file`, atomically: the data lands in a temporary file first and is
 * renamed into place, so a crash or a concurrent read can never observe a partially written file.
 * The parent directory is created first if it does not already exist.
 */
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
