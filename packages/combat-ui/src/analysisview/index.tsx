import { render } from "preact";
import type { JSX } from "preact";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { formatDuration } from "@spiritvale/ui-core/format";

import type { CombatAnalysisRpc, CombatAnalysisState } from "../app-types.ts";

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

function App() {
  const next = state.value;
  if (!next) return <main class="app-shell" />;

  const rows = next.snapshot?.actors ?? [];

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
            <select
              class="input"
              aria-label="Encounter"
              disabled={next.status !== "ready" || next.encounters.length < 2}
              value={next.selectedEncounterId ?? ""}
              onChange={(event) => void electroview.rpc?.request.selectEncounter({ id: (event.target as HTMLSelectElement).value })}
            >
              {next.encounters.map((encounter) => <option key={encounter.id} value={encounter.id}>{encounter.label}</option>)}
            </select>
          </label>
          <div class="toolbar-meta">
            <span class="pill">{next.fileName ?? "Loading…"}</span>
            <span id="status" class="status-readout" aria-live="polite">{next.statusDetail}</span>
          </div>
        </section>
        <p id="warning" class="banner is-warn" hidden={next.invalidLines === 0}>
          {next.invalidLines === 0 ? "" : `${next.invalidLines} malformed record${next.invalidLines === 1 ? " was" : "s were"} skipped.`}
        </p>
        <div class="table-scroll totals">
          <table class="data-table summary-table" aria-label="Encounter totals">
            <thead><tr><th>Party DPS</th><th>Total damage</th><th>Duration</th><th>Players</th></tr></thead>
            <tbody><tr>
              <td>{numberFormat.format(next.snapshot?.partyDps ?? 0)}</td>
              <td>{compactFormat.format(next.snapshot?.totalDamage ?? 0)}</td>
              <td>{next.snapshot ? formatDuration(next.snapshot.durationMs) : "—"}</td>
              <td>{numberFormat.format(rows.length)}</td>
            </tr></tbody>
          </table>
        </div>
        <section class="players-section" aria-label="Player analysis">
          <div class="section-head"><h1>Player damage</h1><p>Double-click a player for skills and damage over time.</p></div>
          {rows.length > 0 && <div class="table-scroll">
            <table class="data-table combat-table" aria-label="Player damage">
              <thead><tr><th>Player</th><th>Damage</th><th>DPS</th><th>Share</th><th>Hits</th><th>Crits</th><th>Crit rate</th><th>Kills</th></tr></thead>
              <tbody>{rows.map((player) => {
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
                  <td>{compactFormat.format(player.damage)}</td>
                  <td>{numberFormat.format(player.dps)}</td>
                  <td>{percentFormat.format(player.contribution)}</td>
                  <td>{numberFormat.format(player.hits)}</td>
                  <td>{numberFormat.format(player.criticalHits)}</td>
                  <td>{player.critRate === undefined ? "—" : percentFormat.format(player.critRate)}</td>
                  <td>{numberFormat.format(player.kills)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
          {next.status === "ready" && rows.length === 0 && (
            <p id="empty-state" class="empty-state">No player damage was found for this encounter.</p>
          )}
        </section>
      </section>
    </main>
  );
}

render(<App />, document.getElementById("root")!);
