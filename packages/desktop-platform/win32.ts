/* Bun-process helpers for the custom frameless windows (Windows only).
   Ported from the proven setup in ffxiv_gear_setup/src/desktop/index.ts. */

import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

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
