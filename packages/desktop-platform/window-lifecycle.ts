import DesktopRuntime from "@svoverlay/desktop-runtime";
import type { BrowserView, BrowserWindow } from "@svoverlay/desktop-runtime";
import type { Dispose } from "./disposable-store.ts";

export { DisposableStore, type Dispose } from "./disposable-store.ts";
type EventHandler<T> = (event: T) => void;

export function onWindowEvent<T>(window: BrowserWindow, name: string, handler: EventHandler<T>): Dispose {
  return onDesktopEvent(`${name}-${window.id}`, handler);
}

export function onceWindowEvent<T>(window: BrowserWindow, name: string, handler: EventHandler<T>): Dispose {
  return onceDesktopEvent(`${name}-${window.id}`, handler);
}

export function onWebviewEvent<T>(view: BrowserView, name: string, handler: EventHandler<T>): Dispose {
  return onDesktopEvent(`${name}-${view.id}`, handler);
}

function onDesktopEvent<T>(name: string, handler: EventHandler<T>): Dispose {
  const callback = handler as (...args: unknown[]) => void;
  DesktopRuntime.events.on(name, callback);
  return once(() => DesktopRuntime.events.off(name, callback));
}

function onceDesktopEvent<T>(name: string, handler: EventHandler<T>): Dispose {
  const callback = handler as (...args: unknown[]) => void;
  DesktopRuntime.events.once(name, callback);
  return once(() => DesktopRuntime.events.off(name, callback));
}

function once(dispose: Dispose): Dispose {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    dispose();
  };
}
