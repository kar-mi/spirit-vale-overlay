import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatDuration } from "@svoverlay/ui-kit/format";
import { EnemyFilterControl } from "@svoverlay/ui-kit/enemy-filter";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";

import type { CombatAnalysisState, MeterEncounterSnapshot, StatType } from "../app-types.ts";
import { CombatClassCell } from "../combat-class.tsx";
import { nextTableSort, SortableHeader, sortTableRows, type TableSort } from "@svoverlay/ui-kit/sortable-table";
import { applyEnemyFilter, enemyFilterSupported } from "../enemy-filtering.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

type PlayerSortKey = "damage" | "dps" | "contribution" | "hits" | "criticalHits" | "critRate" | "kills";

interface PastAnalysisPanelProps {
  state: CombatAnalysisState;
  onBack(): void;
  onSelectEncounter(id: string): void;
  onSetStatType(statType: StatType): void;
  onOpenDeathLog(): void;
  onOpenPlayerDetails(rowId: string, selectedEnemyIds: number[]): void;
}

function activateRow(event: JSX.TargetedKeyboardEvent<HTMLTableRowElement>, activate: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function navigateBackOnMiddleClick(event: JSX.TargetedMouseEvent<HTMLElement>, onBack: () => void): void {
  if (event.button !== 1) return;
  event.preventDefault();
  onBack();
}

function preventMiddleMouseDefault(event: JSX.TargetedMouseEvent<HTMLElement>): void {
  if (event.button === 1) event.preventDefault();
}

export function PastAnalysisPanel({
  state,
  onBack,
  onSelectEncounter,
  onSetStatType,
  onOpenDeathLog,
  onOpenPlayerDetails,
}: PastAnalysisPanelProps) {
  const [selectedEnemyIds, setSelectedEnemyIds] = useState<Set<number>>(new Set());
  const [playerSort, setPlayerSort] = useState<TableSort<PlayerSortKey>>({ key: "damage", direction: "descending" });
  const lastEncounterId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (state.selectedEncounterId !== lastEncounterId.current) {
      lastEncounterId.current = state.selectedEncounterId;
      setSelectedEnemyIds(new Set());
    }
  }, [state.selectedEncounterId]);

  const activeSnapshot: MeterEncounterSnapshot | undefined =
    state.statType === "tanked" ? state.tankedSnapshot :
    state.statType === "heal" ? state.healSnapshot :
    state.snapshot;
  const metricLabel = state.statType === "tanked" ? "TPS" : state.statType === "heal" ? "HPS" : "DPS";
  const damageLabel = state.statType === "tanked" ? "Damage taken" : state.statType === "heal" ? "Healing" : "Damage";
  const rows = activeSnapshot?.actors ?? [];
  const filteredRows = applyEnemyFilter(state, rows, selectedEnemyIds);
  const sortedRows = sortTableRows(
    filteredRows,
    playerSort,
    (row, key) => key === "kills" ? row.actor.kills : row[key],
    (left, right) => left.actor.displayName.localeCompare(right.actor.displayName),
  );
  const sortPlayersBy = (key: PlayerSortKey): void => {
    setPlayerSort((current) => nextTableSort(current, key));
  };
  const hasFilter = enemyFilterSupported(state.statType) && selectedEnemyIds.size > 0;
  const partyDamage = hasFilter ? filteredRows.reduce((sum, row) => sum + row.damage, 0) : (activeSnapshot?.totalDamage ?? 0);
  const partyDps = hasFilter
    ? (activeSnapshot ? partyDamage / (Math.max(1, activeSnapshot.durationMs) / 1000) : 0)
    : (activeSnapshot?.partyDps ?? 0);

  return (
    <section
      class="past-analysis-panel"
      onMouseDown={preventMiddleMouseDefault}
      onAuxClick={(event) => navigateBackOnMiddleClick(event, onBack)}
    >
      <section class="toolbar">
        <button class="btn back-button" type="button" onClick={onBack}>← Back</button>
        <label class="encounter-picker">
          <span class="t-label">Encounter</span>
          <CustomSelect
            ariaLabel="Encounter"
            disabled={state.status !== "ready" || state.encounters.length < 2}
            value={state.selectedEncounterId ?? ""}
            options={state.encounters.map((encounter) => ({ value: encounter.id, label: encounter.label }))}
            onChange={onSelectEncounter}
          />
        </label>
        <StatTypeSelect value={state.statType} onChange={onSetStatType} disabled={state.status !== "ready"} />
        <EnemyFilterControl
          enemies={state.statType === "tanked" ? state.tankedEnemies : state.statType === "damage" ? state.enemies : []}
          selected={selectedEnemyIds}
          onChange={setSelectedEnemyIds}
        />
        <div class="toolbar-meta">
          <button class="btn" type="button" disabled={state.status !== "ready"} onClick={onOpenDeathLog}>Death log</button>
        </div>
      </section>
      <p class="analysis-status" aria-live="polite">{state.statusDetail}</p>
      <p class="banner is-warn" hidden={state.invalidLines === 0}>
        {state.invalidLines === 0 ? "" : `${state.invalidLines} malformed record${state.invalidLines === 1 ? " was" : "s were"} skipped.`}
      </p>
      <div class="table-scroll totals">
        <table class="data-table summary-table" aria-label="Past encounter totals">
          <thead><tr><th>Party {metricLabel}</th><th>Total {damageLabel.toLowerCase()}</th><th>Duration</th><th>Players</th></tr></thead>
          <tbody><tr>
            <td>{numberFormat.format(partyDps)}</td>
            <td>{compactFormat.format(partyDamage)}</td>
            <td>{activeSnapshot ? formatDuration(activeSnapshot.durationMs) : "—"}</td>
            <td>{numberFormat.format(hasFilter ? filteredRows.length : rows.length)}</td>
          </tr></tbody>
        </table>
      </div>
      <section class="players-section" aria-label="Player analysis">
        <div class="section-head"><h1>Player {damageLabel.toLowerCase()}</h1><p>Double-click a player for skills and damage over time.</p></div>
        {filteredRows.length > 0 && <div class="table-scroll">
          <table class="data-table combat-table player-combat-table" aria-label={`Player ${damageLabel.toLowerCase()}`}>
            <thead><tr>
              <th>Class</th>
              <th>Player</th>
              <SortableHeader sortKey="damage" sort={playerSort} onSort={sortPlayersBy}>{damageLabel}</SortableHeader>
              <SortableHeader sortKey="dps" sort={playerSort} onSort={sortPlayersBy}>{metricLabel}</SortableHeader>
              <SortableHeader sortKey="contribution" sort={playerSort} onSort={sortPlayersBy}>Share</SortableHeader>
              <SortableHeader sortKey="hits" sort={playerSort} onSort={sortPlayersBy}>Hits</SortableHeader>
              <SortableHeader sortKey="criticalHits" sort={playerSort} onSort={sortPlayersBy}>Crits</SortableHeader>
              <SortableHeader sortKey="critRate" sort={playerSort} onSort={sortPlayersBy}>Crit rate</SortableHeader>
              <SortableHeader sortKey="kills" sort={playerSort} onSort={sortPlayersBy}>Kills</SortableHeader>
            </tr></thead>
            <tbody>{sortedRows.map(({ actor, damage, dps, hits, criticalHits, critRate, contribution }) => {
              const activate = () => onOpenPlayerDetails(actor.rowId, [...selectedEnemyIds]);
              return <tr
                key={actor.rowId}
                class="player-row"
                title="Double-click for player detail"
                tabIndex={0}
                onDblClick={activate}
                onKeyDown={(event) => activateRow(event, activate)}
              >
                <CombatClassCell archetype={actor.archetype} />
                <th scope="row">{actor.displayName}</th>
                <td>{compactFormat.format(damage)}</td>
                <td>{numberFormat.format(dps)}</td>
                <td>{percentFormat.format(contribution)}</td>
                <td>{numberFormat.format(hits)}</td>
                <td>{numberFormat.format(criticalHits)}</td>
                <td>{critRate === undefined ? "—" : percentFormat.format(critRate)}</td>
                <td>{numberFormat.format(actor.kills)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {state.status === "ready" && rows.length === 0 && (
          <p class="empty-state">No {damageLabel.toLowerCase()} was found for this encounter.</p>
        )}
      </section>
    </section>
  );
}
