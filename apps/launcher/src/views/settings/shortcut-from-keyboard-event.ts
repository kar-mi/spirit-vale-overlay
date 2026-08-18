type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

/** Convert a renderer key event into the canonical shortcut format stored in overlay settings. */
export function shortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return undefined;

  // `key` is the produced character, so Shift+1 is "!" on a US layout and something else on
  // other layouts. `code` identifies the physical top-row digit independently of modifiers.
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (/^Numpad[0-9]$/.test(event.code)) return undefined;

  const special: Record<string, string> = {
    " ": "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
  };
  const key = digit
    ?? (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(event.key) ? event.key.toUpperCase() : undefined)
    ?? (/^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : undefined)
    ?? special[event.key];
  if (!key) return undefined;
  return [
    ...(event.ctrlKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    key,
  ].join("+");
}
