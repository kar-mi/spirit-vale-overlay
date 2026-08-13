import { render } from "preact";
import { useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { DesktopTitleBar } from "@svoverlay/ui-kit/desktop-title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { StatusDot } from "@svoverlay/ui-kit/status-dot";
import type { StatusTone } from "@svoverlay/ui-kit/status-dot";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { SortableHeader as RewardSortHeader, nextSort } from "@svoverlay/ui-kit/sortable-header";
import { useExpandedRows } from "@svoverlay/ui-kit/use-expanded-rows";

import type { RewardsAppRpc, RewardsAppState, RewardsAppView } from "../app-types.ts";
import { sortRewardKills, sortRewardSummaries } from "../table-sort.ts";
import type { KillSortKey, SummarySortKey, TableSort } from "../table-sort.ts";
import { RewardRow } from "./reward-row.tsx";
import { TrendChart, XpTrackerSection, formatDecimal } from "./trend-sections.tsx";

const STATUS_TONE: Record<RewardsAppState["status"], StatusTone> = {
  waiting: "is-warn",
  watching: "is-ok",
  ready: "is-ok",
  stopped: "is-warn",
  error: "is-err",
};

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });

const state = signal<RewardsAppState | undefined>(undefined);

const rpc = Electroview.defineRPC<RewardsAppRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const REWARDS_DEFAULT_WIDTH = 620;
const REWARDS_DEFAULT_HEIGHT = 520;
void ensureInitialWindowSize(electroview.rpc?.request, { width: REWARDS_DEFAULT_WIDTH, height: REWARDS_DEFAULT_HEIGHT });

function setView(view: RewardsAppView): void {
  void electroview.rpc?.request.setView({ view });
}

function returnToLive(): void {
  void electroview.rpc?.request.setMode({ mode: "live" });
}

function killsLabel(mob: { kills: number; attributedKills: number }): string {
  return format.format(mob.kills);
}

function formatTimestamp(value: string | undefined): string {
  if (value === undefined) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : timestampFormat.format(parsed);
}

