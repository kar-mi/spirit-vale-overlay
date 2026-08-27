import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export const windowsNeutralinoBinary = "neutralino-win_x64.exe";

export function isNonWindowsNeutralinoBinary(fileName: string): boolean {
  return /^neutralino-(?:linux|mac)_/.test(fileName);
}

if (import.meta.main) {
  const binDirectory = path.resolve(import.meta.dir, "..", "bin");
  const entries = await readdir(binDirectory);
  if (!entries.includes(windowsNeutralinoBinary)) {
    throw new Error(`Missing Windows Neutralino binary: ${path.join(binDirectory, windowsNeutralinoBinary)}`);
  }

  const excluded = entries.filter(isNonWindowsNeutralinoBinary);
  await Promise.all(excluded.map((fileName) => rm(path.join(binDirectory, fileName), { force: true })));
  console.log(`Selected Windows x64 Neutralino release binary; excluded ${excluded.length} other platform binaries.`);
}
