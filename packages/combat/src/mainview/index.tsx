import { useTranslator } from "@svoverlay/i18n/browser";
import { render } from "preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
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

const rpc = DesktopView.defineRPC<DpsAppRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const desktopView = new DesktopView({ rpc });

void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });
void ensureInitialWindowSize(desktopView.rpc?.request, { width: DPS_WINDOW_MINIMUM_WIDTH, height: DPS_WINDOW_MINIMUM_HEIGHT });

function setTab(tab: DpsAppTab): void {
  if (state.value) state.value = { ...state.value, tab };
  void desktopView.rpc?.request.setTab({ tab });
}

function setScreen(screen: CombatLogScreen): void {
  if (state.value) state.value = { ...state.value, screen };
  void desktopView.rpc?.request.setScreen({ screen });
}

function activateRow(event: JSX.TargetedKeyboardEvent<HTMLTableRowElement>, activate: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function setStatType(statType: StatType): void {
  if (state.value) state.value = { ...state.value, statType };
  void desktopView.rpc?.request.setStatType({ statType });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCritRate(critRate: number | undefined): string {
  return critRate === undefined ? "—" : formatPercent(critRate);
}

function App() {
  const t = useTranslator();
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
  const isTanked = next.statType === "tanked";
  const amountLabel = isHeal ? "HEAL" : "DMG";
  const totalsAmountLabel = next.statType === "tanked" ? t("combat.totals.damageTaken") : isHeal ? t("combat.totals.healing") : t("combat.totals.damage");

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
        appTag={t("combat.window.tag")}
        minWidth={DPS_WINDOW_MINIMUM_WIDTH}
        minHeight={DPS_WINDOW_MINIMUM_HEIGHT}
        getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? {
          x: 0,
          y: 0,
          width: DPS_WINDOW_DEFAULT_WIDTH,
          height: DPS_WINDOW_DEFAULT_HEIGHT,
        }}
        setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
        extraControls={<SettingsButton onClick={() => void desktopView.rpc?.request.openSettings({})} />}
      />

      <nav class="seg log-tabs" role="tablist" aria-label={t("combat.logSource.label")}>
        <button type="button" role="tab" aria-selected={next.screen === "live"} class={next.screen === "live" ? "active" : undefined} onClick={() => setScreen("live")}>{t("combat.logSource.live")}</button>
        <button type="button" role="tab" aria-selected={next.screen === "past"} class={next.screen === "past" ? "active" : undefined} onClick={() => setScreen("past")}>{t("combat.logSource.past")}</button>
      </nav>

      {next.screen === "live" ? <section class="live-screen">
      <section class="command-bar">
        <StatTypeSelect value={next.statType} onChange={setStatType} />
        <div class="command-bar-actions">
          {next.location !== undefined && <span class="zone-pill" title={t("combat.zone.current", { zone: formatZone(next.location) })}>{formatZone(next.location)}</span>}
          <button class="btn" type="button" disabled={!next.liveDeathLogAvailable} onClick={() => void desktopView.rpc?.request.openActiveDeathLog({})}>{t("combat.action.deathLog")}</button>
          <button class="btn" type="button" disabled={next.resetting} onClick={() => void desktopView.rpc?.request.resetSession({})}>{t("combat.action.reset")}</button>
        </div>
      </section>

      <section class="status-strip" aria-live="polite">
        <StatusDot tone={STATUS_TONE[next.status]} detail={t.text(next.statusDetail)} />
        <div class="table-scroll summary-table-scroll">
          <table class="data-table summary-table" aria-label={t("combat.totals.label")}>
            <thead><tr><th>{t("combat.totals.timer")}</th><th>{t("combat.totals.encounter", { metric: metricLabel })}</th><th>{totalsAmountLabel}</th><th>{t("combat.totals.kills")}</th></tr></thead>
            <tbody><tr>
              <td>{activeSnapshot ? formatDuration(activeSnapshot.durationMs) : "—"}</td>
              <td>{formatDps(activeSnapshot?.partyDps ?? 0)}</td>
              <td>{compactFormat.format(activeSnapshot?.totalDamage ?? 0)}</td>
              <td>{numberFormat.format(activeSnapshot?.actors.reduce((total, actor) => total + actor.kills, 0) ?? 0)}</td>
            </tr></tbody>
          </table>
        </div>
      </section>

      <div id="storage-warning" class="banner is-warn" aria-live="polite" hidden={next.storageWarning === undefined}>{t.text(next.storageWarning) ?? ""}</div>

      <nav class="seg tabs" role="tablist" aria-label={t("combat.tabs.label")}>
        <button type="button" role="tab" aria-controls="all-panel" class={allActive ? "active" : undefined} aria-selected={allActive} onClick={() => setTab("all")}>{t("combat.tabs.all", { metric: metricLabel })}</button>
        <button type="button" role="tab" aria-controls="personal-panel" class={allActive ? undefined : "active"} aria-selected={!allActive} onClick={() => setTab("personal")}>{t("combat.tabs.personal")}</button>
      </nav>

      <section class="panel" role="tabpanel" hidden={!allActive}>
        {actors.length === 0
          ? <div class="empty-state">{isHeal ? t("combat.party.emptyHeal") : t("combat.party.empty")}</div>
          : <div class="table-scroll meter-table-scroll">
              <table class="data-table meter-table party-meter-table" aria-label={t("combat.party.label")}>
                <thead><tr>
                  <th>{t("combat.column.class")}</th>
                  <th>{t("combat.column.ign")}</th>
                  <SortableHeader sortKey="dps" sort={actorSort} onSort={sortActorsBy}>{metricLabel}</SortableHeader>
                  <SortableHeader sortKey="damage" sort={actorSort} onSort={sortActorsBy}>{amountLabel}</SortableHeader>
                  <SortableHeader sortKey="contribution" sort={actorSort} onSort={sortActorsBy}>{t("combat.column.amountPercent", { amount: amountLabel })}</SortableHeader>
                  <SortableHeader sortKey="critRate" sort={actorSort} onSort={sortActorsBy}>{t("combat.column.critRate")}</SortableHeader>
                  <SortableHeader sortKey="kills" sort={actorSort} onSort={sortActorsBy}>{t("combat.column.kills")}</SortableHeader>
                  <SortableHeader sortKey="mobsHit" sort={actorSort} onSort={sortActorsBy}>{t("combat.column.mobsHit")}</SortableHeader>
                </tr></thead>
                <tbody>{sortedActors.map((actor) => {
                  const activate = () => void desktopView.rpc?.request.openPlayerDetails({
                    source: "live",
                    actorId: actor.actorIds[0]!,
                    selectedEnemyIds: [],
                  });
                  return (
                  <tr
                    key={actor.actorIds[0]}
                    class="meter-table-row live-player-row"
                    style={`--row-fill:${Math.max(0, Math.min(100, actor.contribution * 100))}%`}
                    title={t("combat.party.rowHint")}
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
          <span class="t-label">{t("combat.personal.detected")}</span>
          <p class="detected-character" aria-live="polite">{next.personalName || t("combat.personal.waiting")}</p>
          <label class="t-label actor-label" for="personal-actor">{t("combat.personal.actorLabel")}</label>
          <CustomSelect
            id="personal-actor"
            ariaLabel={t("combat.personal.actorAria")}
            value={next.personalActorId === undefined ? "auto" : String(next.personalActorId)}
            onChange={(value) => {
              void desktopView.rpc?.request.setPersonalActor({ actorId: value === "auto" ? null : Number(value) });
            }}
            options={[
              { value: "auto", label: t("combat.personal.actorAuto") },
              ...actors.flatMap((actor) => actor.actorIds.map((actorId) => ({
                value: String(actorId),
                label: t("combat.personal.actorOption", { name: actor.displayName, damage: compactFormat.format(actor.damage) }),
              }))),
            ]}
          />
        </div>
        <p class="personal-hint">
          {personalMatch === "unconfigured"
            ? t("combat.personal.unconfigured")
            : personalMatch === "missing"
              ? t("combat.personal.missing", { name: next.personalName ?? "" })
              : personalMatch === "ambiguous"
                ? t("combat.personal.ambiguous")
                : t("combat.personal.matched")}
        </p>
        {personalSkills.length === 0
          ? <div class="empty-state">{personalMatch === "matched" ? t("combat.personal.skills.empty") : t("combat.personal.skills.unmatched")}</div>
          : <div class="table-scroll meter-table-scroll">
              <table class="data-table meter-table" aria-label={t("combat.personal.skills.label")}>
                <thead><tr>
                  <SortableHeader sortKey="sourceLabel" sort={skillSort} onSort={sortSkillsBy} align="start">{next.statType === "tanked" ? t("combat.column.attackerSkill") : t("combat.column.skill")}</SortableHeader>
                  <SortableHeader sortKey="dps" sort={skillSort} onSort={sortSkillsBy}>{metricLabel}</SortableHeader>
                  <SortableHeader sortKey="damage" sort={skillSort} onSort={sortSkillsBy}>{amountLabel}</SortableHeader>
                  <SortableHeader sortKey="contribution" sort={skillSort} onSort={sortSkillsBy}>{t("combat.column.share")}</SortableHeader>
                  <SortableHeader sortKey="hits" sort={skillSort} onSort={sortSkillsBy}>{t("combat.column.hits")}</SortableHeader>
                  <SortableHeader sortKey="criticalHits" sort={skillSort} onSort={sortSkillsBy}>{t("combat.column.crits")}</SortableHeader>
                  <SortableHeader sortKey="critRate" sort={skillSort} onSort={sortSkillsBy}>{t("combat.column.critRateLong")}</SortableHeader>
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
        {isTanked && (activeSnapshot?.personal?.absorbedSkills?.length ?? 0) > 0 && (
          <div class="table-scroll meter-table-scroll">
            <h2 class="element-title">{t("combat.shields.heading")}</h2>
            <table class="data-table meter-table" aria-label={t("combat.shields.personalSkillAria")}>
              <thead><tr><th>{t("combat.column.attackerSkill")}</th><th>{t("combat.column.absorbed")}</th><th>{t("combat.column.hits")}</th></tr></thead>
              <tbody>{(activeSnapshot?.personal?.absorbedSkills ?? []).map((skill) => (
                <tr key={skill.sourceId} class="meter-table-row" style={`--row-fill:${Math.max(0, Math.min(100, skill.contribution * 100))}%`}>
                  <th scope="row">{skill.sourceLabel}</th>
                  <td>{compactFormat.format(skill.damage)}</td>
                  <td>{numberFormat.format(skill.hits)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      </section> : next.past.view === "selector"
        ? <PastSessionPanel
            state={next.past.picker}
            onRefresh={() => void desktopView.rpc?.request.refreshPastSessions({})}
            onOpenSession={(id) => void desktopView.rpc?.request.openPastSession({ id })}
            onChooseFile={() => void desktopView.rpc?.request.choosePastFile({})}
            onOpenLogFolder={() => void desktopView.rpc?.request.openPastLogFolder({})}
            onDateRangeChange={(dateRange) => void desktopView.rpc?.request.setPastDateRange(dateRange)}
            onZonesChange={(zones) => void desktopView.rpc?.request.setPastZones({ zones })}
          />
        : <PastAnalysisPanel
            state={next.past.analysis}
            onBack={() => void desktopView.rpc?.request.backToPastSessions({})}
            onSelectEncounter={(id) => void desktopView.rpc?.request.selectPastEncounter({ id })}
            onSetStatType={(statType) => void desktopView.rpc?.request.setPastStatType({ statType })}
            onOpenDeathLog={() => void desktopView.rpc?.request.openActiveDeathLog({})}
            onOpenPlayerDetails={(rowId, selectedEnemyIds) => void desktopView.rpc?.request.openPlayerDetails({
              source: "past",
              rowId,
              selectedEnemyIds,
            })}
          />}
    </main>
  );
}

render(<App />, document.getElementById("root")!);
