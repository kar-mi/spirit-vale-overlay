/* Bun-process helpers for the custom frameless windows (Windows only).
   Ported from the proven setup in ffxiv_gear_setup/src/desktop/index.ts. */

import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";

/** Encodes a JS string as a null-terminated UTF-16LE buffer for Win32 "W" APIs. */
function toWideString(value: string): Uint16Array {
  const buffer = new Uint16Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) buffer[index] = value.charCodeAt(index);
  buffer[value.length] = 0;
  return buffer;
}

/**
 * Enable per-monitor DPI awareness before any window is created.
 * bun.exe ships without a DPI-aware manifest, so without this call Windows
 * renders the WebView at 96 DPI and then upscales the result — causing blur.
 *
 * Prefers Per-Monitor-V2 awareness (user32's SetProcessDpiAwarenessContext),
 * which is what WebView2 expects. The older Per-Monitor v1 API (shcore's
 * SetProcessDpiAwareness) does not fully suppress DPI virtualization for
 * WebView2 content on scaled displays, leaving a faint render-then-upscale
 * blur even though "DPI awareness" is technically on.
 */
export function makeProcessDpiAware(): void {
  if (process.platform !== "win32") return;
  try {
    const user32 = dlopen("user32", {
      SetProcessDpiAwarenessContext: { args: [FFIType.i64_fast], returns: FFIType.bool },
    });
    const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4n;
    const ok = user32.symbols.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if (ok) return;
  } catch (error) {
    console.warn("[ui-core] could not set per-monitor-v2 DPI awareness, falling back:", error);
  }
  try {
    const shcore = dlopen("shcore", {
      SetProcessDpiAwareness: { args: [FFIType.i32], returns: FFIType.i32 },
    });
    const PROCESS_PER_MONITOR_DPI_AWARE = 2;
    // E_ACCESSDENIED means awareness was already set — not an error.
    shcore.symbols.SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
  } catch (error) {
    console.warn("[ui-core] could not set DPI awareness:", error);
  }
}

/**
 * Ask DWM for rounded window corners. Best-effort: Windows may ignore the
 * hint for frameless windows, in which case the window stays square. Do not
 * round the inner shell in CSS — a rounded shell over a square native window
 * produces a double-corner artifact.
 */
export function applyRoundedCorners(windowPtr: unknown): void {
  if (process.platform !== "win32") return;
  const handle = windowPtr as Pointer | null | undefined;
  if (!handle) return;
  try {
    const dwmapi = dlopen("dwmapi", {
      DwmSetWindowAttribute: {
        args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
        returns: FFIType.i32,
      },
    });
    const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    const DWMWCP_ROUND = 2;
    const preference = new Uint32Array([DWMWCP_ROUND]);
    dwmapi.symbols.DwmSetWindowAttribute(
      handle,
      DWMWA_WINDOW_CORNER_PREFERENCE,
      ptr(preference),
      preference.byteLength,
    );
  } catch (error) {
    console.warn("[ui-core] could not request rounded corners:", error);
  }
}

/**
 * Removes a utility overlay from the Windows taskbar and Alt+Tab switcher.
 * Settings and other interactive windows should keep their normal app-window
 * style so they remain easy to find and manage.
 */
export function hideWindowFromTaskbar(windowPtr: unknown): boolean {
  if (process.platform !== "win32") return false;
  const handle = windowPtr as Pointer | null | undefined;
  if (!handle) return false;
  try {
    const user32 = dlopen("user32", {
      GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
      SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
      SetWindowPos: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
        returns: FFIType.bool,
      },
    });
    const GWL_EXSTYLE = -20;
    const WS_EX_TOOLWINDOW = 0x00000080;
    const WS_EX_APPWINDOW = 0x00040000;
    const current = Number(user32.symbols.GetWindowLongPtrW(handle, GWL_EXSTYLE));
    const next = (current | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
    user32.symbols.SetWindowLongPtrW(handle, GWL_EXSTYLE, BigInt(next));
    const SWP_NOSIZE = 0x1;
    const SWP_NOMOVE = 0x2;
    const SWP_NOZORDER = 0x4;
    const SWP_NOACTIVATE = 0x10;
    const SWP_FRAMECHANGED = 0x20;
    user32.symbols.SetWindowPos(
      handle,
      null,
      0,
      0,
      0,
      0,
      SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
    );
    return true;
  } catch (error) {
    console.warn("[ui-core] could not hide overlay from the taskbar:", error);
    return false;
  }
}

