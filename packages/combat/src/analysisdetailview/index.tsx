import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { formatDuration } from "@svoverlay/ui-kit/format";
import { EnemyFilterControl } from "@svoverlay/ui-kit/enemy-filter";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type { FishNetDpsSkillRow } from "@kar-mi/spirit-vale-tools-combat";
import type { CombatAnalysisDetailRpc, CombatAnalysisDetailState, MeterActorRow, MeterTimelinePoint, StatType } from "../app-types.ts";

type Metric = "cumulative" | "dps";

interface SkillFold {
  skills: FishNetDpsSkillRow[];
  damage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
}

function foldSkillsByEnemy(next: CombatAnalysisDetailState, selectedEnemyIds: ReadonlySet<number>): SkillFold {
  if (selectedEnemyIds.size === 0) {
    const player = next.player;
    return { skills: player.skills, damage: player.damage, dps: player.dps, hits: player.hits, criticalHits: player.criticalHits, critRate: player.critRate };
  }
  const durationSeconds = Math.max(1, next.encounterDurationMs) / 1000;
  const merged = new Map<string, { sourceLabel: string; damage: number; hits: number; criticalHits: number }>();
  for (const targetId of selectedEnemyIds) {
    for (const row of next.skillsByEnemy[targetId] ?? []) {
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
  const skills: FishNetDpsSkillRow[] = [...merged.entries()]
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

const rpc = Electroview.defineRPC<CombatAnalysisDetailRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const ANALYSIS_DETAIL_DEFAULT_WIDTH = 880;
const ANALYSIS_DETAIL_DEFAULT_HEIGHT = 720;
void ensureInitialWindowSize(electroview.rpc?.request, { width: ANALYSIS_DETAIL_DEFAULT_WIDTH, height: ANALYSIS_DETAIL_DEFAULT_HEIGHT });

function App() {
  const [metric, setMetric] = useState<Metric>("dps");
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

  if (!next) return <main class="app-shell" />;

  const activePlayer: MeterActorRow | undefined =
    statType === "tanked" ? next.tankedPlayer :
    statType === "heal" ? next.healPlayer :
    next.player;
  const metricLabel = statType === "tanked" ? "TPS" : statType === "heal" ? "HPS" : "DPS";
  const damageLabel = statType === "tanked" ? "Damage taken" : statType === "heal" ? "Healing" : "Damage";

  const fold: SkillFold = statType === "damage"
    ? foldSkillsByEnemy(next, selectedEnemyIds)
    : activePlayer
      ? { skills: activePlayer.skills, damage: activePlayer.damage, dps: activePlayer.dps, hits: activePlayer.hits, criticalHits: activePlayer.criticalHits, critRate: activePlayer.critRate }
      : { skills: [], damage: 0, dps: 0, hits: 0, criticalHits: 0 };

  const metrics: [string, string][] = [
    [damageLabel, compactFormat.format(fold.damage)],
    [metricLabel, numberFormat.format(fold.dps)],
    ["Hits", numberFormat.format(fold.hits)],
    ["Kills", numberFormat.format(activePlayer?.kills ?? 0)],
    ["Crit hits", numberFormat.format(fold.criticalHits)],
    ["Crit rate", fold.critRate === undefined ? "—" : percentFormat.format(fold.critRate)],
  ];

  return (
    <main class="app-shell">
      <TitleBar
        appTag="Player detail"
        minWidth={620}
        minHeight={500}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: ANALYSIS_DETAIL_DEFAULT_WIDTH, height: ANALYSIS_DETAIL_DEFAULT_HEIGHT }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      extraControls={<SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />}
      />
      <section class="detail-content">
        <section class="toolbar">
          <div>
            <h1>{activePlayer?.displayName ?? next.player.displayName}</h1>
            <p>{next.fileName} · {next.encounterLabel}</p>
          </div>
          <EnemyFilterControl enemies={statType === "damage" ? next.enemies : []} selected={selectedEnemyIds} onChange={setSelectedEnemyIds} />
          <StatTypeSelect value={statType} onChange={setStatType} />
          <div class="seg">
            <button type="button" class={metric === "dps" ? "active" : undefined} onClick={() => setMetric("dps")}>{metricLabel} / 5 sec</button>
            <button type="button" class={metric === "cumulative" ? "active" : undefined} onClick={() => setMetric("cumulative")}>Cumulative</button>
          </div>
        </section>
        <div class="table-scroll totals">
          <table class="data-table summary-table" aria-label="Player totals">
            <thead><tr>{metrics.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody><tr>{metrics.map(([label, value]) => <td key={label}>{value}</td>)}</tr></tbody>
          </table>
        </div>
        <section class="chart-section">
          <div class="section-head">
            <h2>{damageLabel} over time</h2>
            <p>{metric === "cumulative" ? `Cumulative ${damageLabel.toLowerCase()} across the encounter.` : `${damageLabel} per second in five-second buckets.`}</p>
          </div>
          <div class="chart-card">
            <DamageChart points={activePlayer?.timeline ?? []} durationMs={next.encounterDurationMs} metric={metric} damageLabel={damageLabel} />
          </div>
        </section>
        <section class="skills-section">
          <div class="section-head">
            <h2>Skill breakdown</h2>
            <p>{damageLabel}, {metricLabel}, hits, and critical-hit performance.</p>
          </div>
          {fold.skills.length === 0
            ? <p class="empty-state">
                {statType === "tanked" ? "No damage was taken by this player."
                  : statType === "heal" ? "No healing was received by this player."
                  : "No skill damage was found for this player."}
              </p>
            : <div class="table-scroll">
                <table class="data-table combat-table" aria-label="Skill breakdown">
                  <thead><tr><th>{statType === "tanked" ? "Attacker skill" : "Skill"}</th><th>{damageLabel}</th><th>{metricLabel}</th><th>Share</th><th>Hits</th><th>Crits</th><th>Crit rate</th></tr></thead>
                  <tbody>{fold.skills.map((skill) => (
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
      </section>
    </main>
  );
}

interface DamageChartProps {
  points: readonly MeterTimelinePoint[];
  durationMs: number;
  metric: Metric;
  damageLabel: string;
}

function DamageChart({ points, durationMs, metric, damageLabel }: DamageChartProps) {
  const width = 760;
  const height = 280;
  const left = 52;
  const top = 18;
  const right = 18;
  const bottom = 34;
  const maxValue = Math.max(1, ...points.map((point) => (metric === "cumulative" ? point.cumulativeDamage : point.dps)));
  const duration = Math.max(1, durationMs);
  const linePoints = points
    .map((point) => {
      const x = left + (point.elapsedMs / duration) * (width - left - right);
      const value = metric === "cumulative" ? point.cumulativeDamage : point.dps;
      const y = top + (1 - value / maxValue) * (height - top - bottom);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg id="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${damageLabel} over time chart`}>
      <line class="chart-axis" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      <polyline class="chart-line" points={linePoints} />
      <text class="chart-label" x={0} y={top + 4}>{compactFormat.format(maxValue)}</text>
      <text class="chart-label" x={left} y={height - 8}>0:00</text>
      <text class="chart-label" text-anchor="end" x={width - right} y={height - 8}>{formatDuration(durationMs)}</text>
    </svg>
  );
}

render(<App />, document.getElementById("root")!);
