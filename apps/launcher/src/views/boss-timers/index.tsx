import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { initWindowChrome, type WindowChrome } from "@svoverlay/ui-kit/window-chrome";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { normalizeSearchText } from "@svoverlay/ui-kit/format";
import {
  bossDueAtMs,
  bossEligibleAtMs,
  bossRegionLabel,
  bossRegionsPresent,
  bossTimerPhase,
  bossTimerRegion,
  compareBossRegions,
  formatBossClock,
  formatBossCountdown,
  isOwnBossKill,
  MAX_BOSS_CHANNEL,
  type BossTimer,
  type BossTimerPhase,
} from "@svoverlay/contracts/boss-timers";

import type { BossTimerRpc, BossTimerWindowState } from "../../boss-timers/rpc.ts";

const MAX_MANUAL_DEATH_MINUTES_AGO = 89;
const DEFAULT_WIDTH = 860;
const DEFAULT_HEIGHT = 660;
const MINIMUM_WIDTH = 620;
const MINIMUM_HEIGHT = 420;
const TICK_MS = 1_000;
const ALL_REGIONS = "";

const state = signal<BossTimerWindowState | undefined>(undefined);
const nowMs = signal(Date.now());
const rpc = DesktopView.defineRPC<BossTimerRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new DesktopView({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });
void ensureInitialWindowSize(electroview.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });
setInterval(() => { nowMs.value = Date.now(); }, TICK_MS);

function apply(pending: Promise<BossTimerWindowState> | undefined): void {
  void pending?.then((next) => { state.value = repairRendererPayload(next); });
}

function App() {
  const chromeRef = useRef<WindowChrome | undefined>(undefined);
  const titlebarRef = (node: HTMLElement | null): void => {
    if (!node || chromeRef.current) return;
    chromeRef.current = initWindowChrome({
      titlebar: node,
      minWidth: MINIMUM_WIDTH,
      minHeight: MINIMUM_HEIGHT,
      getFrame: async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      setFrame: (frame) => void electroview.rpc?.request.setWindowFrame(frame),
    });
  };

  const next = state.value;
  const timers = next?.timers ?? [];
  const now = nowMs.value;
  const spawnable = timers.filter((timer) => bossTimerPhase(timer, now) !== "waiting").length;

  return (
    <main class="app-shell">
      <header ref={titlebarRef} class="titlebar">
        <div class="brand">
          <img class="brand-icon" src="views://assets/app-icon.png" alt="" />
          <span>Boss Timers</span>
          <span class="brand-tag">
            {timers.length === 0
              ? "No timers"
              : spawnable === 0
                ? `${timers.length} tracked`
                : `${spawnable} of ${timers.length} up`}
          </span>
        </div>
        <div class="window-controls">
          <button class="icon-button" type="button" aria-label="Settings" title="Settings" onClick={() => void electroview.rpc?.request.openSettings({})}>⚙</button>
          <button class="icon-button" type="button" aria-label="Minimize" onClick={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}>−</button>
          <button class="icon-button close-button" type="button" aria-label="Close" onClick={() => void electroview.rpc?.request.windowAction({ action: "close" })}>×</button>
        </div>
      </header>
      <div class="content">
        {next === undefined
          ? <section class="empty-state"><strong>Loading timers…</strong></section>
          : <>
            <TimerTable state={next} nowMs={now} />
            <LogGravestone state={next} />
          </>}
      </div>
    </main>
  );
}

