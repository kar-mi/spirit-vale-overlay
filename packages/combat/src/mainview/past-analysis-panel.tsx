import { useTranslator } from "@svoverlay/i18n/browser";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatCompact, formatDuration, formatInteger, formatPercent } from "@svoverlay/ui-kit/format";
import { EnemyFilterControl } from "@svoverlay/ui-kit/enemy-filter";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";

import type { CombatAnalysisState, MeterEncounterSnapshot, StatType } from "../app-types.ts";
import { CombatClassCell } from "../combat-class.tsx";
import { nextTableSort, SortableHeader, sortTableRows, type TableSort } from "@svoverlay/ui-kit/sortable-table";
import { applyEnemyFilter, enemyFilterSupported } from "../enemy-filtering.ts";

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
  const lastScope = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Enemy ids are not comparable across encounters or between the DPS and TPS attacker lists,
    // so a stale selection would hide rows or show an invisible pick — clear it on either change.
    const scope = `${state.selectedEncounterId ?? ""}:${state.statType}`;
    if (scope !== lastScope.current) {
      lastScope.current = scope;
      setSelectedEnemyIds(new Set());
    }
  }, [state.selectedEncounterId, state.statType]);

  const activeSnapshot: MeterEncounterSnapshot | undefined =
    state.statType === "tanked" ? state.tankedSnapshot :
    state.statType === "heal" ? state.healSnapshot :
    state.snapshot;
  const metricLabel = state.statType === "tanked" ? "TPS" : state.statType === "heal" ? "HPS" : "DPS";
  const t = useTranslator();
  const damageLabel = state.statType === "tanked" ? t("amount.damageTaken") : state.statType === "heal" ? t("amount.healing") : t("amount.damage");
  const amount = damageLabel.toLocaleLowerCase();
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
        <button class="btn back-button" type="button" onClick={onBack}>{t("combat.past.back")}</button>
        <label class="encounter-picker">
          <span class="t-label">{t("combat.past.encounter")}</span>
          <CustomSelect
            ariaLabel={t("combat.past.encounter")}
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
          <button class="btn" type="button" disabled={state.status !== "ready"} onClick={onOpenDeathLog}>{t("combat.past.deathLog")}</button>
        </div>
      </section>
      <p class="analysis-status" aria-live="polite">{[t.text(state.statusDetail), t.text(state.statusDetailExtra)].filter(Boolean).join(" · ")}</p>
      <p class="banner is-warn" hidden={state.invalidLines === 0}>
        {state.invalidLines === 0 ? "" : t.plural("common.malformedRecords", state.invalidLines)}
      </p>
      <div class="table-scroll totals">
        <table class="data-table summary-table" aria-label={t("combat.past.totals.label")}>
          <thead><tr><th>{t("combat.past.totals.party", { metric: metricLabel })}</th><th>{t("combat.past.totals.total", { amount })}</th><th>{t("combat.past.totals.duration")}</th><th>{t("combat.past.totals.players")}</th></tr></thead>
          <tbody><tr>
            <td>{formatInteger(partyDps)}</td>
            <td>{formatCompact(partyDamage)}</td>
            <td>{activeSnapshot ? formatDuration(activeSnapshot.durationMs) : "—"}</td>
            <td>{formatInteger(hasFilter ? filteredRows.length : rows.length)}</td>
          </tr></tbody>
        </table>
      </div>
      <section class="players-section" aria-label={t("combat.past.players.label")}>
        <div class="section-head"><h1>{t("combat.past.players.heading", { amount })}</h1><p>{t("combat.past.players.hint")}</p></div>
        {filteredRows.length > 0 && <div class="table-scroll">
          <table class="data-table combat-table player-combat-table" aria-label={t("combat.past.players.heading", { amount })}>
            <thead><tr>
              <th>{t("combat.column.class")}</th>
              <th>{t("combat.column.player")}</th>
              <SortableHeader sortKey="damage" sort={playerSort} onSort={sortPlayersBy}>{damageLabel}</SortableHeader>
              <SortableHeader sortKey="dps" sort={playerSort} onSort={sortPlayersBy}>{metricLabel}</SortableHeader>
              <SortableHeader sortKey="contribution" sort={playerSort} onSort={sortPlayersBy}>{t("combat.column.share")}</SortableHeader>
              <SortableHeader sortKey="hits" sort={playerSort} onSort={sortPlayersBy}>{t("combat.column.hits")}</SortableHeader>
              <SortableHeader sortKey="criticalHits" sort={playerSort} onSort={sortPlayersBy}>{t("combat.column.crits")}</SortableHeader>
              <SortableHeader sortKey="critRate" sort={playerSort} onSort={sortPlayersBy}>{t("combat.column.critRateLong")}</SortableHeader>
              <SortableHeader sortKey="kills" sort={playerSort} onSort={sortPlayersBy}>{t("combat.column.kills")}</SortableHeader>
            </tr></thead>
            <tbody>{sortedRows.map(({ actor, damage, dps, hits, criticalHits, critRate, contribution }) => {
              const activate = () => onOpenPlayerDetails(actor.rowId, [...selectedEnemyIds]);
              return <tr
                key={actor.rowId}
                class="player-row"
                title={t("combat.past.players.rowHint")}
                tabIndex={0}
                onDblClick={activate}
                onKeyDown={(event) => activateRow(event, activate)}
              >
                <CombatClassCell archetype={actor.archetype} />
                <th scope="row">{actor.displayName}</th>
                <td>{formatCompact(damage)}</td>
                <td>{formatInteger(dps)}</td>
                <td>{formatPercent(contribution)}</td>
                <td>{formatInteger(hits)}</td>
                <td>{formatInteger(criticalHits)}</td>
                <td>{critRate === undefined ? "—" : formatPercent(critRate)}</td>
                <td>{formatInteger(actor.kills)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {state.status === "ready" && rows.length === 0 && (
          <p class="empty-state">{t("combat.past.players.empty", { amount })}</p>
        )}
      </section>
    </section>
  );
}
