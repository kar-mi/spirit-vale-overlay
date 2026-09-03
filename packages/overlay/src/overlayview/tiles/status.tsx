import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import { useState } from "preact/hooks";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { OverlayElementId } from "../../app-types.ts";
import { OverlayElement } from "../element-frame.tsx";
import { statusNow, statusState } from "../store.ts";

const FLASH_REMAINING_FRACTION = 0.15;
const FLASH_MINIMUM_DURATION_MS = 59_000;

export function StatusOverlayElement({
  id,
  locked,
  category,
  flashExpiring,
}: {
  id: OverlayElementId;
  locked: boolean;
  category: "buffs" | "debuffs" | "toggles";
  flashExpiring?: boolean;
}) {
  const next = statusState.value;
  const warn = category === "buffs" || category === "toggles"
    ? (next?.missingStatuses[category].length ?? 0) > 0
    : false;
  return (
    <OverlayElement id={id} locked={locked} warn={warn}>
      <StatusGridElement
        statuses={next?.[category]}
        asOfMs={next?.asOfMs}
        flashExpiring={flashExpiring}
      />
    </OverlayElement>
  );
}


function StatusGridElement(
  { statuses, asOfMs, flashExpiring }: {
    statuses: FishNetActiveStatus[] | undefined;
    asOfMs: number | undefined;
    flashExpiring?: boolean;
  },
) {
  const t = useTranslator();
  const list = statuses ?? [];
  if (list.length === 0) {
    return (
      <div class="status-grid-empty">
        <span>{t("overlay.status.none")}</span>
      </div>
    );
  }
  return (
    <div class="status-grid">
      {list.map((status) => (
        <StatusCell
          key={status.statusId}
          status={status}
          asOfMs={asOfMs}
          flashExpiring={flashExpiring}
        />
      ))}
    </div>
  );
}

function StatusCell(
  { status, asOfMs, flashExpiring }: {
    status: FishNetActiveStatus;
    asOfMs: number | undefined;
    flashExpiring?: boolean;
  },
) {
  const [iconMissing, setIconMissing] = useState(false);
  if (iconMissing) return null;
  const totalMs = status.expiresAtMs === undefined ? undefined : status.expiresAtMs - status.appliedAtMs;
  const remainingMs = status.remainingMs === undefined || asOfMs === undefined
    ? status.remainingMs
    : Math.max(0, status.remainingMs - Math.max(0, statusNow.value - asOfMs));
  const remainingFraction = totalMs !== undefined && totalMs > 0 && remainingMs !== undefined
    ? Math.max(0, Math.min(1, remainingMs / totalMs))
    : undefined;
  const expiring = flashExpiring
    && totalMs !== undefined && totalMs > FLASH_MINIMUM_DURATION_MS
    && remainingFraction !== undefined && remainingFraction <= FLASH_REMAINING_FRACTION;
  return (
    <div class={expiring ? "status-cell expiring" : "status-cell"} title={status.displayName}>
      <div
        class="status-icon-frame"
        style={remainingFraction === undefined ? undefined : `--status-remaining:${Math.round(remainingFraction * 100)}%`}
      >
        <img
          class="status-icon"
          src={statusIcon(status.spriteId)}
          alt=""
          aria-hidden="true"
          onError={() => setIconMissing(true)}
        />
        {remainingFraction !== undefined && <span class="status-timer-fill" aria-hidden="true" />}
        {status.stacks !== undefined && status.stacks > 1 && <span class="status-stacks">{status.stacks}</span>}
      </div>
      {remainingMs !== undefined && <span class="status-remaining">{formatRemaining(remainingMs)}</span>}
    </div>
  );
}

function statusIcon(spriteId: string | undefined): string {
  return spriteId ? `views://assets/status-icons/${spriteId}.webp` : "";
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  if (totalSeconds >= 60) return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  return `${totalSeconds}`;
}
