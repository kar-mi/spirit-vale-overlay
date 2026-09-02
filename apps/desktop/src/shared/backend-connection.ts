import type { BackendReady } from "./protocol.ts";

const CONNECTION_PARAMETER = "desktopBackend";

/** The locale rides inside the payload so the URL keeps its single shell-safe parameter. */
export function backendConnectionUrl(path: string, connection: BackendReady, locale?: string): string {
  const payload = btoa(JSON.stringify(locale ? { ...connection, locale } : connection))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${path}?${CONNECTION_PARAMETER}=${payload}`;
}

/** The language a child window was opened with, available before it first paints. */
export function localeFromSearch(search: string): string | undefined {
  const payload = decodePayload(search);
  return typeof payload?.locale === "string" ? payload.locale : undefined;
}

export function backendConnectionFromSearch(search: string): BackendReady | undefined {
  const payload = decodePayload(search);
  if (payload) {
    const valid = validConnection(payload.port, payload.ticket);
    if (valid) return valid;
  }

  const params = new URLSearchParams(search);
  const port = Number(params.get("backendPort"));
  const ticket = params.get("ticket");
  return validConnection(port, ticket);
}

function validConnection(port: unknown, ticket: unknown): BackendReady | undefined {
  if (!Number.isInteger(port) || Number(port) <= 0 || typeof ticket !== "string" || ticket.length === 0) {
    return undefined;
  }
  return { port: Number(port), ticket };
}

function decodePayload(search: string): (Partial<BackendReady> & { locale?: unknown }) | undefined {
  const payload = new URLSearchParams(search).get(CONNECTION_PARAMETER);
  if (!payload) return undefined;
  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(atob(base64)) as Partial<BackendReady>;
  } catch {
    // Fall through to legacy parameters for an already-open development window.
    return undefined;
  }
}
