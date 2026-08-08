import Electrobun from "electrobun/bun";
import type { BrowserView, BrowserWindow } from "electrobun/bun";
import type { Dispose } from "./disposable-store.ts";

export { DisposableStore, type Dispose } from "./disposable-store.ts";
type EventHandler<T> = (event: T) => void;

export function onWindowEvent<T>(window: BrowserWindow, name: string, handler: EventHandler<T>): Dispose {
  return onElectrobunEvent(`${name}-${window.id}`, handler);
}

export function onceWindowEvent<T>(window: BrowserWindow, name: string, handler: EventHandler<T>): Dispose {
  return onceElectrobunEvent(`${name}-${window.id}`, handler);
}

export function onWebviewEvent<T>(view: BrowserView, name: string, handler: EventHandler<T>): Dispose {
  return onElectrobunEvent(`${name}-${view.id}`, handler);
}

function onElectrobunEvent<T>(name: string, handler: EventHandler<T>): Dispose {
  const callback = handler as (...args: unknown[]) => void;
  Electrobun.events.on(name, callback);
  return once(() => Electrobun.events.off(name, callback));
}

function onceElectrobunEvent<T>(name: string, handler: EventHandler<T>): Dispose {
  const callback = handler as (...args: unknown[]) => void;
  Electrobun.events.once(name, callback);
  return once(() => Electrobun.events.off(name, callback));
}

function once(dispose: Dispose): Dispose {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    dispose();
  };
}
