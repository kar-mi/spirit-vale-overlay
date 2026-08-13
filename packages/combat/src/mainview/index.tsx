import { render } from "preact";
import { useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { DesktopTitleBar } from "@svoverlay/ui-kit/desktop-title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { StatusDot } from "@svoverlay/ui-kit/status-dot";
import type { StatusTone } from "@svoverlay/ui-kit/status-dot";
import { formatDps, formatDuration } from "@svoverlay/ui-kit/format";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { StatTypeSelect } from "@svoverlay/ui-kit/stat-type-select";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { activateOnEnterOrSpace } from "@svoverlay/ui-kit/keyboard";
import { SortableHeader as SharedSortableHeader } from "@svoverlay/ui-kit/sortable-header";
import { meterLabels } from "@svoverlay/ui-kit/meter-labels";

import type { CombatLogScreen, DpsAppRpc, DpsAppState, DpsAppTab, MeterEncounterSnapshot, StatType } from "../app-types.ts";
import { PastSessionPanel } from "./past-session-panel.tsx";
import { PastAnalysisPanel } from "./past-analysis-panel.tsx";
import { formatZone } from "../zone-label.ts";
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
type SortDirection = "ascending" | "descending";
interface ActorSort { key: ActorSortKey; direction: SortDirection }

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

function actorSortValue(actor: MeterEncounterSnapshot["actors"][number], key: ActorSortKey): number {
  if (key === "critRate") return actor.critRate ?? 0;
  return actor[key];
}

function App() {
  const next = state.value;
  const [actorSort, setActorSort] = useState<ActorSort>({ key: "dps", direction: "descending" });

  if (!next) return <main class="app-shell" />;

  const activeSnapshot: MeterEncounterSnapshot | undefined =
    next.statType === "tanked" ? next.tankedSnapshot :
    next.statType === "heal" ? next.healSnapshot :
    next.snapshot;
  const labels = meterLabels(next.statType);
  const metricLabel = labels.rate;
  const isHeal = next.statType === "heal";
  const amountLabel = labels.shortAmount;

  const actors = activeSnapshot?.actors ?? [];
  const sortedActors = [...actors].sort((left, right) => {
    const difference = actorSortValue(left, actorSort.key) - actorSortValue(right, actorSort.key);
    if (difference !== 0) return actorSort.direction === "ascending" ? difference : -difference;
    return left.displayName.localeCompare(right.displayName);
  });
  const sortActorsBy = (key: ActorSortKey): void => {
    setActorSort((current) => ({
      key,
      direction: current.key === key && current.direction === "descending" ? "ascending" : "descending",
    }));
  };
  const personalSkills = activeSnapshot?.personal?.skills ?? [];
  const personalMatch = activeSnapshot?.personalMatch ?? (next.personalName ? "missing" : "unconfigured");
  const allActive = next.tab === "all";

  return (
    <main class="app-shell">
      <DesktopTitleBar
        appTag="DPS"
        minWidth={DPS_WINDOW_MINIMUM_WIDTH}
        minHeight={DPS_WINDOW_MINIMUM_HEIGHT}
        defaultWidth={DPS_WINDOW_DEFAULT_WIDTH}
        defaultHeight={DPS_WINDOW_DEFAULT_HEIGHT}
        requests={electroview.rpc?.request}
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
                  <th>IGN</th>
                  <SortableHeader label={metricLabel} sortKey="dps" sort={actorSort} onSort={sortActorsBy} />
                  <SortableHeader label={amountLabel} sortKey="damage" sort={actorSort} onSort={sortActorsBy} />
                  <SortableHeader label={`${amountLabel} %`} sortKey="contribution" sort={actorSort} onSort={sortActorsBy} />
                  <SortableHeader label="CRT %" sortKey="critRate" sort={actorSort} onSort={sortActorsBy} />
                  <SortableHeader label="Kills" sortKey="kills" sort={actorSort} onSort={sortActorsBy} />
                  <SortableHeader label="Mobs hit" sortKey="mobsHit" sort={actorSort} onSort={sortActorsBy} />
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
                    onKeyDown={(event) => activateOnEnterOrSpace(event, activate)}
                  >
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
                <thead><tr><th>{next.statType === "tanked" ? "Attacker skill" : "Skill"}</th><th>{metricLabel}</th><th>{amountLabel}</th><th>Share</th><th>Hits</th><th>Crits</th><th>Crit rate</th></tr></thead>
                <tbody>{personalSkills.map((skill) => (
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

interface SortableHeaderProps {
  label: string;
  sortKey: ActorSortKey;
  sort: ActorSort;
  onSort(key: ActorSortKey): void;
}

function SortableHeader({ label, sortKey, sort, onSort }: SortableHeaderProps) {
  const active = sort.key === sortKey;
  return <SharedSortableHeader label={label} active={active} direction={sort.direction} onSort={() => onSort(sortKey)} />;
}

render(<App />, document.getElementById("root")!);