/**
 * Toggle native hit testing for a transparent overlay window. Layered style is
 * retained when unlocking so WebView2 does not briefly recreate its surface.
 */
export function setWindowClickThrough(windowPtr: unknown, enabled: boolean): boolean {
  if (process.platform !== "win32") return false;
  const handle = windowPtr as Pointer | null | undefined;
  if (!handle) return false;
  try {
    const user32 = dlopen("user32", {
      IsWindow: { args: [FFIType.ptr], returns: FFIType.bool },
      GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
      SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
      SetLayeredWindowAttributes: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u8, FFIType.u32],
        returns: FFIType.bool,
      },
      SetWindowPos: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
        returns: FFIType.bool,
      },
    });
    const GWL_EXSTYLE = -20;
    const WS_EX_TRANSPARENT = 0x00000020;
    const WS_EX_LAYERED = 0x00080000;
    const WS_EX_NOACTIVATE = 0x08000000;
    // A BrowserWindow can emit its close event while a queued shortcut callback is
    // still draining. Do not pass a retired HWND to the style-changing APIs: they
    // are native calls and an invalid handle can take down the host process.
    if (!user32.symbols.IsWindow(handle)) return false;
    const current = Number(user32.symbols.GetWindowLongPtrW(handle, GWL_EXSTYLE));
    const wasLayered = (current & WS_EX_LAYERED) !== 0;
    const clickThroughStyles = WS_EX_TRANSPARENT | WS_EX_NOACTIVATE;
    const next = enabled
      ? current | clickThroughStyles | WS_EX_LAYERED
      : current & ~clickThroughStyles;
    user32.symbols.SetWindowLongPtrW(handle, GWL_EXSTYLE, BigInt(next));
    if (!wasLayered && (next & WS_EX_LAYERED) !== 0) {
      const LWA_ALPHA = 0x2;
      user32.symbols.SetLayeredWindowAttributes(handle, 0, 255, LWA_ALPHA);
    }
    const SWP_NOSIZE = 0x1;
    const SWP_NOMOVE = 0x2;
    const SWP_NOZORDER = 0x4;
    const SWP_NOACTIVATE = 0x10;
    const SWP_FRAMECHANGED = 0x20;
    user32.symbols.SetWindowPos(
      handle,
      null,
      0,
      0,
      0,
      0,
      SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
    );
    return true;
  } catch (error) {
    console.warn("[ui-core] could not change overlay hit testing:", error);
    return false;
  }
}

function openProcessImageKernel32() {
  return dlopen("kernel32", {
    OpenProcess: { args: [FFIType.u32, FFIType.bool, FFIType.u32], returns: FFIType.ptr },
    QueryFullProcessImageNameW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
  });
}

/** Resolves a process id to its executable filename (without path), or undefined when inaccessible. */
function getProcessExeName(
  kernel32: ReturnType<typeof openProcessImageKernel32>,
  pid: number,
): string | undefined {
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const processHandle = kernel32.symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!processHandle) return undefined;
  try {
    const pathBuffer = new Uint16Array(32_768);
    const lengthBuffer = new Uint32Array([pathBuffer.length]);
    const found = kernel32.symbols.QueryFullProcessImageNameW(processHandle, 0, ptr(pathBuffer), ptr(lengthBuffer));
    if (!found) return undefined;
    const fullPath = String.fromCharCode(...pathBuffer.subarray(0, lengthBuffer[0]));
    return fullPath.split(/[\\/]/).pop() || undefined;
  } finally {
    kernel32.symbols.CloseHandle(processHandle);
  }
}

function openForegroundProcessLibraries() {
  return {
    user32: dlopen("user32", {
      GetForegroundWindow: { args: [], returns: FFIType.ptr },
      GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    }),
    kernel32: openProcessImageKernel32(),
  };
}

/** These symbols back a poll loop, so resolve them only on the first foreground-process query. */
let foregroundProcessLibraries: ReturnType<typeof openForegroundProcessLibraries> | undefined;

export interface ForegroundProcess {
  pid: number;
  /** Missing when Windows identifies the process but does not allow its image path to be queried. */
  exeName?: string;
}

