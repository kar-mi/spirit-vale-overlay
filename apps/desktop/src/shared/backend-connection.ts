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
  const params = new URLSearchParams(search);
  const payload = params.get(CONNECTION_PARAMETER);
  if (payload) {
    try {
      const base64 = payload.replaceAll("-", "+").replaceAll("_", "/")
        .padEnd(Math.ceil(payload.length / 4) * 4, "=");
      const connection = JSON.parse(atob(base64)) as Partial<BackendReady>;
      const valid = validConnection(connection.port, connection.ticket);
      if (valid) return valid;
    } catch (err) {
      console.error("Error: ", err);
      // Fall through to legacy parameters for an already-open development window.
    }
  }

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
