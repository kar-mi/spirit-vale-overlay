import type { Session } from "electron";

const REMOTE_NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
// URL.hostname brackets IPv6 literals, hence the bracketed ::1 form.
const LOOPBACK_HOSTS = /^(127\.\d+\.\d+\.\d+|\[::1\]|localhost)$/i;

export function isRemoteNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!REMOTE_NETWORK_SCHEMES.has(parsed.protocol)) return false;
    return !LOOPBACK_HOSTS.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Keeps application renderers local-only. Links intentionally opened with
 * shell.openExternal are handled by the user's browser and never enter this session.
 */
export function installPrivacyGuard(electronSession: Session): void {
  electronSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: isRemoteNetworkUrl(details.url) });
  });

  electronSession.on("will-download", (event, item) => {
    event.preventDefault();
    item.cancel();
  });

  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}
