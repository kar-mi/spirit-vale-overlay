import { existsSync } from "node:fs";
import path from "node:path";

export interface ShortcutBinding<Action extends string> {
  action: Action;
  shortcut: string;
}

export interface PassThroughShortcutListener<Action extends string> {
  setBindings(bindings: ReadonlyArray<ShortcutBinding<Action>>): void;
  close(): void;
}

/**
 * Owns the native helper rather than a JavaScript keyboard hook. The helper's
 * hook procedure immediately calls CallNextHookEx; matching actions arrive
 * asynchronously over stdout after the foreground app has received the key.
 */
export function createPassThroughShortcutListener<Action extends string>(
  bindings: readonly ShortcutBinding<Action>[],
  onShortcut: (action: Action) => void,
): PassThroughShortcutListener<Action> {
  if (process.platform !== "win32") throw new Error("Pass-through shortcuts are supported on Windows only.");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let closed = false;

  const start = (next: ReadonlyArray<ShortcutBinding<Action>>): void => {
    child?.kill();
    if (next.length === 0) {
      child = undefined;
      return;
    }
    const executable = helperPath();
    const arguments_ = next.flatMap(({ action, shortcut }) => ["--binding", action, shortcut]);
    const current = Bun.spawn([executable, ...arguments_], { stdout: "pipe", stderr: "pipe", windowsHide: true });
    child = current;
    void readActions(current.stdout as ReadableStream<Uint8Array>, onShortcut, () => !closed && child === current && current.exitCode === null);
  };

  start(bindings);
  return {
    setBindings(next): void {
      if (!closed) start(next);
    },
    close(): void {
      if (closed) return;
      closed = true;
      child?.kill();
      child = undefined;
    },
  };
}

function helperPath(): string {
  const executable = process.env.SPIRIT_VALE_HOTKEY_HELPER?.trim()
    || path.join(path.dirname(process.execPath), "sv-overlay-hotkeys.exe");
  if (!existsSync(executable)) throw new Error(`Pass-through shortcut helper is missing: ${executable}`);
  return executable;
}

async function readActions<Action extends string>(
  stream: ReadableStream<Uint8Array>,
  onShortcut: (action: Action) => void,
  isCurrent: () => boolean,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line && isCurrent()) onShortcut(line as Action);
    }
  } finally {
    reader.releaseLock();
  }
}
