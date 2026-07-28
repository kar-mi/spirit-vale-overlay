import { render } from "preact";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { formatDuration } from "@spiritvale/ui-core/format";
import { EnemyFilterControl } from "@spiritvale/ui-core/enemy-filter";
import { CustomSelect } from "@spiritvale/ui-core/custom-select";
import { StatTypeSelect } from "@spiritvale/ui-core/stat-type-select";

import type { CombatAnalysisRpc, CombatAnalysisState, MeterActorRow, MeterEncounterSnapshot } from "../app-types.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

const state = signal<CombatAnalysisState | undefined>(undefined);

const rpc = Electroview.defineRPC<CombatAnalysisRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function activateRow(event: JSX.TargetedKeyboardEvent<HTMLTableRowElement>, activate: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

interface FilteredRow {
  actor: MeterActorRow;
  damage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
  contribution: number;
}

function applyEnemyFilter(next: CombatAnalysisState, rows: MeterActorRow[], selectedEnemyIds: ReadonlySet<number>): FilteredRow[] {
  if (next.statType !== "damage" || selectedEnemyIds.size === 0) {
    return rows.map((actor) => ({
      actor,
      damage: actor.damage,
      dps: actor.dps,
      hits: actor.hits,
      criticalHits: actor.criticalHits,
      critRate: actor.critRate,
      contribution: actor.contribution,
    }));
  }
  const durationMs = next.snapshot?.durationMs ?? 0;
  const durationSeconds = Math.max(1, durationMs) / 1000;
  const partial = rows.map((actor) => {
    const breakdown = next.actorEnemyBreakdown[actor.actorIds[0]!] ?? [];
    const filtered = breakdown.filter((row) => selectedEnemyIds.has(row.targetId));
    const damage = filtered.reduce((sum, row) => sum + row.damage, 0);
    const hits = filtered.reduce((sum, row) => sum + row.hits, 0);
    const criticalHits = filtered.reduce((sum, row) => sum + row.criticalHits, 0);
    return { actor, damage, hits, criticalHits, dps: damage / durationSeconds, critRate: hits > 0 ? criticalHits / hits : undefined };
  });
  const totalDamage = partial.reduce((sum, row) => sum + row.damage, 0);
  return partial.map((row) => ({ ...row, contribution: totalDamage > 0 ? row.damage / totalDamage : 0 }));
}

function App() {
  const next = state.value;
  const [selectedEnemyIds, setSelectedEnemyIds] = useState<Set<number>>(new Set());
  const lastEncounterId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (next?.selectedEncounterId !== lastEncounterId.current) {
      lastEncounterId.current = next?.selectedEncounterId;
      setSelectedEnemyIds(new Set());
    }
  }, [next?.selectedEncounterId]);

  if (!next) return <main class="app-shell" />;

  const activeSnapshot: MeterEncounterSnapshot | undefined =
    next.statType === "tanked" ? next.tankedSnapshot :
    next.statType === "heal" ? next.healSnapshot :
    next.snapshot;
  const metricLabel = next.statType === "tanked" ? "TPS" : next.statType === "heal" ? "HPS" : "DPS";
  const damageLabel = next.statType === "tanked" ? "Damage taken" : next.statType === "heal" ? "Healing" : "Damage";

  const rows = activeSnapshot?.actors ?? [];
  const filteredRows = applyEnemyFilter(next, rows, selectedEnemyIds);
  const hasFilter = next.statType === "damage" && selectedEnemyIds.size > 0;
  const partyDamage = hasFilter ? filteredRows.reduce((sum, row) => sum + row.damage, 0) : (activeSnapshot?.totalDamage ?? 0);
  const partyDps = hasFilter
    ? (activeSnapshot ? partyDamage / (Math.max(1, activeSnapshot.durationMs) / 1000) : 0)
    : (activeSnapshot?.partyDps ?? 0);

  return (
    <main class="app-shell">
      <TitleBar
        appTag="Analysis"
        minWidth={680}
        minHeight={460}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 920, height: 680 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      />
      <section class="analysis-content">
        <section class="toolbar">
          <label class="encounter-picker">
            <span class="t-label">Encounter</span>
            <CustomSelect
              ariaLabel="Encounter"
              disabled={next.status !== "ready" || next.encounters.length < 2}
              value={next.selectedEncounterId ?? ""}
              options={next.encounters.map((encounter) => ({ value: encounter.id, label: encounter.label }))}
              onChange={(id) => void electroview.rpc?.request.selectEncounter({ id })}
            />
          </label>
          <StatTypeSelect
            value={next.statType}
            onChange={(statType) => void electroview.rpc?.request.setStatType({ statType })}
            disabled={next.status !== "ready"}
          />
          <EnemyFilterControl enemies={next.statType === "damage" ? next.enemies : []} selected={selectedEnemyIds} onChange={setSelectedEnemyIds} />
          <div class="toolbar-meta">
            <button class="btn" type="button" disabled={next.status !== "ready"} onClick={() => void electroview.rpc?.request.openDeathLog({})}>Death log</button>
          </div>
        </section>
        <p id="warning" class="banner is-warn" hidden={next.invalidLines === 0}>
          {next.invalidLines === 0 ? "" : `${next.invalidLines} malformed record${next.invalidLines === 1 ? " was" : "s were"} skipped.`}
        </p>
        <div class="table-scroll totals">
          <table class="data-table summary-table" aria-label="Encounter totals">
            <thead><tr><th>Party {metricLabel}</th><th>Total {damageLabel.toLowerCase()}</th><th>Duration</th><th>Players</th></tr></thead>
            <tbody><tr>
              <td>{numberFormat.format(partyDps)}</td>
              <td>{compactFormat.format(partyDamage)}</td>
              <td>{activeSnapshot ? formatDuration(activeSnapshot.durationMs) : "—"}</td>
              <td>{numberFormat.format(rows.length)}</td>
            </tr></tbody>
          </table>
        </div>
        <section class="players-section" aria-label="Player analysis">
          <div class="section-head"><h1>Player {damageLabel.toLowerCase()}</h1><p>Double-click a player for skills and damage over time.</p></div>
          {filteredRows.length > 0 && <div class="table-scroll">
            <table class="data-table combat-table" aria-label={`Player ${damageLabel.toLowerCase()}`}>
              <thead><tr><th>Player</th><th>{damageLabel}</th><th>{metricLabel}</th><th>Share</th><th>Hits</th><th>Crits</th><th>Crit rate</th><th>Kills</th></tr></thead>
              <tbody>{filteredRows.map(({ actor: player, damage, dps, hits, criticalHits, critRate, contribution }) => {
                const activate = () => void electroview.rpc?.request.openPlayerDetails({ actorId: player.actorIds[0]! });
                return <tr
                  key={player.actorIds[0]}
                  class="player-row"
                  title="Double-click for player detail"
                  tabIndex={0}
                  onDblClick={activate}
                  onKeyDown={(event) => activateRow(event, activate)}
                >
                  <th scope="row">{player.displayName}</th>
                  <td>{compactFormat.format(damage)}</td>
                  <td>{numberFormat.format(dps)}</td>
                  <td>{percentFormat.format(contribution)}</td>
                  <td>{numberFormat.format(hits)}</td>
                  <td>{numberFormat.format(criticalHits)}</td>
                  <td>{critRate === undefined ? "—" : percentFormat.format(critRate)}</td>
                  <td>{numberFormat.format(player.kills)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
          {next.status === "ready" && rows.length === 0 && (
            <p id="empty-state" class="empty-state">No {damageLabel.toLowerCase()} was found for this encounter.</p>
          )}
        </section>
      </section>
    </main>
  );
}

render(<App />, document.getElementById("root")!);
