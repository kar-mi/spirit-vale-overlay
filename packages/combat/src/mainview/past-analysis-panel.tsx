import { useEffect, useRef, useState } from "preact/hooks";
import { activateOnEnterOrSpace } from "@svoverlay/ui-kit/keyboard";
import { formatDuration } from "@svoverlay/ui-kit/format";
import { EnemyFilterControl } from "@svoverlay/ui-kit/enemy-filter";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";
import { meterLabels } from "@svoverlay/ui-kit/meter-labels";

import type { CombatAnalysisState, MeterActorRow, MeterEncounterSnapshot, StatType } from "../app-types.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

interface FilteredRow {
  actor: MeterActorRow;
  damage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
  contribution: number;
}

interface PastAnalysisPanelProps {
  state: CombatAnalysisState;
  onBack(): void;
  onSelectEncounter(id: string): void;
  onSetStatType(statType: StatType): void;
  onOpenDeathLog(): void;
  onOpenPlayerDetails(actorId: number, selectedEnemyIds: number[]): void;
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
  const durationSeconds = Math.max(1, next.snapshot?.durationMs ?? 0) / 1000;
  const partial = rows.map((actor) => {
    const filtered = (next.actorEnemyBreakdown[actor.actorIds[0]!] ?? [])
      .filter((row) => selectedEnemyIds.has(row.targetId));
    const damage = filtered.reduce((sum, row) => sum + row.damage, 0);
    const hits = filtered.reduce((sum, row) => sum + row.hits, 0);
    const criticalHits = filtered.reduce((sum, row) => sum + row.criticalHits, 0);
    return { actor, damage, hits, criticalHits, dps: damage / durationSeconds, critRate: hits > 0 ? criticalHits / hits : undefined };
  });
  const totalDamage = partial.reduce((sum, row) => sum + row.damage, 0);
  return partial.map((row) => ({ ...row, contribution: totalDamage > 0 ? row.damage / totalDamage : 0 }));
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
  const labels = meterLabels(state.statType);
  const metricLabel = labels.rate;
  const damageLabel = labels.amount;
  const rows = activeSnapshot?.actors ?? [];
  const filteredRows = applyEnemyFilter(state, rows, selectedEnemyIds);
  const hasFilter = state.statType === "damage" && selectedEnemyIds.size > 0;
  const partyDamage = hasFilter ? filteredRows.reduce((sum, row) => sum + row.damage, 0) : (activeSnapshot?.totalDamage ?? 0);
  const partyDps = hasFilter
    ? (activeSnapshot ? partyDamage / (Math.max(1, activeSnapshot.durationMs) / 1000) : 0)
    : (activeSnapshot?.partyDps ?? 0);

  return (
    <section class="past-analysis-panel">
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
        <EnemyFilterControl enemies={state.statType === "damage" ? state.enemies : []} selected={selectedEnemyIds} onChange={setSelectedEnemyIds} />
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
            <td>{numberFormat.format(rows.length)}</td>
          </tr></tbody>
        </table>
      </div>
      <section class="players-section" aria-label="Player analysis">
        <div class="section-head"><h1>Player {damageLabel.toLowerCase()}</h1><p>Double-click a player for skills and damage over time.</p></div>
        {filteredRows.length > 0 && <div class="table-scroll">
          <table class="data-table combat-table" aria-label={`Player ${damageLabel.toLowerCase()}`}>
            <thead><tr><th>Player</th><th>{damageLabel}</th><th>{metricLabel}</th><th>Share</th><th>Hits</th><th>Crits</th><th>Crit rate</th><th>Kills</th></tr></thead>
            <tbody>{filteredRows.map(({ actor, damage, dps, hits, criticalHits, critRate, contribution }) => {
              const activate = () => onOpenPlayerDetails(actor.actorIds[0]!, [...selectedEnemyIds]);
              return <tr
                key={actor.actorIds[0]}
                class="player-row"
                title="Double-click for player detail"
                tabIndex={0}
                onDblClick={activate}
                onKeyDown={(event) => activateOnEnterOrSpace(event, activate)}
              >
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
