import type { ClientPacket, RpcPacket, ServerPacket } from "../shared/protocol.ts";
import type { Transport } from "../shared/rpc.ts";
import type { ServerWebSocket } from "bun";

export interface Session {
  readonly id: string;
  readonly role: "launcher" | "window";
  readonly windowId: string;
  readonly processId?: number;
  send(packet: ServerPacket): void;
  command<T = unknown>(command: string, data?: unknown): Promise<T>;
  transport(): Transport;
}

interface Ticket { role: Session["role"]; windowId: string; expiresAt: number }
interface SocketData { session?: SessionImpl }

class SessionImpl implements Session {
  private handler?: (packet: RpcPacket) => void;
  private nextCommand = 0;
  private readonly pendingCommands = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(
    readonly id: string,
    readonly role: Session["role"],
    readonly windowId: string,
    readonly processId: number | undefined,
    private readonly socket: ServerWebSocket<SocketData>,
  ) {}

  send(packet: ServerPacket): void { this.socket.send(JSON.stringify(packet)); }
  transport(): Transport {
    return {
      send: (packet) => this.send({ kind: "rpc", packet }),
      registerHandler: (handler) => { this.handler = handler; },
    };
  }
  command<T>(command: string, data?: unknown): Promise<T> {
    const id = ++this.nextCommand;
    return new Promise<T>((resolve, reject) => {
      this.pendingCommands.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send({ kind: "window-command", id, method: command, params: data });
    });
  }
  receive(packet: ClientPacket): void {
    if (packet.kind === "rpc") this.handler?.(packet.packet);
    else if (packet.kind === "window-result") {
      const pending = this.pendingCommands.get(packet.id);
      if (!pending) return;
      this.pendingCommands.delete(packet.id);
      if (packet.error === undefined) pending.resolve(packet.result);
      else pending.reject(new Error(packet.error));
    }
  }
  close(): void {
    for (const pending of this.pendingCommands.values()) pending.reject(new Error("Window closed."));
    this.pendingCommands.clear();
  }
}

export class DesktopRpcServer {
  private readonly tickets = new Map<string, Ticket>();
  private readonly sessions = new Map<string, SessionImpl>();
  private readonly server: ReturnType<typeof Bun.serve<SocketData>>;
  onSession?: (session: Session) => void;
  onClose?: (session: Session) => void;
  onWindowEvent?: (session: Session, event: string, data: unknown) => void;

  constructor() {
    this.server = Bun.serve<SocketData>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => {
        const url = new URL(request.url);
        if (url.pathname === "/rpc" && server.upgrade(request, { data: {} })) return;
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open: () => {},
        message: (socket, raw) => {
          let packet: ClientPacket;
          try { packet = JSON.parse(String(raw)) as ClientPacket; } catch { return; }
          if (!socket.data.session) {
            if (packet.kind !== "hello") return socket.close(1008, "Authentication required");
            const ticket = this.tickets.get(packet.ticket);
            if (!ticket || ticket.expiresAt < Date.now()) return socket.close(1008, "Invalid ticket");
            this.tickets.delete(packet.ticket);
            const processId = Number.isInteger(packet.processId) && Number(packet.processId) > 0
              ? Number(packet.processId)
              : undefined;
            const session = new SessionImpl(crypto.randomUUID(), ticket.role, ticket.windowId, processId, socket);
            socket.data.session = session;
            this.sessions.set(session.id, session);
            session.send({ kind: "ready", windowId: session.id, role: session.role });
            this.onSession?.(session);
            return;
          }
          socket.data.session.receive(packet);
          if (packet.kind === "window-event") this.onWindowEvent?.(socket.data.session, packet.event, packet.data);
        },
        close: (socket) => {
          const session = socket.data.session;
          if (!session) return;
          session.close();
          this.sessions.delete(session.id);
          this.onClose?.(session);
        },
      },
    });
  }

  get port(): number { return this.server.port ?? 0; }
  issueWindow(windowId: string): string {
    const ticket = crypto.randomUUID();
    this.tickets.set(ticket, { role: windowId === "launcher" ? "launcher" : "window", windowId, expiresAt: Date.now() + 60_000 });
    return ticket;
  }
  stop(): void {
    for (const session of this.sessions.values()) void session.command("close").catch(() => {});
    this.server.stop(true);
  }
}
