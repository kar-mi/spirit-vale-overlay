import { render } from "preact";
import { useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { formatDuration } from "@spiritvale/ui-core/format";

import type { FishNetDpsTimelinePoint } from "@kar-mi/spirit-vale-tools-combat";
import type { CombatAnalysisDetailRpc, CombatAnalysisDetailState } from "../app-types.ts";

type Metric = "cumulative" | "dps";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

const state = signal<CombatAnalysisDetailState | undefined>(undefined);

const rpc = Electroview.defineRPC<CombatAnalysisDetailRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function App() {
  const [metric, setMetric] = useState<Metric>("dps");
  const next = state.value;
  if (!next) return <main class="app-shell" />;
  const player = next.player;

  const metrics: [string, string][] = [
    ["Damage", compactFormat.format(player.damage)],
    ["DPS", numberFormat.format(player.dps)],
    ["Hits", numberFormat.format(player.hits)],
    ["Kills", numberFormat.format(player.kills)],
    ["Crit hits", numberFormat.format(player.criticalHits)],
    ["Crit rate", player.critRate === undefined ? "—" : percentFormat.format(player.critRate)],
  ];

  return (
    <main class="app-shell">
      <TitleBar
        appTag="Player detail"
        minWidth={620}
        minHeight={500}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 880, height: 720 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      />
      <section class="detail-content">
        <section class="toolbar">
          <div>
            <h1>{player.displayName}</h1>
            <p>{next.fileName} · {next.encounterLabel}</p>
          </div>
          <div class="seg">
            <button type="button" class={metric === "dps" ? "active" : undefined} onClick={() => setMetric("dps")}>DPS / 5 sec</button>
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
            <h2>Damage over time</h2>
            <p>{metric === "cumulative" ? "Cumulative damage across the encounter." : "Damage per second in five-second buckets."}</p>
          </div>
          <div class="chart-card">
            <DamageChart points={player.timeline} durationMs={next.encounterDurationMs} metric={metric} />
          </div>
        </section>
        <section class="skills-section">
          <div class="section-head">
            <h2>Skill breakdown</h2>
            <p>Damage, DPS, hits, and critical-hit performance.</p>
          </div>
          {player.skills.length === 0
            ? <p class="empty-state">No skill damage was found for this player.</p>
            : <div class="table-scroll">
                <table class="data-table combat-table" aria-label="Skill breakdown">
                  <thead><tr><th>Skill</th><th>Damage</th><th>DPS</th><th>Share</th><th>Hits</th><th>Crits</th><th>Crit rate</th></tr></thead>
                  <tbody>{player.skills.map((skill) => (
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
  points: readonly FishNetDpsTimelinePoint[];
  durationMs: number;
  metric: Metric;
}

function DamageChart({ points, durationMs, metric }: DamageChartProps) {
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
    <svg id="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Damage over time chart">
      <line class="chart-axis" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      <polyline class="chart-line" points={linePoints} />
      <text class="chart-label" x={0} y={top + 4}>{compactFormat.format(maxValue)}</text>
      <text class="chart-label" x={left} y={height - 8}>0:00</text>
      <text class="chart-label" text-anchor="end" x={width - right} y={height - 8}>{formatDuration(durationMs)}</text>
    </svg>
  );
}

render(<App />, document.getElementById("root")!);
