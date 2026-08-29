import { existsSync } from "node:fs";
import path from "node:path";
import { getCurrentExecutableNames } from "./executable-names.ts";

export interface ShortcutBinding<Action extends string> {
  action: Action;
  shortcut: string;
}

export interface PassThroughShortcutListener<Action extends string> {
  /** Returns false when the optional helper executable is unavailable. */
  setBindings(bindings: ReadonlyArray<ShortcutBinding<Action>>): boolean;
  close(): void;
}

export function createPassThroughShortcutListener<Action extends string>(
  bindings: readonly ShortcutBinding<Action>[],
  onShortcut: (action: Action) => void,
  onWarning: (warning: string) => void = () => {},
): PassThroughShortcutListener<Action> {
  if (process.platform !== "win32") throw new Error("Pass-through shortcuts are supported on Windows only.");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let closed = false;

  const start = (next: ReadonlyArray<ShortcutBinding<Action>>): boolean => {
    const previous = child;
    child = undefined;
    previous?.kill();
    if (next.length === 0) {
      return true;
    }
    const executable = helperPath();
    if (!executable) {
      onWarning(`Optional pass-through hotkeys are unavailable because ${getCurrentExecutableNames().hotkeyHelper} is missing.`);
      return false;
    }
    const arguments_ = next.flatMap(({ action, shortcut }) => ["--binding", action, shortcut]);
    const current = Bun.spawn([executable, ...arguments_], { stdout: "pipe", stderr: "ignore", windowsHide: true });
    child = current;
    const actions = new Set(next.map(({ action }) => action));
    void monitorChild(
      current,
      actions,
      onShortcut,
      onWarning,
      () => !closed && child === current,
      () => { if (child === current) child = undefined; },
    );
    return true;
  };

  start(bindings);
  return {
    setBindings(next): boolean {
      return !closed && start(next);
    },
    close(): void {
      if (closed) return;
      closed = true;
      child?.kill();
      child = undefined;
    },
  };
}

async function monitorChild<Action extends string>(
  child: ReturnType<typeof Bun.spawn>,
  actions: ReadonlySet<Action>,
  onShortcut: (action: Action) => void,
  onWarning: (warning: string) => void,
  isCurrent: () => boolean,
  retire: () => void,
): Promise<void> {
  try {
    await readActions(child.stdout as ReadableStream<Uint8Array>, actions, onShortcut, isCurrent);
    const exitCode = await child.exited;
    if (!isCurrent()) return;
    retire();
    onWarning(`Pass-through shortcut helper exited unexpectedly with code ${exitCode}.`);
  } catch (error) {
    if (!isCurrent()) return;
    child.kill();
    retire();
    onWarning(error instanceof Error ? error.message : String(error));
  }
}

function helperPath(): string | undefined {
  const executable = process.env.SPIRIT_VALE_HOTKEY_HELPER?.trim()
    || path.join(path.dirname(process.execPath), getCurrentExecutableNames().hotkeyHelper);
  return existsSync(executable) ? executable : undefined;
}

async function readActions<Action extends string>(
  stream: ReadableStream<Uint8Array>,
  actions: ReadonlySet<Action>,
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
      for (const line of lines) {
        if (isCurrent() && actions.has(line as Action)) onShortcut(line as Action);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
