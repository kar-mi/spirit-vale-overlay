interface ExtensionBootstrap {
  nlPort: number;
  nlToken: string;
  nlConnectToken: string;
  nlExtensionId: string;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class NeutralinoClient {
  private readonly pending = new Map<string, PendingCall>();
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly closeListeners = new Set<() => void>();
  private nextId = 0;

  private constructor(
    private readonly socket: WebSocket,
    private readonly accessToken: string,
  ) {}

  static async connect(bootstrap: ExtensionBootstrap): Promise<NeutralinoClient> {
    const url = `ws://127.0.0.1:${bootstrap.nlPort}?extensionId=${encodeURIComponent(bootstrap.nlExtensionId)}&connectToken=${encodeURIComponent(bootstrap.nlConnectToken)}`;
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect the Neutralino extension socket.")), { once: true });
    });
    const client = new NeutralinoClient(socket, bootstrap.nlToken);
    socket.addEventListener("message", (event) => client.receive(String(event.data)));
    socket.addEventListener("close", () => {
      client.failPending("Neutralino extension socket closed.");
      for (const listener of client.closeListeners) listener();
    });
    return client;
  }

  static async fromStdin(): Promise<NeutralinoClient> {
    const raw = (await Bun.stdin.text()).trim();
    if (!raw) throw new Error("Neutralino did not provide extension bootstrap data on stdin.");
    return NeutralinoClient.connect(JSON.parse(raw) as ExtensionBootstrap);
  }

  call<T = unknown>(method: string, data: Record<string, unknown> = {}): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Neutralino extension socket is not open."));
    const id = `desktop-${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, accessToken: this.accessToken, data }));
    });
  }

  on(event: string, listener: (data: unknown) => void): () => void {
    const entries = this.listeners.get(event) ?? new Set();
    entries.add(listener);
    this.listeners.set(event, entries);
    return () => entries.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.socket.close();
  }

  private receive(raw: string): void {
    let packet: Record<string, unknown>;
    try { packet = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (typeof packet.id === "string" && this.pending.has(packet.id)) {
      const pending = this.pending.get(packet.id)!;
      this.pending.delete(packet.id);
      const envelope = packet.data as { success?: boolean; returnValue?: unknown; error?: unknown } | undefined;
      if (envelope?.success === false) pending.reject(new Error(String(envelope.error ?? "Neutralino native call failed.")));
      else pending.resolve(envelope && "returnValue" in envelope ? envelope.returnValue : packet.data);
      return;
    }
    const event = typeof packet.event === "string" ? packet.event : typeof packet.name === "string" ? packet.name : undefined;
    if (!event) return;
    const data = packet.data && typeof packet.data === "object" && "data" in packet.data
      ? (packet.data as { data: unknown }).data
      : packet.data;
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }

  private failPending(message: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }
}
