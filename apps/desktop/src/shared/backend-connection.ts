import type { BackendReady } from "./protocol.ts";

const CONNECTION_PARAMETER = "desktopBackend";

export function backendConnectionUrl(path: string, connection: BackendReady): string {
  const payload = btoa(JSON.stringify(connection))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${path}?${CONNECTION_PARAMETER}=${payload}`;
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

function decodePayload(search: string): Partial<BackendReady> | undefined {
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
