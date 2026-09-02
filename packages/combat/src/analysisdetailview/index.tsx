import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { EnemyFilterControl } from "@svoverlay/ui-kit/enemy-filter";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { InteractiveChart } from "@svoverlay/ui-kit/interactive-chart";
import type { ChartRange, ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { MessageKey } from "@svoverlay/i18n/messages";

import type { CombatAnalysisDetailRpc, CombatAnalysisDetailState, MeterActorRow, MeterSkillRow, MeterTimelinePoint, StatType } from "../app-types.ts";
import { nextTableSort, SortableHeader, sortTableRows, type TableSort } from "@svoverlay/ui-kit/sortable-table";
import { buildDamageChartRender, damageChartExtent, formatElapsedChartTime } from "../damage-chart.ts";
import type { DamageChartMetric } from "../damage-chart.ts";

type SkillSortKey = "sourceLabel" | "damage" | "dps" | "contribution" | "hits" | "criticalHits" | "critRate";

/** Every stat type names its measured quantity, and the sentences that embed it, in full. */
const AMOUNT_KEYS: Record<StatType, { label: MessageKey; cumulative: MessageKey; empty: MessageKey }> = {
  damage: { label: "amount.damage", cumulative: "detail.chart.cumulative.damage", empty: "detail.chart.empty.damage" },
  tanked: { label: "amount.damageTaken", cumulative: "detail.chart.cumulative.damageTaken", empty: "detail.chart.empty.damageTaken" },
  heal: { label: "amount.healing", cumulative: "detail.chart.cumulative.healing", empty: "detail.chart.empty.healing" },
};

interface SkillFold {
  skills: MeterSkillRow[];
  damage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
}

function foldSkillsByEnemy(
  encounterDurationMs: number,
  selectedEnemyIds: ReadonlySet<number>,
  player: MeterActorRow | undefined,
  skillsByEnemy: Record<number, MeterSkillRow[]>,
): SkillFold {
  if (player === undefined) return { skills: [], damage: 0, dps: 0, hits: 0, criticalHits: 0 };
  if (selectedEnemyIds.size === 0) {
    return { skills: player.skills, damage: player.damage, dps: player.dps, hits: player.hits, criticalHits: player.criticalHits, critRate: player.critRate };
  }
  const durationSeconds = Math.max(1, encounterDurationMs) / 1000;
  const merged = new Map<string, { sourceLabel: string; damage: number; hits: number; criticalHits: number }>();
  for (const targetId of selectedEnemyIds) {
    for (const row of skillsByEnemy[targetId] ?? []) {
      const existing = merged.get(row.sourceId) ?? { sourceLabel: row.sourceLabel, damage: 0, hits: 0, criticalHits: 0 };
      existing.damage += row.damage;
      existing.hits += row.hits;
      existing.criticalHits += row.criticalHits;
      merged.set(row.sourceId, existing);
    }
  }
  const totalDamage = [...merged.values()].reduce((sum, row) => sum + row.damage, 0);
  const totalHits = [...merged.values()].reduce((sum, row) => sum + row.hits, 0);
  const totalCriticalHits = [...merged.values()].reduce((sum, row) => sum + row.criticalHits, 0);
  const skills: MeterSkillRow[] = [...merged.entries()]
    .map(([sourceId, row]) => ({
      sourceId,
      sourceLabel: row.sourceLabel,
      damage: row.damage,
      dps: row.damage / durationSeconds,
      contribution: totalDamage > 0 ? row.damage / totalDamage : 0,
      hits: row.hits,
      criticalHits: row.criticalHits,
      ...(row.hits > 0 ? { critRate: row.criticalHits / row.hits } : {}),
    }))
    .sort((left, right) => right.damage - left.damage);
  return {
    skills,
    damage: totalDamage,
    dps: totalDamage / durationSeconds,
    hits: totalHits,
    criticalHits: totalCriticalHits,
    critRate: totalHits > 0 ? totalCriticalHits / totalHits : undefined,
  };
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

const state = signal<CombatAnalysisDetailState | undefined>(undefined);

const rpc = DesktopView.defineRPC<CombatAnalysisDetailRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const desktopView = new DesktopView({ rpc });

void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const ANALYSIS_DETAIL_DEFAULT_WIDTH = 880;
const ANALYSIS_DETAIL_DEFAULT_HEIGHT = 720;
void ensureInitialWindowSize(desktopView.rpc?.request, { width: 620, height: 500 });

function App() {
  const t = useTranslator();
  const [metric, setMetric] = useState<DamageChartMetric>("dps");
  const [skillSort, setSkillSort] = useState<TableSort<SkillSortKey>>({ key: "damage", direction: "descending" });
  const [selectedEnemyIds, setSelectedEnemyIds] = useState<Set<number>>(new Set());
  const [statType, setStatType] = useState<StatType>("damage");
  const next = state.value;
  const selectionScope = next
    ? JSON.stringify([
        next.fileName,
        next.encounterLabel,
        next.player.displayName,
        next.statType,
        next.selectedEnemyIds,
      ])
    : undefined;

  useEffect(() => {
    if (next) {
      setStatType(next.statType);
      setSelectedEnemyIds(new Set(next.selectedEnemyIds));
    }
  }, [selectionScope]);

  // Switching stat type inside the popup changes which attacker/enemy list applies; a carried-over
  // selection would hide rows or leave an invisible pick, so drop it.
  const changeStatType = (nextStat: StatType): void => {
    setStatType(nextStat);
    setSelectedEnemyIds(new Set());
  };

  if (!next) return <main class="app-shell" />;

  const activePlayer: MeterActorRow | undefined =
    statType === "tanked" ? next.tankedPlayer :
    statType === "heal" ? next.healPlayer :
    next.player;
  const metricLabel = statType === "tanked" ? "TPS" : statType === "heal" ? "HPS" : "DPS";
  const amountKeys = AMOUNT_KEYS[statType];
  const damageLabel = t(amountKeys.label);

  const fold: SkillFold = statType === "damage"
    ? foldSkillsByEnemy(next.encounterDurationMs, selectedEnemyIds, next.player, next.skillsByEnemy)
    : statType === "tanked"
      ? foldSkillsByEnemy(next.encounterDurationMs, selectedEnemyIds, next.tankedPlayer, next.tankedSkillsByEnemy ?? {})
      : activePlayer
        ? { skills: activePlayer.skills, damage: activePlayer.damage, dps: activePlayer.dps, hits: activePlayer.hits, criticalHits: activePlayer.criticalHits, critRate: activePlayer.critRate }
        : { skills: [], damage: 0, dps: 0, hits: 0, criticalHits: 0 };
  const absorbedSkills = statType === "tanked" ? (next.tankedPlayer?.absorbedSkills ?? []) : [];

  const metrics: [string, string][] = [
    [damageLabel, compactFormat.format(fold.damage)],
    [metricLabel, numberFormat.format(fold.dps)],
    [t("detail.metric.hits"), numberFormat.format(fold.hits)],
    [t("detail.metric.kills"), numberFormat.format(activePlayer?.kills ?? 0)],
    [t("detail.metric.critHits"), numberFormat.format(fold.criticalHits)],
    [t("detail.metric.critRate"), fold.critRate === undefined ? "—" : percentFormat.format(fold.critRate)],
  ];
  const sortedSkills = sortTableRows(
    fold.skills,
    skillSort,
    (skill, key) => skill[key],
    (left, right) => left.sourceLabel.localeCompare(right.sourceLabel),
  );
  const sortSkillsBy = (key: SkillSortKey): void => {
    setSkillSort((current) => nextTableSort(current, key, key === "sourceLabel" ? "ascending" : "descending"));
  };

  return (
    <main class="app-shell">
      <TitleBar
        appTag={t("detail.window.tag")}
        minWidth={620}
        minHeight={500}
        getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: ANALYSIS_DETAIL_DEFAULT_WIDTH, height: ANALYSIS_DETAIL_DEFAULT_HEIGHT }}
        setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
      extraControls={<SettingsButton onClick={() => void desktopView.rpc?.request.openSettings({})} />}
      />
      <section class="detail-content">
        <section class="toolbar">
          <div>
            <h1>{activePlayer?.displayName ?? next.player.displayName}</h1>
            <p>{next.fileName} · {next.encounterLabel}</p>
          </div>
          <EnemyFilterControl
            enemies={statType === "tanked" ? next.tankedEnemies : statType === "damage" ? next.enemies : []}
            selected={selectedEnemyIds}
            onChange={setSelectedEnemyIds}
          />
          <StatTypeSelect value={statType} onChange={changeStatType} />
          <div class="seg">
            <button type="button" class={metric === "dps" ? "active" : undefined} onClick={() => setMetric("dps")}>{t("detail.metric.perFive", { metric: metricLabel })}</button>
            <button type="button" class={metric === "cumulative" ? "active" : undefined} onClick={() => setMetric("cumulative")}>{t("detail.metric.cumulative")}</button>
          </div>
        </section>
        <div class="table-scroll totals">
          <table class="data-table summary-table" aria-label={t("detail.totals.label")}>
            <thead><tr>{metrics.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody><tr>{metrics.map(([label, value]) => <td key={label}>{value}</td>)}</tr></tbody>
          </table>
        </div>
        <section class="chart-section">
          <div class="section-head">
            <h2>{t("detail.chart.heading", { amount: damageLabel })}</h2>
            <p>{metric === "cumulative" ? t(amountKeys.cumulative) : t("detail.chart.perSecond", { amount: damageLabel })}</p>
          </div>
          <div class="chart-card">
            <DamageChart
              points={activePlayer?.timeline ?? []}
              durationMs={next.encounterDurationMs}
              metric={metric}
              damageLabel={damageLabel}
              metricLabel={metricLabel}
              emptyLabel={t(amountKeys.empty)}
              resetKey={`${selectionScope}:${statType}:${metric}`}
            />
          </div>
        </section>
        <section class="skills-section">
          <div class="section-head">
            <h2>{t("detail.skills.heading")}</h2>
            <p>{t("detail.skills.hint", { amount: damageLabel, metric: metricLabel })}</p>
          </div>
          {fold.skills.length === 0
            ? <p class="empty-state">
                {statType === "tanked" ? t("detail.skills.emptyTanked")
                  : statType === "heal" ? t("detail.skills.emptyHeal")
                  : t("detail.skills.empty")}
              </p>
            : <div class="table-scroll">
                <table class="data-table combat-table" aria-label={t("detail.skills.heading")}>
                  <thead><tr>
                    <SortableHeader sortKey="sourceLabel" sort={skillSort} onSort={sortSkillsBy} align="start">{t(statType === "tanked" ? "detail.column.attackerSkill" : "detail.column.skill")}</SortableHeader>
                    <SortableHeader sortKey="damage" sort={skillSort} onSort={sortSkillsBy}>{damageLabel}</SortableHeader>
                    <SortableHeader sortKey="dps" sort={skillSort} onSort={sortSkillsBy}>{metricLabel}</SortableHeader>
                    <SortableHeader sortKey="contribution" sort={skillSort} onSort={sortSkillsBy}>{t("detail.column.share")}</SortableHeader>
                    <SortableHeader sortKey="hits" sort={skillSort} onSort={sortSkillsBy}>{t("detail.column.hits")}</SortableHeader>
                    <SortableHeader sortKey="criticalHits" sort={skillSort} onSort={sortSkillsBy}>{t("detail.column.crits")}</SortableHeader>
                    <SortableHeader sortKey="critRate" sort={skillSort} onSort={sortSkillsBy}>{t("detail.column.critRate")}</SortableHeader>
                  </tr></thead>
                  <tbody>{sortedSkills.map((skill) => (
                    <tr key={skill.sourceId}>
                      <th scope="row">{skill.sourceLabel}</th>
                      <td>{compactFormat.format(skill.damage)}</td>
                      <td>{numberFormat.format(skill.dps)}</td>
                      <td>{percentFormat.format(skill.contribution)}</td>
                      <td>{numberFormat.format(skill.hits)}</td>
                      <td>{numberFormat.format(skill.criticalHits)}</td>
                      <td>{skill.critRate === undefined ? "—" : percentFormat.format(skill.critRate)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
        </section>
        {absorbedSkills.length > 0 && (
          <section class="skills-section">
            <div class="section-head">
              <h2>{t("combat.shields.heading")}</h2>
              <p>
                {t("combat.shields.detail")}
                {selectedEnemyIds.size > 0 && ` ${t("combat.shields.filteredHint")}`}
              </p>
            </div>
            <div class="table-scroll">
              <table class="data-table combat-table" aria-label={t("combat.shields.skillAria")}>
                <thead><tr><th>{t("combat.column.attackerSkill")}</th><th>{t("combat.column.absorbed")}</th><th>{t("combat.column.share")}</th><th>{t("combat.column.hits")}</th></tr></thead>
                <tbody>{absorbedSkills.map((skill) => (
                  <tr key={skill.sourceId}>
                    <th scope="row">{skill.sourceLabel}</th>
                    <td>{compactFormat.format(skill.damage)}</td>
                    <td>{percentFormat.format(skill.contribution)}</td>
                    <td>{numberFormat.format(skill.hits)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

interface DamageChartProps {
  points: readonly MeterTimelinePoint[];
  durationMs: number;
  metric: DamageChartMetric;
  damageLabel: string;
  metricLabel: string;
  emptyLabel: string;
  resetKey: string;
}

function DamageChart({ points, durationMs, metric, damageLabel, metricLabel, emptyLabel, resetKey }: DamageChartProps) {
  const t = useTranslator();
  const computeRender = useCallback(
    (range: ChartRange, _plotWidth: number): ChartRenderResult =>
      buildDamageChartRender(points, range, metric, damageLabel, metricLabel),
    [points, metric, damageLabel, metricLabel],
  );
  return (
    <InteractiveChart
      extent={damageChartExtent(points, durationMs)}
      computeRender={computeRender}
      stepped={metric === "cumulative"}
      emptyLabel={emptyLabel}
      ariaLabel={t("detail.chart.aria", { amount: damageLabel })}
      resetKey={resetKey}
      formatAxisTime={formatElapsedChartTime}
      formatTooltipTime={formatElapsedChartTime}
    />
  );
}

render(<App />, document.getElementById("root")!);
