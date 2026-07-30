/** Stable player key: character names are unique after trimming and case folding. */
export function normalizePlayerName(name: string): string {
  return name.trim().toLocaleLowerCase();
}