function App() {
  const next = state.value;
  const [summarySort, setSummarySort] = useState<TableSort<SummarySortKey>>({ key: "kills", direction: "descending" });
  const [killSort, setKillSort] = useState<TableSort<KillSortKey>>({ key: "timestamp", direction: "descending" });
  const [expanded, toggleExpanded] = useExpandedRows();
  if (!next) return null;

  const sessionKey = `${next.mode}:${next.replayFileName ?? "live"}`;
  const summaries = sortRewardSummaries(next.summaries, summarySort);
  const kills = sortRewardKills(next.kills, killSort);
  return (
    <>
      <DesktopTitleBar
        appTag="Rewards"
        minWidth={620}
        minHeight={520}
        defaultWidth={REWARDS_DEFAULT_WIDTH}
        defaultHeight={REWARDS_DEFAULT_HEIGHT}
        requests={electroview.rpc?.request}
        maximizable
        extraControls={
          <>
          <SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />
          <button
            class={next.pinned ? "icon-button active" : "icon-button"}
            type="button"
            aria-label="Toggle always on top"
            title="Always on top"
            onClick={() => void electroview.rpc?.request.setPinned({ pinned: !next.pinned })}
          >
            {next.pinned ? "◆" : "◇"}
          </button>
          </>
        }
      />
      <main>
        <nav class="toolbar">
          <div class="seg" aria-label="Session view">
            <button class={next.view === "summary" ? "active" : undefined} type="button" onClick={() => setView("summary")}>Summary</button>
            <button class={next.view === "recent" ? "active" : undefined} type="button" onClick={() => setView("recent")}>Recent kills</button>
            <button class={next.view === "trends" ? "active" : undefined} type="button" onClick={() => setView("trends")}>Trends</button>
            <button class={next.view === "xpTracker" ? "active" : undefined} type="button" onClick={() => setView("xpTracker")}>Session Tracker</button>
          </div>
          <StatusDot tone={STATUS_TONE[next.status]} detail={next.statusDetail} />
          <div class="toolbar-actions">
            <button class="btn" type="button" onClick={() => void electroview.rpc?.request.openCatalog({})}>Catalog</button>
            <button class={next.mode === "replay" ? "btn active" : "btn"} type="button" onClick={() => void electroview.rpc?.request.openReplayPicker({})}>Replay</button>
            <button class="btn" type="button" disabled={next.mode === "replay" || next.resetting} onClick={() => void electroview.rpc?.request.resetSession({})}>Reset</button>
          </div>
        </nav>

        {next.mode === "replay" && (
          <div class="banner is-info">
            <span>
              Viewing replay: {next.replayFileName ?? "selected log"}
              {next.replayWarnings > 0 ? ` · ${next.replayWarnings} malformed records skipped` : ""}
            </span>
            <button class="btn" type="button" onClick={returnToLive}>Return to live</button>
          </div>
        )}

        {next.storageWarning !== undefined && <div class="banner is-warn" aria-live="polite">{next.storageWarning}</div>}

        <div class="table-scroll totals">
          <table class="data-table summary-table rewards-total-table" aria-label="Reward totals">
            <thead><tr><th>Character XP</th><th>XP to Lvl Up</th><th>Job XP</th><th>Coins</th><th>Unmatched</th></tr></thead>
            <tbody><tr><td>{format.format(next.totalExperience)}</td><td>{next.xpToLevelUp === undefined ? "—" : format.format(next.xpToLevelUp)}</td><td>{format.format(next.totalJobExperience)}</td><td class="is-value">{formatDecimal(next.totalCoins)}</td><td>{format.format(next.unmatched)}</td></tr></tbody>
          </table>
        </div>

        {next.unidentified > 0 && (
          <div class="banner is-warn">
            {`${format.format(next.unidentified)} reward ${next.unidentified === 1 ? "event came" : "events came"} from mobs whose spawn happened before capture. Change maps or wait for those mobs to respawn; newly observed mobs will be categorized.`}
          </div>
        )}

        <section hidden={next.view !== "summary"}>
          <div class="section-head"><h1>Mob summary</h1><p>Confirmed rewards grouped by mob, plus unmatched pickups.</p></div>
          {next.summaries.length === 0 && next.unmatchedDrops.length === 0 ? (
              <div class="empty-state">{next.mode === "replay" ? "No confirmed mob totals in this replay." : "Confirmed mob totals will appear here."}</div>
            ) : (
              <div class="table-scroll rewards-table-scroll">
                <table class="data-table rewards-table" aria-label="Mob reward summary">
                  <thead><tr>
                    <RewardSortHeader label="Mob" active={summarySort.key === "displayName"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "displayName"))} />
                    <RewardSortHeader label="Level" active={summarySort.key === "level"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "level"))} />
                    <RewardSortHeader label="Kills" active={summarySort.key === "kills"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "kills"))} />
                    <RewardSortHeader label="Char XP" active={summarySort.key === "experience"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "experience"))} />
                    <RewardSortHeader label="Job XP" active={summarySort.key === "jobExperience"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "jobExperience"))} />
                    <RewardSortHeader label="Coins" active={summarySort.key === "coins"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "coins"))} />
                    <th>Drops</th>
                  </tr></thead>
                  <tbody>
                    {summaries.map((mob) => <RewardRow
                      key={mob.mobId}
                      rowKey={`summary-${mob.mobId}`}
                      name={mob.displayName}
                      values={[format.format(mob.level), killsLabel(mob), format.format(mob.experience), format.format(mob.jobExperience), formatDecimal(mob.coins)]}
                      drops={mob.drops}
                      expanded={expanded}
                      onToggle={toggleExpanded}
                    />)}
                    {next.unmatchedDrops.length > 0 && <RewardRow rowKey="summary-unmatched" name="Unmatched" values={["—", "—", "—", "—", "—"]} drops={next.unmatchedDrops} expanded={expanded} onToggle={toggleExpanded} />}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section hidden={next.view !== "recent"}>
          <div class="section-head"><h1>Recent kills</h1><p>Newest first. Rewards show only where they could be attributed to one kill.</p></div>
          {next.kills.length === 0 ? (
              <div class="empty-state">{next.mode === "replay" ? "No kills in this replay." : "Waiting for a mob kill."}</div>
            ) : (
              <div class="table-scroll rewards-table-scroll">
                <table class="data-table rewards-table recent-rewards-table" aria-label="Recent kills">
                  <thead><tr>
                    <RewardSortHeader label="Mob" active={killSort.key === "displayName"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "displayName"))} />
                    <RewardSortHeader label="Level" active={killSort.key === "level"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "level"))} />
                    <RewardSortHeader label="Char XP" active={killSort.key === "experience"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "experience"))} />
                    <RewardSortHeader label="Job XP" active={killSort.key === "jobExperience"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "jobExperience"))} />
                    <RewardSortHeader label="Coins" active={killSort.key === "coins"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "coins"))} />
                    <th>Drops</th>
                    <RewardSortHeader label="Timestamp" active={killSort.key === "timestamp"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "timestamp"))} />
                  </tr></thead>
                  <tbody>{kills.map((kill) => <RewardRow
                    key={kill.id}
                    rowKey={`kill-${kill.id}`}
                    name={kill.displayName}
                    values={[format.format(kill.level), `+${format.format(kill.experience)}`, `+${format.format(kill.jobExperience)}`, `+${formatDecimal(kill.coins)}`]}
                    drops={kill.drops}
                    trailingValues={[formatTimestamp(kill.timestamp)]}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                  />)}</tbody>
                </table>
              </div>
            )}
        </section>

        <section hidden={next.view !== "trends"}>
          <div class="section-head"><h1>Reward trends</h1><p>Session gains over wall-clock time.</p></div>
          <TrendChart samples={next.graphSamples} replay={next.mode === "replay"} sessionKey={sessionKey} />
        </section>

        <section hidden={next.view !== "xpTracker"}>
          <div class="section-head">
            <h1>Character XP tracker</h1>
            <p>Cumulative Character XP across sessions, until reset.</p>
          </div>
          <XpTrackerSection xp={next.xp} gold={next.gold} onResetXp={() => void electroview.rpc?.request.resetXpTracker({})} onResetGold={() => void electroview.rpc?.request.resetGoldTracker({})} />
        </section>
      </main>
    </>
  );
}

render(<App />, document.getElementById("root")!);
