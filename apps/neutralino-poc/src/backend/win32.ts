import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";
import { hideWindowFromTaskbar, setWindowClickThrough } from "@svoverlay/desktop-platform/win32";

export interface NativeDisplay {
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

export function getDisplays(): NativeDisplay[] {
  if (process.platform !== "win32") return [fallbackDisplay()];
  try {
    const user32 = dlopen("user32", {
      EnumDisplayMonitors: { args: [FFIType.ptr, FFIType.ptr, FFIType.function, FFIType.i64_fast], returns: FFIType.bool },
      GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    });
    const displays: NativeDisplay[] = [];
    const callback = new JSCallback((monitor: Pointer) => {
      const info = new Int32Array(10);
      info[0] = info.byteLength;
      if (!user32.symbols.GetMonitorInfoW(monitor, ptr(info))) return true;
      displays.push({
        bounds: rect(info[1]!, info[2]!, info[3]!, info[4]!),
        workArea: rect(info[5]!, info[6]!, info[7]!, info[8]!),
        scaleFactor: 1,
        isPrimary: (info[9]! & 1) !== 0,
      });
      return true;
    }, { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64_fast], returns: FFIType.bool });
    try { user32.symbols.EnumDisplayMonitors(null, null, callback.ptr, 0); } finally { callback.close(); }
    return displays.length ? displays : [fallbackDisplay()];
  } catch (error) {
    console.warn("[neutralino-poc] could not enumerate displays:", error);
    return [fallbackDisplay()];
  }
}

export async function configureOverlayWindow(pid: number, clickThrough: boolean): Promise<boolean> {
  let stableChecks = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const handle = findWindow(pid);
    if (handle) {
      hideWindowFromTaskbar(handle);
      const applied = setWindowClickThrough(handle, clickThrough);
      stableChecks = applied && overlayWindowStylesReady(handle, clickThrough) ? stableChecks + 1 : 0;
      // Neutralino applies its own final styles shortly after creating the HWND.
      // Require several consecutive checks so we do not report a transient success.
      if (stableChecks >= 4) return true;
    }
    await Bun.sleep(50);
  }
  return false;
}

export function setOverlayWindowVisible(
  pid: number,
  visible: boolean,
  bounds?: { x: number; y: number; width: number; height: number },
): boolean {
  if (process.platform !== "win32") return false;
  const handle = findWindow(pid);
  if (!handle) return false;
  try {
    const user32 = dlopen("user32", {
      ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
      IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.bool },
      GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
      SetWindowPos: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
        returns: FFIType.bool,
      },
    });
    const SW_HIDE = 0;
    const SW_SHOWNOACTIVATE = 4;
    if (visible && bounds) {
      const SWP_NOZORDER = 0x4;
      const SWP_NOACTIVATE = 0x10;
      const SWP_SHOWWINDOW = 0x40;
      user32.symbols.SetWindowPos(
        handle,
        null,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
      );
    } else {
      user32.symbols.ShowWindow(handle, visible ? SW_SHOWNOACTIVATE : SW_HIDE);
    }
    if (Boolean(user32.symbols.IsWindowVisible(handle)) !== visible) return false;
    if (visible && bounds) {
      const rect = new Int32Array(4);
      if (!user32.symbols.GetWindowRect(handle, ptr(rect))) return false;
      return rect[0] === bounds.x && rect[1] === bounds.y
        && rect[2]! - rect[0]! === bounds.width && rect[3]! - rect[1]! === bounds.height;
    }
    return true;
  } catch {
    return false;
  }
}

function overlayWindowStylesReady(handle: Pointer, clickThrough: boolean): boolean {
  try {
    const user32 = dlopen("user32", {
      GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
    });
    const GWL_EXSTYLE = -20;
    return overlayExtendedStylesReady(Number(user32.symbols.GetWindowLongPtrW(handle, GWL_EXSTYLE)), clickThrough);
  } catch {
    return false;
  }
}

export function overlayExtendedStylesReady(styles: number, clickThrough: boolean): boolean {
  const WS_EX_TRANSPARENT = 0x00000020;
  const WS_EX_TOOLWINDOW = 0x00000080;
  const WS_EX_APPWINDOW = 0x00040000;
  const WS_EX_LAYERED = 0x00080000;
  const WS_EX_NOACTIVATE = 0x08000000;
  const taskbarReady = (styles & WS_EX_TOOLWINDOW) !== 0 && (styles & WS_EX_APPWINDOW) === 0;
  const passThroughReady = clickThrough
    ? (styles & (WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE)) === (WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE)
    : (styles & (WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)) === 0;
  return taskbarReady && passThroughReady;
}

function findWindow(targetPid: number): Pointer | undefined {
  const user32 = dlopen("user32", {
    EnumWindows: { args: [FFIType.function, FFIType.i64_fast], returns: FFIType.bool },
    GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    GetWindowTextLengthW: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  let found: Pointer | undefined;
  const callback = new JSCallback((handle: Pointer) => {
    const pid = new Uint32Array(1);
    user32.symbols.GetWindowThreadProcessId(handle, ptr(pid));
    if (pid[0] !== targetPid) return true;
    // Neutralino can own hidden helper handles before its actual titled webview window exists.
    if (user32.symbols.GetWindowTextLengthW(handle) <= 0) return true;
    found = handle;
    return false;
  }, { args: [FFIType.ptr, FFIType.i64_fast], returns: FFIType.bool });
  try { user32.symbols.EnumWindows(callback.ptr!, 0); } finally { callback.close(); }
  return found;
}

function rect(left: number, top: number, right: number, bottom: number) {
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function fallbackDisplay(): NativeDisplay {
  return {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    isPrimary: true,
  };
}
