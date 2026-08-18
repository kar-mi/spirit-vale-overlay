import { render } from "preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { StatusDot } from "@svoverlay/ui-kit/status-dot";
import type { StatusTone } from "@svoverlay/ui-kit/status-dot";
import { formatDps, formatDuration } from "@svoverlay/ui-kit/format";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type { CombatLogScreen, DpsAppRpc, DpsAppState, DpsAppTab, MeterEncounterSnapshot, StatType } from "../app-types.ts";
import { PastSessionPanel } from "./past-session-panel.tsx";
import { PastAnalysisPanel } from "./past-analysis-panel.tsx";
import { formatZone } from "../zone-label.ts";
import { CombatClassCell } from "../combat-class.tsx";
import { nextTableSort, SortableHeader, sortTableRows, type TableSort } from "@svoverlay/ui-kit/sortable-table";
import {
  DPS_WINDOW_DEFAULT_HEIGHT,
  DPS_WINDOW_DEFAULT_WIDTH,
  DPS_WINDOW_MINIMUM_HEIGHT,
  DPS_WINDOW_MINIMUM_WIDTH,
} from "../window-size.ts";

const STATUS_TONE: Record<DpsAppState["status"], StatusTone> = {
  waiting: "is-warn",
  capturing: "is-ok",
  loading: "is-warn",
  ready: "is-ok",
  stopped: "is-warn",
  error: "is-err",
};

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

type ActorSortKey = "dps" | "damage" | "contribution" | "critRate" | "kills" | "mobsHit";
type SkillSortKey = "sourceLabel" | "dps" | "damage" | "contribution" | "hits" | "criticalHits" | "critRate";

const state = signal<DpsAppState | undefined>(undefined);

const rpc = Electroview.defineRPC<DpsAppRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });
void ensureInitialWindowSize(electroview.rpc?.request, { width: DPS_WINDOW_MINIMUM_WIDTH, height: DPS_WINDOW_MINIMUM_HEIGHT });

function setTab(tab: DpsAppTab): void {
  if (state.value) state.value = { ...state.value, tab };
  void electroview.rpc?.request.setTab({ tab });
}

function setScreen(screen: CombatLogScreen): void {
  if (state.value) state.value = { ...state.value, screen };
  void electroview.rpc?.request.setScreen({ screen });
}

