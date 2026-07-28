export interface LatestRelease {
  version: string;
  url: string;
}

type FetchRelease = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export const RELEASES_LATEST_URL = "https://api.github.com/repos/kar-mi/spirit-vale-overlay/releases/latest";

/** Returns the latest stable release only when it is newer than the running app. */
export async function findAvailableUpdate(
  currentVersion: string,
  fetcher: FetchRelease = fetch,
): Promise<LatestRelease | undefined> {
  const response = await fetcher(RELEASES_LATEST_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return undefined;

  const release = await response.json() as GitHubRelease;
  if (release.draft === true || release.prerelease === true || typeof release.tag_name !== "string" || typeof release.html_url !== "string") {
    return undefined;
  }
  const version = versionFromTag(release.tag_name);
  return version && isNewerVersion(version, currentVersion) ? { version, url: release.html_url } : undefined;
}

export function versionFromTag(tag: string): string | undefined {
  const match = /^app-v(\d+\.\d+\.\d+)$/.exec(tag.trim());
  return match?.[1];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) return false;
  return candidateParts.some((part, index) => part !== currentParts[index]
    && part > (currentParts[index] ?? 0));
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