function TimerTable({ state: next, nowMs }: { state: BossTimerWindowState; nowMs: number }) {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState<string>(ALL_REGIONS);
  const regions = bossRegionsPresent(next.timers);
  // A region filter left pointing at a region whose last timer aged out would hide everything.
  const activeRegion = region !== ALL_REGIONS && regions.includes(region) ? region : ALL_REGIONS;
  const query = normalizeSearchText(search);
  const matching = next.timers
    .filter((timer) => activeRegion === ALL_REGIONS || bossTimerRegion(timer) === activeRegion)
    .filter((timer) => query.length === 0 || normalizeSearchText(searchTextOf(timer)).includes(query));
  const regionOptions = [
    { value: ALL_REGIONS, label: `All regions (${next.timers.length})` },
    ...[...regions].sort(compareBossRegions).map((candidate) => ({
      value: candidate,
      label: `${regionLabel(candidate)} (${next.timers.filter((timer) => bossTimerRegion(timer) === candidate).length})`,
    })),
  ];

  return (
    <section class="card">
      <div class="section-head">
        <h2>Active timers</h2>
        <div class="filters">
          <input
            class="input search"
            type="search"
            placeholder="Search boss, region, channel or killer"
            aria-label="Search timers"
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          {regions.length > 1 && (
            <div class="region-filter">
              <CustomSelect ariaLabel="Filter by region" value={activeRegion} options={regionOptions} onChange={setRegion} />
            </div>
          )}
        </div>
      </div>
      {next.timers.length === 0
        ? <p class="muted">No boss timers yet. They start on their own when you pass a boss's gravestone in game, using the server's own time of death — you do not need to have been there for the kill.</p>
        : matching.length === 0
          ? <p class="muted">No timer matches that search.</p>
          : <table class="timer-table">
            <thead>
              <tr>
                <th>Boss</th>
                <th>Where</th>
                <th>Killed by</th>
                <th>Status</th>
                <th><span class="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {matching.map((timer) => (
                <TimerRow key={timer.id} timer={timer} nowMs={nowMs} playerName={next.playerName} />
              ))}
            </tbody>
          </table>}
    </section>
  );
}