function activateRow(event: JSX.TargetedKeyboardEvent<HTMLTableRowElement>, activate: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function setStatType(statType: StatType): void {
  if (state.value) state.value = { ...state.value, statType };
  void electroview.rpc?.request.setStatType({ statType });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCritRate(critRate: number | undefined): string {
  return critRate === undefined ? "—" : formatPercent(critRate);
}

function App() {
  const next = state.value;
  const [actorSort, setActorSort] = useState<TableSort<ActorSortKey>>({ key: "dps", direction: "descending" });
  const [skillSort, setSkillSort] = useState<TableSort<SkillSortKey>>({ key: "damage", direction: "descending" });

  if (!next) return <main class="app-shell" />;

  const activeSnapshot: MeterEncounterSnapshot | undefined =
    next.statType === "tanked" ? next.tankedSnapshot :
    next.statType === "heal" ? next.healSnapshot :
    next.snapshot;
  const metricLabel = next.statType === "tanked" ? "TPS" : next.statType === "heal" ? "HPS" : "DPS";
  const isHeal = next.statType === "heal";
  const amountLabel = isHeal ? "HEAL" : "DMG";

  const actors = activeSnapshot?.actors ?? [];
  const sortedActors = sortTableRows(
    actors,
    actorSort,
    (actor, key) => actor[key],
    (left, right) => left.displayName.localeCompare(right.displayName),
  );
  const sortActorsBy = (key: ActorSortKey): void => {
    setActorSort((current) => nextTableSort(current, key));
  };
  const personalSkills = activeSnapshot?.personal?.skills ?? [];
  const sortedPersonalSkills = sortTableRows(
    personalSkills,
    skillSort,
    (skill, key) => skill[key],
    (left, right) => left.sourceLabel.localeCompare(right.sourceLabel),
  );
  const sortSkillsBy = (key: SkillSortKey): void => {
    setSkillSort((current) => nextTableSort(current, key, key === "sourceLabel" ? "ascending" : "descending"));
  };
  const personalMatch = activeSnapshot?.personalMatch ?? (next.personalName ? "missing" : "unconfigured");
  const allActive = next.tab === "all";

  return (
    <main class="app-shell">
      <TitleBar
        appTag="DPS"
        minWidth={DPS_WINDOW_MINIMUM_WIDTH}
        minHeight={DPS_WINDOW_MINIMUM_HEIGHT}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? {
          x: 0,
          y: 0,
          width: DPS_WINDOW_DEFAULT_WIDTH,
          height: DPS_WINDOW_DEFAULT_HEIGHT,
        }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
        extraControls={<SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />}
      />

      <nav class="seg log-tabs" role="tablist" aria-label="Combat log source">
        <button type="button" role="tab" aria-selected={next.screen === "live"} class={next.screen === "live" ? "active" : undefined} onClick={() => setScreen("live")}>Live</button>
        <button type="button" role="tab" aria-selected={next.screen === "past"} class={next.screen === "past" ? "active" : undefined} onClick={() => setScreen("past")}>Past Log</button>
      </nav>

      {next.screen === "live" ? <section class="live-screen">
      <section class="command-bar">
        <StatTypeSelect value={next.statType} onChange={setStatType} />
        <div class="command-bar-actions">
          {next.location !== undefined && <span class="zone-pill" title={`Current zone: ${formatZone(next.location)}`}>{formatZone(next.location)}</span>}
          <button class="btn" type="button" disabled={!next.liveDeathLogAvailable} onClick={() => void electroview.rpc?.request.openActiveDeathLog({})}>Death log</button>
          <button class="btn" type="button" disabled={next.resetting} onClick={() => void electroview.rpc?.request.resetSession({})}>Reset</button>
        </div>
      </section>

      <section class="status-strip" aria-live="polite">
        <StatusDot tone={STATUS_TONE[next.status]} detail={next.statusDetail} />
        <div class="table-scroll summary-table-scroll">
          <table class="data-table summary-table" aria-label="Encounter totals">
            <thead><tr><th>Timer</th><th>Encounter {metricLabel}</th><th>{next.statType === "tanked" ? "Total damage taken" : next.statType === "heal" ? "Total healing" : "Total damage"}</th><th>Total kills</th></tr></thead>
            <tbody><tr>
              <td>{activeSnapshot ? formatDuration(activeSnapshot.durationMs) : "—"}</td>
              <td>{formatDps(activeSnapshot?.partyDps ?? 0)}</td>
              <td>{compactFormat.format(activeSnapshot?.totalDamage ?? 0)}</td>
              <td>{numberFormat.format(activeSnapshot?.actors.reduce((total, actor) => total + actor.kills, 0) ?? 0)}</td>
            </tr></tbody>
          </table>
        </div>
      </section>

      <div id="storage-warning" class="banner is-warn" aria-live="polite" hidden={next.storageWarning === undefined}>{next.storageWarning ?? ""}</div>

      <nav class="seg tabs" role="tablist" aria-label="Damage views">
        <button type="button" role="tab" aria-controls="all-panel" class={allActive ? "active" : undefined} aria-selected={allActive} onClick={() => setTab("all")}>All {metricLabel}</button>
        <button type="button" role="tab" aria-controls="personal-panel" class={allActive ? undefined : "active"} aria-selected={!allActive} onClick={() => setTab("personal")}>Personal</button>
      </nav>

      <section class="panel" role="tabpanel" hidden={!allActive}>
        {actors.length === 0
          ? <div class="empty-state">{isHeal ? "Healing will appear once someone casts a heal." : "Player damage will appear when combat begins and identities are visible."}</div>
          : <div class="table-scroll meter-table-scroll">
              <table class="data-table meter-table party-meter-table" aria-label="Party damage">
                <thead><tr>
                  <th>Class</th>
                  <th>IGN</th>
                  <SortableHeader sortKey="dps" sort={actorSort} onSort={sortActorsBy}>{metricLabel}</SortableHeader>
                  <SortableHeader sortKey="damage" sort={actorSort} onSort={sortActorsBy}>{amountLabel}</SortableHeader>
                  <SortableHeader sortKey="contribution" sort={actorSort} onSort={sortActorsBy}>{amountLabel} %</SortableHeader>
                  <SortableHeader sortKey="critRate" sort={actorSort} onSort={sortActorsBy}>CRT %</SortableHeader>
                  <SortableHeader sortKey="kills" sort={actorSort} onSort={sortActorsBy}>Kills</SortableHeader>
                  <SortableHeader sortKey="mobsHit" sort={actorSort} onSort={sortActorsBy}>Mobs hit</SortableHeader>
                </tr></thead>
                <tbody>{sortedActors.map((actor) => {
                  const activate = () => void electroview.rpc?.request.openPlayerDetails({
                    source: "live",
                    actorId: actor.actorIds[0]!,
                    selectedEnemyIds: [],
                  });
                  return (
                  <tr
                    key={actor.actorIds[0]}
                    class="meter-table-row live-player-row"
                    style={`--row-fill:${Math.max(0, Math.min(100, actor.contribution * 100))}%`}
                    title="Double-click for live player detail"
                    tabIndex={0}
                    onDblClick={activate}
                    onKeyDown={(event) => activateRow(event, activate)}
                  >
                    <CombatClassCell archetype={actor.archetype} />
                    <th scope="row">{actor.displayName}</th>
                    <td>{formatDps(actor.dps)}</td>
                    <td>{compactFormat.format(actor.damage)}</td>
                    <td>{formatPercent(actor.contribution)}</td>
                    <td>{formatCritRate(actor.critRate)}</td>
                    <td>{numberFormat.format(actor.kills)}</td>
                    <td>{numberFormat.format(actor.mobsHit)}</td>
                  </tr>
                  );
                })}</tbody>
              </table>
            </div>}
      </section>

      <section class="panel" role="tabpanel" hidden={allActive}>
        <div class="personal-form">
          <span class="t-label">Detected character</span>
          <p class="detected-character" aria-live="polite">{next.personalName || "Waiting for character detection…"}</p>
          <label class="t-label actor-label" for="personal-actor">Damage actor</label>
          <CustomSelect
            id="personal-actor"
            ariaLabel="Personal damage actor"
            value={next.personalActorId === undefined ? "auto" : String(next.personalActorId)}
            onChange={(value) => {
              void electroview.rpc?.request.setPersonalActor({ actorId: value === "auto" ? null : Number(value) });
            }}
            options={[
              { value: "auto", label: "Automatic (name or local actions)" },
              ...actors.flatMap((actor) => actor.actorIds.map((actorId) => ({
                value: String(actorId),
                label: `${actor.displayName} · ${compactFormat.format(actor.damage)} damage`,
              }))),
            ]}
          />
        </div>
        <p class="personal-hint">
          {personalMatch === "unconfigured"
            ? "Waiting to detect your active character."
            : personalMatch === "missing"
              ? `Waiting for ${next.personalName} to appear in the current encounter.`
              : personalMatch === "ambiguous"
                ? "More than one visible player matches this name."
                : "Matched to the current encounter."}
        </p>
        {personalSkills.length === 0
          ? <div class="empty-state">{personalMatch === "matched" ? "No personal skill damage yet." : "Personal skills appear after your character is matched."}</div>
          : <div class="table-scroll meter-table-scroll">
              <table class="data-table meter-table" aria-label="Personal skill damage">
                <thead><tr>
                  <SortableHeader sortKey="sourceLabel" sort={skillSort} onSort={sortSkillsBy} align="start">{next.statType === "tanked" ? "Attacker skill" : "Skill"}</SortableHeader>
                  <SortableHeader sortKey="dps" sort={skillSort} onSort={sortSkillsBy}>{metricLabel}</SortableHeader>
                  <SortableHeader sortKey="damage" sort={skillSort} onSort={sortSkillsBy}>{amountLabel}</SortableHeader>
                  <SortableHeader sortKey="contribution" sort={skillSort} onSort={sortSkillsBy}>Share</SortableHeader>
                  <SortableHeader sortKey="hits" sort={skillSort} onSort={sortSkillsBy}>Hits</SortableHeader>
                  <SortableHeader sortKey="criticalHits" sort={skillSort} onSort={sortSkillsBy}>Crits</SortableHeader>
                  <SortableHeader sortKey="critRate" sort={skillSort} onSort={sortSkillsBy}>Crit rate</SortableHeader>
                </tr></thead>
                <tbody>{sortedPersonalSkills.map((skill) => (
                  <tr key={skill.sourceId} class="meter-table-row" style={`--row-fill:${Math.max(0, Math.min(100, skill.contribution * 100))}%`}>
                    <th scope="row">{skill.sourceLabel}</th>
                    <td>{formatDps(skill.dps)}</td>
                    <td>{compactFormat.format(skill.damage)}</td>
                    <td>{formatPercent(skill.contribution)}</td>
                    <td>{numberFormat.format(skill.hits)}</td>
                    <td>{numberFormat.format(skill.criticalHits)}</td>
                    <td>{formatCritRate(skill.critRate)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>}
      </section>
      </section> : next.past.view === "selector"
        ? <PastSessionPanel
            state={next.past.picker}
            onRefresh={() => void electroview.rpc?.request.refreshPastSessions({})}
            onOpenSession={(id) => void electroview.rpc?.request.openPastSession({ id })}
            onChooseFile={() => void electroview.rpc?.request.choosePastFile({})}
            onOpenLogFolder={() => void electroview.rpc?.request.openPastLogFolder({})}
          />
        : <PastAnalysisPanel
            state={next.past.analysis}
            onBack={() => void electroview.rpc?.request.backToPastSessions({})}
            onSelectEncounter={(id) => void electroview.rpc?.request.selectPastEncounter({ id })}
            onSetStatType={(statType) => void electroview.rpc?.request.setPastStatType({ statType })}
            onOpenDeathLog={() => void electroview.rpc?.request.openActiveDeathLog({})}
            onOpenPlayerDetails={(actorId, selectedEnemyIds) => void electroview.rpc?.request.openPlayerDetails({
              source: "past",
              actorId,
              selectedEnemyIds,
            })}
          />}
    </main>
  );
}

render(<App />, document.getElementById("root")!);
