import { useCallback } from "preact/hooks";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { MessageKey } from "@svoverlay/i18n/messages";
import { formatCompact, formatInteger } from "@svoverlay/ui-kit/format";
import { InteractiveChart } from "@svoverlay/ui-kit/interactive-chart";
import type { ChartRange, ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import { ewmaSeries } from "@kar-mi/spirit-vale-tools-metrics";
import type { OverlayResource } from "../../app-types.ts";
import { resourceFill } from "../../personal-resources.ts";
import { OverlayElement } from "../element-frame.tsx";
import { characterState, weightWarn } from "../store.ts";
import { desktopView } from "../transport.ts";
import { WaitingForDps } from "./common.tsx";

export function WeightOverlayElement({ locked }: { locked: boolean }) {
  return (
    <OverlayElement id="weight" locked={locked} weightWarn={weightWarn.value}>
      <WeightElement />
    </OverlayElement>
  );
}

function WeightElement() {
  const t = useTranslator();
  const weight = characterState.value?.weight;
  return (
    <div class={`weight-value${weight ? "" : " weight-waiting"}`}>
      <strong class="weight-label">{t("overlay.weight.label")}</strong>
      {weight ? (
        <span class="weight-numbers" aria-label={t("overlay.weight.aria", { current: weight.current, maximum: weight.maximum })}>
          <strong>{formatInteger(weight.current)}</strong>
          <span>/</span>
          <strong>{formatInteger(weight.maximum)}</strong>
        </span>
      ) : <span class="weight-empty">{t("overlay.waiting")}</span>}
    </div>
  );
}

export function XpTrackerElement({ locked }: { locked: boolean }) {
  const t = useTranslator();
  const xp = characterState.value?.xp;
  if (!xp) return <WaitingForDps label={t("overlay.xp.waiting")} />;
  return (
    <div class="element-content xp-tracker">
      <h2 class="element-title">{t("overlay.xp.heading")}</h2>
      <div class="xp-total"><small>{t("overlay.total")}</small>{formatCompact(xp.total)}</div>
      <div class="xp-rates">
        <span>{formatCompact(xp.perSecond)}<small>/s</small></span>
        <span>{formatCompact(xp.perHour)}<small>/hr</small></span>
      </div>
      {!locked && (
        <button
          class="xp-reset-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            void desktopView.rpc?.request.resetXpTracker({}).then((nextState) => { characterState.value = nextState; });
          }}
        >
          {t("overlay.reset")}
        </button>
      )}
    </div>
  );
}

export function GoldTrackerElement({ locked }: { locked: boolean }) {
  const t = useTranslator();
  const gold = characterState.value?.gold;
  if (!gold) return <WaitingForDps label={t("overlay.gold.waiting")} />;
  return (
    <div class="element-content gold-tracker">
      <h2 class="element-title">{t("overlay.gold.heading")}</h2>
      <div class="gold-total"><small>{t("overlay.total")}</small>{formatCompact(gold.total)}</div>
      <div class="gold-rates">
        <span>{formatCompact(gold.perSecond)}<small>/s</small></span>
        <span>{formatCompact(gold.perHour)}<small>/hr</small></span>
      </div>
      {!locked && (
        <button
          class="gold-reset-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            void desktopView.rpc?.request.resetGoldTracker({}).then((nextState) => { characterState.value = nextState; });
          }}
        >
          {t("overlay.reset")}
        </button>
      )}
    </div>
  );
}

export function XpChartElement() {
  const t = useTranslator();
  const buckets = characterState.value?.xp.timeline ?? [];
  const rangeEnd = Date.now();
  const rollingRange = { start: rangeEnd - 10 * 60_000, end: rangeEnd };
  const computeRender = useCallback((range: ChartRange, _width: number): ChartRenderResult => {
    const rates = ewmaSeries(buckets, range);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({
        time: point.time,
        ratio: maximum > 0 ? point.value / maximum : 0,
        primary: `${formatCompact(point.value)}/sec`,
        secondary: t("overlay.xpChart.ewma"),
      })),
      yLabels: Array.from({ length: 5 }, (_, tick) => formatCompact((maximum * tick) / 4)),
    };
  }, [buckets, t]);

  return (
    <div class="element-content xp-chart">
      <h2 class="element-title">{t("overlay.xpChart.heading")}</h2>
      <InteractiveChart
        extent={rollingRange}
        computeRender={computeRender}
        stepped={false}
        emptyLabel={t("overlay.xp.waiting")}
        ariaLabel={t("overlay.xpChart.aria")}
        resetKey="xp-chart"
        interactive={false}
        xAxisTickCount={2}
      />
    </div>
  );
}

type ResourceKind = "health" | "mana" | "character-xp" | "job-xp";

const RESOURCE_LABEL_KEYS: Record<ResourceKind, MessageKey> = {
  health: "overlay.resource.health",
  mana: "overlay.resource.mana",
  "character-xp": "overlay.resource.characterXp",
  "job-xp": "overlay.resource.jobXp",
};

function ResourceElement(
  { kind, resource, shield }: { kind: ResourceKind; resource: OverlayResource | undefined; shield?: number },
) {
  const t = useTranslator();
  const label = t(RESOURCE_LABEL_KEYS[kind]);


  const hasShield = typeof shield === "number" && Number.isFinite(shield) && shield > 0
    && resource !== undefined && resource.maximum > 0;
  const shieldFill = hasShield ? Math.max(0.03, Math.min(1, shield! / resource!.maximum)) : 0;
  const description = resource
    ? hasShield
      ? t("overlay.resource.ariaShield", { label, current: resource.current, maximum: resource.maximum, shield: shield! })
      : t("overlay.resource.aria", { label, current: resource.current, maximum: resource.maximum })
    : t("overlay.resource.waitingFor", { label });

  return (
    <div
      class={`resource-value resource-${kind}${resource ? "" : " resource-waiting"}`}
      style={`--resource-fill:${resource ? resourceFill(resource) : 0};--resource-shield-fill:${shieldFill}`}
      aria-label={description}
    >
      {hasShield ? <span class="resource-shield-fill" aria-hidden="true" /> : null}
      <strong class="resource-label">{label}</strong>
      {resource ? (
        <span class="resource-numbers">
          <strong>{formatInteger(resource.current)}</strong>
          <span>/</span>
          <strong>{formatInteger(resource.maximum)}</strong>
          {hasShield ? (
            <>
              <span class="resource-shield-sep">|</span>
              <strong>{formatInteger(shield!)}</strong>
            </>
          ) : null}
        </span>
      ) : <span class="resource-empty">{t("overlay.waiting")}</span>}
    </div>
  );
}

export function CharacterResourceElement({ kind }: { kind: ResourceKind }) {
  const next = characterState.value;
  const resource = kind === "health" ? next?.health
    : kind === "mana" ? next?.mana
    : kind === "character-xp" ? next?.characterXp
    : next?.jobXp;
  return <ResourceElement kind={kind} resource={resource} shield={kind === "health" ? next?.shield : undefined} />;
}
