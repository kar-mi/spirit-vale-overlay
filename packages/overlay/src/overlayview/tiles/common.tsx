import { useTranslator } from "@svoverlay/i18n/browser";
import { classIconUrlForArchetype, classIconUrlForName } from "@svoverlay/ui-kit/class-display";

import { chromeState } from "../store.ts";

export function WaitingForDps({ label }: { label?: string } = {}) {
  const t = useTranslator();
  const toggleLockShortcut = chromeState.value?.shortcuts.toggleLock;
  return (
    <div class="empty">
      <span>{label ?? t("overlay.waitingForDps")}</span>
      <span class="empty-help">{toggleLockShortcut
        ? t("overlay.waitingHelp.shortcut", { shortcut: toggleLockShortcut })
        : t("overlay.waitingHelp")}</span>
    </div>
  );
}

export function overlayClassIcon(archetype: number | undefined): string {
  return classIconUrlForArchetype(archetype) ?? classIconUrlForName("Weaver")!;
}
