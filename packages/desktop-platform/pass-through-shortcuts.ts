/**
 * Windows-wide shortcut observation that deliberately leaves the original key
 * event alone. Unlike RegisterHotKey (and Electrobun's GlobalShortcut), a low
 * level hook can call an app callback and then pass the event on to the next
 * hook/foreground window.
 */
import { dlopen, FFIType, JSCallback, read, type Pointer } from "bun:ffi";

export interface ShortcutBinding<Action extends string> {
  action: Action;
  shortcut: string;
}

export interface PassThroughShortcutListener<Action extends string> {
  setBindings(bindings: readonly ShortcutBinding<Action>[]): void;
  close(): void;
}

type ModifierName = "ctrl" | "alt" | "shift" | "meta";

interface ParsedShortcut {
  keyCode: number;
  modifiers: ReadonlySet<ModifierName>;
}

const KEY_CODES: Record<string, number> = {
  SPACE: 0x20,
  ENTER: 0x0d,
  TAB: 0x09,
  BACKSPACE: 0x08,
  DELETE: 0x2e,
  HOME: 0x24,
  END: 0x23,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  ARROWUP: 0x26,
  ARROWDOWN: 0x28,
  ARROWLEFT: 0x25,
  ARROWRIGHT: 0x27,
  ESCAPE: 0x1b,
};

for (let code = 0; code <= 9; code += 1) KEY_CODES[String(code)] = 0x30 + code;
for (let code = 0; code < 26; code += 1) KEY_CODES[String.fromCharCode(65 + code)] = 0x41 + code;
for (let code = 1; code <= 24; code += 1) KEY_CODES[`F${code}`] = 0x6f + code;

const MODIFIER_CODES: Readonly<Record<number, ModifierName>> = {
  0x10: "shift", 0xa0: "shift", 0xa1: "shift",
  0x11: "ctrl", 0xa2: "ctrl", 0xa3: "ctrl",
  0x12: "alt", 0xa4: "alt", 0xa5: "alt",
  0x5b: "meta", 0x5c: "meta",
};

/** Pure matcher, kept separate from Win32 FFI so key semantics stay unit-testable. */
export class ShortcutMatcher<Action extends string> {
  #bindings: Array<{ action: Action; shortcut: ParsedShortcut }> = [];
  #pressed = new Set<number>();

  setBindings(bindings: readonly ShortcutBinding<Action>[]): void {
    this.#bindings = bindings.flatMap(({ action, shortcut }) => {
      const parsed = parseShortcut(shortcut);
      return parsed ? [{ action, shortcut: parsed }] : [];
    });
    // A binding update can occur while a key is down. Forget the old state so
    // the next physical key-down is never incorrectly treated as a repeat.
    this.#pressed.clear();
  }

  /** Returns the one configured action matching this initial key-down. */
  handleKey(keyCode: number, down: boolean): Action | undefined {
    if (!down) {
      this.#pressed.delete(keyCode);
      return undefined;
    }
    if (this.#pressed.has(keyCode)) return undefined;
    this.#pressed.add(keyCode);
    if (MODIFIER_CODES[keyCode]) return undefined;

    const modifiers = activeModifiers(this.#pressed);
    return this.#bindings.find(({ shortcut }) => shortcut.keyCode === keyCode
      && modifiersMatch(shortcut.modifiers, modifiers))?.action;
  }
}

/**
 * Installs a WH_KEYBOARD_LL observer. Its callback always calls
 * CallNextHookEx, so matched keys are never withheld from the foreground app.
 */
export function createPassThroughShortcutListener<Action extends string>(
  bindings: readonly ShortcutBinding<Action>[],
  onShortcut: (action: Action) => void,
): PassThroughShortcutListener<Action> {
  if (process.platform !== "win32") throw new Error("Pass-through shortcuts are supported on Windows only.");

  const matcher = new ShortcutMatcher<Action>();
  matcher.setBindings(bindings);
  const user32 = dlopen("user32", {
    SetWindowsHookExW: { args: [FFIType.i32, FFIType.function, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
    CallNextHookEx: { args: [FFIType.ptr, FFIType.i32, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
    UnhookWindowsHookEx: { args: [FFIType.ptr], returns: FFIType.bool },
  });
  let hook: Pointer | null = null;
  let closed = false;
  const callback = new JSCallback((code: number, message: number | bigint, details: Pointer) => {
    // nCode < 0 must be passed through without inspecting the event.
    if (code >= 0) {
      const messageCode = Number(message);
      const down = messageCode === 0x0100 || messageCode === 0x0104; // WM_(SYS)KEYDOWN
      const up = messageCode === 0x0101 || messageCode === 0x0105; // WM_(SYS)KEYUP
      if (down || up) {
        const action = matcher.handleKey(read.u32(details), down);
        if (action !== undefined) onShortcut(action);
      }
    }
    return user32.symbols.CallNextHookEx(hook, code, message, details);
  }, { args: [FFIType.i32, FFIType.u64, FFIType.ptr], returns: FFIType.i64 });

  hook = user32.symbols.SetWindowsHookExW(13 /* WH_KEYBOARD_LL */, callback, null, 0);
  if (!hook) {
    callback.close();
    user32.close();
    throw new Error("Windows could not start the pass-through keyboard listener.");
  }

  return {
    setBindings(next): void {
      if (!closed) matcher.setBindings(next);
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (hook) user32.symbols.UnhookWindowsHookEx(hook);
      hook = null;
      callback.close();
      user32.close();
    },
  };
}

function parseShortcut(value: string): ParsedShortcut | undefined {
  const tokens = value.split("+").map((token) => token.trim()).filter(Boolean);
  const key = tokens.at(-1)?.toUpperCase();
  const keyCode = key ? KEY_CODES[key] : undefined;
  if (keyCode === undefined) return undefined;
  const modifiers = new Set<ModifierName>();
  for (const token of tokens.slice(0, -1)) {
    const modifier = token.toLowerCase() as ModifierName;
    if (!(modifier in { ctrl: true, alt: true, shift: true, meta: true })) return undefined;
    modifiers.add(modifier);
  }
  return { keyCode, modifiers };
}

function activeModifiers(pressed: ReadonlySet<number>): ReadonlySet<ModifierName> {
  const modifiers = new Set<ModifierName>();
  for (const keyCode of pressed) {
    const modifier = MODIFIER_CODES[keyCode];
    if (modifier) modifiers.add(modifier);
  }
  return modifiers;
}

function modifiersMatch(expected: ReadonlySet<ModifierName>, actual: ReadonlySet<ModifierName>): boolean {
  return expected.size === actual.size && [...expected].every((modifier) => actual.has(modifier));
}
