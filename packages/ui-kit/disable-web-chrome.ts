let installed = false;

const BLOCKED_KEYS = new Set(["f3", "f12"]);
const BLOCKED_CTRL_KEYS = new Set(["f", "g", "p", "u", "s"]);
const BLOCKED_CTRL_SHIFT_KEYS = new Set(["i", "j", "c"]);

function isBlockedShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  if (BLOCKED_KEYS.has(key)) return true;
  if (!event.ctrlKey) return false;
  if (event.shiftKey) return BLOCKED_CTRL_SHIFT_KEYS.has(key);
  return BLOCKED_CTRL_KEYS.has(key);
}

export function disableWebChrome(): void {
  if (installed) return;
  installed = true;

  document.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("keydown", (event) => {
    if (isBlockedShortcut(event)) event.preventDefault();
  });
}
