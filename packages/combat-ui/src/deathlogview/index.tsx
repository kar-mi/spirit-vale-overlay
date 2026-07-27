import { render } from "preact";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { formatDuration } from "@spiritvale/ui-core/format";

import type { CombatDeathLogRpc, CombatDeathLogState } from "../app-types.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const state = signal<CombatDeathLogState | undefined>(undefined);

const rpc = Electroview.defineRPC<CombatDeathLogRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function App() {
  const next = state.value;
  if (!next) return <main class="app-shell" />;
  const selected = next.deaths.find((death) => death.id === next.selectedDeathId) ?? next.deaths[0];
  return <main class="app-shell">
    <TitleBar
      appTag="Death log"
      minWidth={680}
      minHeight={500}
      getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 900, height: 680 }}
      setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
    />
    <section class="death-log-content">
      <section class="toolbar">
        <div><h1>Player deaths</h1><p>{next.fileName}</p></div>
        <span class="pill">{next.deaths.length} death{next.deaths.length === 1 ? "" : "s"}</span>
      </section>
      {next.invalidLines > 0 && <p class="banner is-warn">{next.invalidLines} malformed record{next.invalidLines === 1 ? " was" : "s were"} skipped.</p>}
      {next.deaths.length === 0 ? <p class="empty-state">No player deaths were found in this log.</p> : <div class="death-layout">
        <section class="death-list-section">
          <div class="section-head"><h2>Deaths</h2><p>Most recent first.</p></div>
          <div class="table-scroll">
            <table class="data-table death-table" aria-label="Player deaths"><thead><tr><th>Player</th><th>Damage</th><th>Hits</th></tr></thead>
              <tbody>{next.deaths.map((death) => <tr key={death.id} class={death.id === selected?.id ? "selected" : undefined} onClick={() => void electroview.rpc?.request.selectDeath({ id: death.id })}>
                <th scope="row">{death.victimName}</th><td>{compactFormat.format(death.totalDamage)}</td><td>{numberFormat.format(death.hits.length)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
        {selected && <section class="death-detail-section">
          <div class="section-head"><div><h2>{selected.victimName}</h2><p>Damage received during the 10 seconds before death.</p></div><span class="pill">{compactFormat.format(selected.totalDamage)} damage</span></div>
          <div class="table-scroll"><table class="data-table death-table" aria-label="Damage before death"><thead><tr><th>Before death</th><th>Source</th><th>Attacker</th><th>Damage</th><th>Hit</th></tr></thead>
            <tbody>{selected.hits.map((hit) => <tr key={hit.id}><td>{hit.beforeDeathMs === 0 ? "Death" : `${formatDuration(hit.beforeDeathMs)} before`}</td><th scope="row">{hit.sourceLabel}</th><td>{hit.attackerLabel}</td><td>{numberFormat.format(hit.damage)}</td><td>{hit.critical ? "Critical" : "Normal"}</td></tr>)}</tbody>
          </table></div>
          {selected.hits.length === 0 && <p class="empty-state">No positive damage was captured in the preceding 10 seconds.</p>}
        </section>}
      </div>}
    </section>
  </main>;
}

render(<App />, document.getElementById("root")!);
