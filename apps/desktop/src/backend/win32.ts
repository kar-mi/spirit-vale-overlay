import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";
import { hideWindowFromTaskbar, setWindowClickThrough } from "@svoverlay/desktop-platform/win32";

export interface NativeDisplay {
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  /** Physical-pixel bounds, retained internally for migrating legacy layouts. */
  nativeBounds?: { x: number; y: number; width: number; height: number };
  nativeWorkArea?: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

export function getDisplays(): NativeDisplay[] {
  if (process.platform !== "win32") return [fallbackDisplay()];
  try {
    const user32 = dlopen("user32", {
      EnumDisplayMonitors: { args: [FFIType.ptr, FFIType.ptr, FFIType.function, FFIType.i64_fast], returns: FFIType.bool },
      GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
      SetThreadDpiAwarenessContext: { args: [FFIType.i64_fast], returns: FFIType.i64_fast },
    });
    const enumerate = () => {
      const result: Array<{ bounds: ReturnType<typeof rect>; workArea: ReturnType<typeof rect>; isPrimary: boolean }> = [];
      const callback = new JSCallback((monitor: Pointer) => {
        const info = new Int32Array(10);
        info[0] = info.byteLength;
        if (!user32.symbols.GetMonitorInfoW(monitor, ptr(info))) return true;
        result.push({
          bounds: rect(info[1]!, info[2]!, info[3]!, info[4]!),
          workArea: rect(info[5]!, info[6]!, info[7]!, info[8]!),
          isPrimary: (info[9]! & 1) !== 0,
        });
        return true;
      }, { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64_fast], returns: FFIType.bool });
      try { user32.symbols.EnumDisplayMonitors(null, null, callback.ptr, 0); } finally { callback.close(); }
      return result;
    };
    // DPI_AWARENESS_CONTEXT_UNAWARE gives the canonical DIP desktop. PMv2 gives
    // the corresponding physical rectangles needed only at the native boundary.
    const previous = user32.symbols.SetThreadDpiAwarenessContext(-1);
    let logical: ReturnType<typeof enumerate>;
    let native: ReturnType<typeof enumerate>;
    try {
      logical = enumerate();
      user32.symbols.SetThreadDpiAwarenessContext(-4);
      native = enumerate();
    } finally {
      user32.symbols.SetThreadDpiAwarenessContext(previous);
    }
    const displays = logical.map((display, index) => {
      const physical = native[index] ?? display;
      const scaleFactor = display.bounds.width > 0 ? physical.bounds.width / display.bounds.width : 1;
      return { ...display, nativeBounds: physical.bounds, nativeWorkArea: physical.workArea, scaleFactor };
    });
    return displays.length ? displays : [fallbackDisplay()];
  } catch (error) {
    console.warn("[neutralino] could not enumerate displays:", error);
    return [fallbackDisplay()];
  }
}

export function applyOverlayWindowStyles(handle: Pointer, clickThrough: boolean): boolean {
  hideWindowFromTaskbar(handle);
  const applied = setWindowClickThrough(handle, clickThrough);
  return applied && overlayWindowStylesReady(handle, clickThrough);
}

export function setOverlayWindowVisible(
  handle: Pointer,
  visible: boolean,
): boolean {
  if (process.platform !== "win32") return false;
  try {
    const user32 = dlopen("user32", {
      ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
      IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.bool },
    });
    const SW_HIDE = 0;
    const SW_SHOWNOACTIVATE = 4;
    user32.symbols.ShowWindow(handle, visible ? SW_SHOWNOACTIVATE : SW_HIDE);
    return Boolean(user32.symbols.IsWindowVisible(handle)) === visible;
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

export interface ProcessEntry {
  parentProcessId: number;
  exeFile: string;
}

export function findProcessEntry(pid: number): ProcessEntry | undefined {
  if (process.platform !== "win32") return undefined;
  const kernel32 = dlopen("kernel32", {
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.ptr },
    Process32FirstW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    Process32NextW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
  });
  const TH32CS_SNAPPROCESS = 0x2;
  const snapshot = kernel32.symbols.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snapshot) return undefined;
  try {
    // PROCESSENTRY32W is a fixed-size 568-byte struct on x64: th32ProcessID sits at
    // offset 8, th32ParentProcessID at offset 32, and the null-terminated wide-char
    // szExeFile[260] image name starts at offset 44.
    const entry = new Uint8Array(568);
    const view = new DataView(entry.buffer);
    view.setUint32(0, entry.length, true);
    let ok = kernel32.symbols.Process32FirstW(snapshot, ptr(entry));
    while (ok) {
      if (view.getUint32(8, true) === pid) {
        return { parentProcessId: view.getUint32(32, true), exeFile: readWideString(entry, 44) };
      }
      view.setUint32(0, entry.length, true);
      ok = kernel32.symbols.Process32NextW(snapshot, ptr(entry));
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    kernel32.symbols.CloseHandle(snapshot);
  }
}

function readWideString(bytes: Uint8Array, offset: number): string {
  const units: number[] = [];
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    const unit = bytes[i]! | (bytes[i + 1]! << 8);
    if (unit === 0) break;
    units.push(unit);
  }
  return String.fromCharCode(...units);
}

export function findWindowHandle(targetPid: number): Pointer | undefined {
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
