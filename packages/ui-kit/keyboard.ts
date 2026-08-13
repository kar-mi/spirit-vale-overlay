import type { JSX } from "preact";

export function activateOnEnterOrSpace(
  event: JSX.TargetedKeyboardEvent<HTMLElement>,
  activate: () => void,
): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}
