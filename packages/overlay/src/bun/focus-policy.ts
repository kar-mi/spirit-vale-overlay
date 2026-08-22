import type { ForegroundProcess } from "@svoverlay/desktop-platform/win32";

export type ForegroundKind = "game" | "app" | "other" | "unknown";

export interface FocusVisibilityState {
  visible: boolean;
  manualHideEngaged: boolean;
  autoHidden: boolean;
}

const GAME_PROCESS_NAME = "spiritvale.exe";

export function classifyForegroundProcess(
  foreground: ForegroundProcess | undefined,
  ownPid: number,
): ForegroundKind {
  if (!foreground) return "unknown";
  if (foreground.pid === ownPid) return "app";
  if (!foreground.exeName) return "unknown";
  return foreground.exeName.toLowerCase() === GAME_PROCESS_NAME ? "game" : "other";
}

export function visibilityForForeground(kind: ForegroundKind): boolean | undefined {
  if (kind === "unknown") return undefined;
  return kind === "game" || kind === "app";
}

export function permitsGameKeybind(kind: ForegroundKind): boolean {
  return kind === "game";
}

export function manuallySetVisibility(visible: boolean): FocusVisibilityState {
  return { visible, manualHideEngaged: !visible, autoHidden: false };
}

export function reconcileAutoHide(
  state: FocusVisibilityState,
  enabled: boolean,
  foreground: ForegroundKind,
): FocusVisibilityState {
  if (!enabled) {
    return state.autoHidden && !state.manualHideEngaged
      ? { visible: true, manualHideEngaged: false, autoHidden: false }
      : state;
  }
  if (state.manualHideEngaged) return state;
  const visible = visibilityForForeground(foreground);
  if (visible === undefined) return state;
  return { visible, manualHideEngaged: false, autoHidden: !visible };
}
