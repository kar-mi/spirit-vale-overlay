export type RPCSchema<Schema extends {
  requests?: object;
  messages?: object;
} = object> = {
  requests: Schema extends { requests: infer Requests } ? Requests : Record<string, never>;
  messages: Schema extends { messages: infer Messages } ? Messages : Record<string, never>;
};

export interface DesktopRPCSchema {
  bun: { requests: object; messages: object };
  webview: { requests: object; messages: object };
}
