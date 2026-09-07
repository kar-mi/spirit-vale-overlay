import type { Session } from "electron";

const REMOTE_NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

export function isRemoteNetworkUrl(url: string): boolean {
  try {
    return REMOTE_NETWORK_SCHEMES.has(new URL(url).protocol);
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
