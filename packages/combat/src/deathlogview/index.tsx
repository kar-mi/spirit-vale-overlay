import { render } from "preact";
import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { formatDuration, normalizeSearchText } from "@svoverlay/ui-kit/format";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type { CombatDeathLogRpc, CombatDeathLogState } from "../app-types.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const state = signal<CombatDeathLogState | undefined>(undefined);
type DeathLogTab = "summary" | "list";

const rpc = DesktopView.defineRPC<CombatDeathLogRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const desktopView = new DesktopView({ rpc });
void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const DEATH_LOG_DEFAULT_WIDTH = 900;
const DEATH_LOG_DEFAULT_HEIGHT = 680;
void ensureInitialWindowSize(desktopView.rpc?.request, { width: 680, height: 500 });

function App() {
  const next = state.value;
  const [tab, setTab] = useState<DeathLogTab>("summary");
  const [victimQuery, setVictimQuery] = useState("");
  if (!next) return <main class="app-shell" />;
  const selected = next.deaths.find((death) => death.id === next.selectedDeathId) ?? next.deaths[0];
  const needle = normalizeSearchText(victimQuery);
  const visibleDeaths = needle ? next.deaths.filter((death) => normalizeSearchText(death.victimName).includes(needle)) : next.deaths;
  const attackerLabels = numberedMonsterLabels(next);
  const summary = summarize(selected === undefined ? [] : [selected], attackerLabels);
  return <main class="app-shell">
    <TitleBar
      appTag="Death log"
      minWidth={680}
      minHeight={500}
      getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: DEATH_LOG_DEFAULT_WIDTH, height: DEATH_LOG_DEFAULT_HEIGHT }}
      setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
      extraControls={<SettingsButton onClick={() => void desktopView.rpc?.request.openSettings({})} />}
    />
    <section class="death-log-content">
      <section class="toolbar">
        <div><h1>Player deaths</h1><p>{next.fileName}</p></div>
        <span class="pill">{next.deaths.length} death{next.deaths.length === 1 ? "" : "s"}</span>
      </section>
      {next.invalidLines > 0 && <p class="banner is-warn">{next.invalidLines} malformed record{next.invalidLines === 1 ? " was" : "s were"} skipped.</p>}
      {next.deaths.length === 0 ? <p class="empty-state">No player deaths were found in this log.</p> : <>
        <section class="death-list-section">
          <div class="section-head">
            <div><h2>Deaths</h2><p>Most recent first.</p></div>
            <label class="field" for="death-victim-query">
              <span aria-hidden="true">⌕</span>
              <input
                id="death-victim-query"
                type="search"
                autocomplete="off"
                placeholder="Search player"
                value={victimQuery}
                onInput={(event) => setVictimQuery((event.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          <div class="table-scroll death-list-scroll">
            <table class="data-table death-table" aria-label="Player deaths"><thead><tr><th>Player</th><th>Damage</th><th>Hits</th></tr></thead>
              <tbody>{visibleDeaths.map((death) => <tr key={death.id} class={death.id === selected?.id ? "selected" : undefined} onClick={() => void desktopView.rpc?.request.selectDeath({ id: death.id })}>
                <th scope="row">{death.victimName}</th><td>{compactFormat.format(death.totalDamage)}</td><td>{numberFormat.format(death.hits.length)}</td>
              </tr>)}</tbody>
            </table>
            {visibleDeaths.length === 0 && <p class="empty-state">No deaths match "{victimQuery}".</p>}
          </div>
        </section>
        {selected && <section class="death-detail-section">
          <div class="section-head"><div><h2>{selected.victimName}</h2><p>Damage received during the 10 seconds before death.</p></div><span class="pill">{compactFormat.format(selected.totalDamage)} damage</span></div>
          <nav class="seg tabs" role="tablist" aria-label="Selected death views">
            <button type="button" role="tab" aria-controls="summary-panel" class={tab === "summary" ? "active" : undefined} aria-selected={tab === "summary"} onClick={() => setTab("summary")}>Summary</button>
            <button type="button" role="tab" aria-controls="list-panel" class={tab === "list" ? "active" : undefined} aria-selected={tab === "list"} onClick={() => setTab("list")}>Death list</button>
          </nav>
          <section id="summary-panel" role="tabpanel" hidden={tab !== "summary"}>
            <div class="table-scroll"><table class="data-table death-table" aria-label="Death damage summary"><thead><tr><th>Attacker</th><th>Source</th><th>Damage</th><th>Hits</th><th>Crits</th></tr></thead>
              <tbody>{summary.map((row) => <tr key={row.key}><th scope="row">{row.attackerLabel}</th><td>{row.sourceLabel}</td><td>{compactFormat.format(row.damage)}</td><td>{numberFormat.format(row.hits)}</td><td>{numberFormat.format(row.criticalHits)}</td></tr>)}</tbody>
            </table></div>
          </section>
          <section id="list-panel" role="tabpanel" hidden={tab !== "list"}>
            <div class="table-scroll"><table class="data-table death-table" aria-label="Damage before death"><thead><tr><th>Before death</th><th>Source</th><th>Attacker</th><th>Damage</th><th>Hit</th></tr></thead>
              <tbody>{selected.hits.map((hit) => <tr key={hit.id}><td>{hit.beforeDeathMs === 0 ? "Death" : `${formatDuration(hit.beforeDeathMs)} before`}</td><th scope="row">{hit.sourceLabel}</th><td>{attackerLabels.get(hit.attackerActorId) ?? hit.attackerLabel}</td><td>{numberFormat.format(hit.damage)}</td><td>{hit.critical ? "Critical" : "Normal"}</td></tr>)}</tbody>
            </table></div>
            {selected.hits.length === 0 && <p class="empty-state">No positive damage was captured in the preceding 10 seconds.</p>}
          </section>
        </section>}
      </>}
    </section>
  </main>;
}

function numberedMonsterLabels(state: CombatDeathLogState): Map<number, string> {
  const monstersByName = new Map<string, Set<number>>();
  for (const death of state.deaths) for (const hit of death.hits) {
    if (!hit.attackerIsMonster) continue;
    const ids = monstersByName.get(hit.attackerLabel) ?? new Set<number>();
    ids.add(hit.attackerActorId);
    monstersByName.set(hit.attackerLabel, ids);
  }
  const labels = new Map<number, string>();
  for (const [name, ids] of monstersByName) {
    const ordered = [...ids].sort((left, right) => left - right);
    for (const [index, actorId] of ordered.entries()) labels.set(actorId, ordered.length > 1 ? `${name} (${index + 1})` : name);
  }
  return labels;
}

function summarize(deaths: readonly NonNullable<CombatDeathLogState["deaths"]>[number][], attackerLabels: ReadonlyMap<number, string>): Array<{ key: string; attackerLabel: string; sourceLabel: string; damage: number; hits: number; criticalHits: number }> {
  const rows = new Map<string, { key: string; attackerLabel: string; sourceLabel: string; damage: number; hits: number; criticalHits: number; deathIds: Set<string> }>();
  for (const death of deaths) for (const hit of death.hits) {
    const attackerLabel = attackerLabels.get(hit.attackerActorId) ?? hit.attackerLabel;
    const key = `${hit.attackerActorId}\u0000${hit.sourceLabel}`;
    const row = rows.get(key) ?? { key, attackerLabel, sourceLabel: hit.sourceLabel, damage: 0, hits: 0, criticalHits: 0, deathIds: new Set<string>() };
    row.damage += hit.damage;
    row.hits += 1;
    if (hit.critical) row.criticalHits += 1;
    row.deathIds.add(death.id);
    rows.set(key, row);
  }
  return [...rows.values()]
    .map(({ deathIds: _deathIds, ...row }) => row)
    .sort((left, right) => right.damage - left.damage || left.attackerLabel.localeCompare(right.attackerLabel) || left.sourceLabel.localeCompare(right.sourceLabel));
}

render(<App />, document.getElementById("root")!);