/** Returns the process owning the current foreground window, or undefined when it cannot be identified. */
export function getForegroundProcess(): ForegroundProcess | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    foregroundProcessLibraries ??= openForegroundProcessLibraries();
    const { user32, kernel32 } = foregroundProcessLibraries;
    const foregroundWindow = user32.symbols.GetForegroundWindow();
    if (!foregroundWindow) return undefined;

    const pidBuffer = new Uint32Array(1);
    user32.symbols.GetWindowThreadProcessId(foregroundWindow, ptr(pidBuffer));
    const pid = pidBuffer[0];
    if (!pid) return undefined;

    return { pid, exeName: getProcessExeName(kernel32, pid) };
  } catch (error) {
    console.warn("[desktop-platform] could not determine the foreground process:", error);
    return undefined;
  }
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function openWindowRectLibraries() {
  return {
    user32: dlopen("user32", {
      EnumWindows: { args: [FFIType.function, FFIType.i64_fast], returns: FFIType.bool },
      GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
      GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
      IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.bool },
    }),
    kernel32: openProcessImageKernel32(),
  };
}

let windowRectLibraries: ReturnType<typeof openWindowRectLibraries> | undefined;

/**
 * Bounds of the first visible top-level window belonging to a process, matched by executable name.
 *
 * There is no direct "find window by process name" Win32 call, so this enumerates every top-level
 * window and resolves each one's owning process image path the same way {@link getForegroundProcess}
 * does, stopping at the first visible match. Re-resolve on demand rather than polling — the minimap
 * only needs this once per toggle-open, not continuously.
 */
export function getWindowRectForProcess(exeName: string): WindowRect | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    windowRectLibraries ??= openWindowRectLibraries();
    const { user32, kernel32 } = windowRectLibraries;
    let found: WindowRect | undefined;
    const target = exeName.toLowerCase();
    const callback = new JSCallback(
      (hwnd: Pointer) => {
        if (!user32.symbols.IsWindowVisible(hwnd)) return true;
        const pidBuffer = new Uint32Array(1);
        user32.symbols.GetWindowThreadProcessId(hwnd, ptr(pidBuffer));
        const pid = pidBuffer[0];
        if (!pid) return true;
        const name = getProcessExeName(kernel32, pid)?.toLowerCase();
        if (name !== target) return true;
        const rectBuffer = new Int32Array(4);
        if (!user32.symbols.GetWindowRect(hwnd, ptr(rectBuffer))) return true;
        const [left, top, right, bottom] = rectBuffer as unknown as [number, number, number, number];
        if (right <= left || bottom <= top) return true;
        found = { x: left, y: top, width: right - left, height: bottom - top };
        return false;
      },
      { args: [FFIType.ptr, FFIType.i64_fast], returns: FFIType.bool },
    );
    try {
      if (callback.ptr) user32.symbols.EnumWindows(callback.ptr, 0n);
    } finally {
      callback.close();
    }
    return found;
  } catch (error) {
    console.warn("[desktop-platform] could not locate the game window:", error);
    return undefined;
  }
}

/**
 * Sets a window's taskbar/Alt+Tab/thumbnail-preview icon via WM_SETICON.
 * Electrobun's BrowserWindow has no icon option, so without this call every
 * window falls back to whatever default icon Windows picks.
 */
export function setWindowIcon(windowPtr: unknown, iconPath: string): void {
  if (process.platform !== "win32") return;
  const handle = windowPtr as Pointer | null | undefined;
  if (!handle) return;
  try {
    const user32 = dlopen("user32", {
      LoadImageW: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32],
        returns: FFIType.ptr,
      },
      SendMessageW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
        returns: FFIType.ptr,
      },
    });
    const IMAGE_ICON = 1;
    const LR_LOADFROMFILE = 0x00000010;
    const LR_DEFAULTSIZE = 0x00000040;
    const WM_SETICON = 0x0080;
    const ICON_SMALL = 0;
    const ICON_BIG = 1;
    const widePath = toWideString(iconPath);
    const pathPtr = ptr(widePath);
    const hIconSmall = user32.symbols.LoadImageW(null, pathPtr, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
    const hIconBig = user32.symbols.LoadImageW(null, pathPtr, IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
    if (hIconSmall) user32.symbols.SendMessageW(handle, WM_SETICON, ICON_SMALL, hIconSmall);
    if (hIconBig) user32.symbols.SendMessageW(handle, WM_SETICON, ICON_BIG, hIconBig);
  } catch (error) {
    console.warn("[ui-core] could not set window icon:", error);
  }
}