function TimerRow(
  { timer, nowMs, playerName }: { timer: BossTimer; nowMs: number; playerName: string | undefined },
) {
  const phase = bossTimerPhase(timer, nowMs);
  const own = isOwnBossKill(timer, playerName);
  return (
    <tr class={`timer-row boss-${phase}`}>
      <td class="timer-boss">
        {timer.bossName}
        {own && <span class="own-kill" title="You landed this kill" aria-label="Your kill">✓</span>}
      </td>
      <td class="timer-where">
        <span class="timer-place">{`${regionLabel(bossTimerRegion(timer))} · Ch ${timer.channel ?? "?"}`}</span>
        {/* The machine is diagnostic context, not part of the timer identity. */}
        {timer.instanceId !== undefined && <span class="timer-instance">{timer.instanceId}</span>}
      </td>
      <td class="timer-killer">{timer.killedBy ?? "—"}</td>
      <td class="timer-status">
        <span class="timer-countdown">{statusText(timer, phase, nowMs)}</span>
        <span class="timer-clock">{clockText(timer, phase)}</span>
      </td>
      <td class="timer-actions">
        <button
          class="btn"
          type="button"
          title={`Remove the ${timer.bossName} timer`}
          onClick={() => apply(electroview.rpc?.request.removeTimer({ id: timer.id }))}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

function LogGravestone({ state: next }: { state: BossTimerWindowState }) {
  const [pickedMobId, setPickedMobId] = useState<string>();
  const [pickedRegion, setPickedRegion] = useState<string>();
  const [channelText, setChannelText] = useState("1");
  const [minutesAgoText, setMinutesAgoText] = useState("0");
  const [open, setOpen] = useState(false);
  const bossOptions = next.options.map((boss) => ({ value: boss.mobId, label: `${boss.displayName} (Lv ${boss.level})` }));
  const regionOptions = next.knownRegions.map((candidate) => ({ value: candidate, label: regionLabel(candidate) }));
  const mobId = pickedMobId ?? next.options[0]?.mobId;
  // Whatever the select shows has to be what gets filed, or the entry lands somewhere the player was never told about.
  const region = pickedRegion ?? next.currentRegion ?? next.knownRegions[0];
  const channel = parseBounded(channelText, 1, MAX_BOSS_CHANNEL);
  const minutesAgo = parseBounded(minutesAgoText, 0, MAX_MANUAL_DEATH_MINUTES_AGO);
  const valid = mobId !== undefined && channel !== undefined && minutesAgo !== undefined;

  return (
    <section class="card">
      <div class="section-head">
        <h2>Log a gravestone</h2>
        <button class="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Add manually"}
        </button>
      </div>
      <p class="muted">
        Gravestones you walk past are timed automatically. This is the fallback for one you could see
        but not reach.
        {next.currentInstanceId !== undefined && ` You are currently on ${next.currentInstanceId}.`}
      </p>
      {open && <>
        <div class="entry-grid">
          <label class="field entry-boss">
            <span>Boss</span>
            {mobId !== undefined && <CustomSelect ariaLabel="Boss" value={mobId} options={bossOptions} onChange={setPickedMobId} />}
          </label>
          <label class="field">
            <span>Region</span>
            {region !== undefined && regionOptions.length > 0
              ? <CustomSelect ariaLabel="Region" value={region} options={regionOptions} onChange={setPickedRegion} />
              : <input class="input" value="—" disabled readonly aria-label="Region not detected yet" />}
          </label>
          <label class="field">
            <span>Channel</span>
            <input class="input" type="number" min="1" max={MAX_BOSS_CHANNEL} value={channelText} onInput={(event) => setChannelText(event.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Died (minutes ago)</span>
            <input class="input" type="number" min="0" max={MAX_MANUAL_DEATH_MINUTES_AGO} value={minutesAgoText} onInput={(event) => setMinutesAgoText(event.currentTarget.value)} />
          </label>
          <button
            class="btn primary"
            type="button"
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              apply(electroview.rpc?.request.addTimer({
                mobId,
                channel,
                ...(region === undefined ? {} : { region }),
                diedAtMs: Date.now() - minutesAgo * 60_000,
              }));
              setOpen(false);
            }}
          >
            Start timer
          </button>
        </div>
        {channel === undefined && <p class="hint">Channel must be between 1 and {MAX_BOSS_CHANNEL} — world bosses only spawn on those channels.</p>}
        {minutesAgo === undefined && <p class="hint">Minutes ago must be between 0 and {MAX_MANUAL_DEATH_MINUTES_AGO} — after 90 minutes the boss has already spawned.</p>}
        <p class="hint">An existing timer for that boss, region and channel is re-anchored to the time you give.</p>
      </>}
    </section>
  );
}

function searchTextOf(timer: BossTimer): string {
  return [
    timer.bossName,
    timer.mobId,
    bossTimerRegion(timer),
    timer.channel === undefined ? "" : `ch${timer.channel}`,
    timer.instanceId ?? "",
    timer.killedBy ?? "",
  ].join(" ");
}

function regionLabel(region: string): string {
  return bossRegionLabel(region, "Unknown");
}

function statusText(timer: BossTimer, phase: BossTimerPhase, nowMs: number): string {
  if (phase === "waiting") return `in ${formatBossCountdown(bossEligibleAtMs(timer) - nowMs)}`;
  if (phase === "window") return `spawnable · ${formatBossCountdown(bossDueAtMs(timer) - nowMs)} left`;
  return "spawned";
}

function clockText(timer: BossTimer, phase: BossTimerPhase): string {
  if (phase === "waiting") return `from ${formatBossClock(bossEligibleAtMs(timer))}`;
  if (phase === "window") return `by ${formatBossClock(bossDueAtMs(timer))}`;
  return `window closed ${formatBossClock(bossDueAtMs(timer))}`;
}

function parseBounded(text: string, minimum: number, maximum: number): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text.trim());
  return value >= minimum && value <= maximum ? value : undefined;
}

render(<App />, document.getElementById("root")!);
