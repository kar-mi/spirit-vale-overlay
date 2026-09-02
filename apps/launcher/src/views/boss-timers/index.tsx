import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { initWindowChrome, type WindowChrome } from "@svoverlay/ui-kit/window-chrome";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { disableWebChrome } from "@svoverlay/ui-kit/disable-web-chrome";
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

import { useTranslator } from "@svoverlay/i18n/browser";
import type { Translator } from "@svoverlay/i18n/translate";

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
const desktopView = new DesktopView({ rpc });
void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });
disableWebChrome();
void ensureInitialWindowSize(desktopView.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });
setInterval(() => { nowMs.value = Date.now(); }, TICK_MS);

function apply(pending: Promise<BossTimerWindowState> | undefined): void {
  void pending?.then((next) => { state.value = repairRendererPayload(next); });
}

function App() {
  const t = useTranslator();
  const chromeRef = useRef<WindowChrome | undefined>(undefined);
  const titlebarRef = (node: HTMLElement | null): void => {
    if (!node || chromeRef.current) return;
    chromeRef.current = initWindowChrome({
      titlebar: node,
      minWidth: MINIMUM_WIDTH,
      minHeight: MINIMUM_HEIGHT,
      getFrame: async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      setFrame: (frame) => void desktopView.rpc?.request.setWindowFrame(frame),
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
          <span>{t("bossTimers.brand")}</span>
          <span class="brand-tag">
            {timers.length === 0
              ? t("bossTimers.tag.none")
              : spawnable === 0
                ? t("bossTimers.tag.tracked", { count: timers.length })
                : t("bossTimers.tag.up", { spawnable, count: timers.length })}
          </span>
        </div>
        <div class="window-controls">
          <button class="icon-button" type="button" aria-label={t("settingsButton.label")} title={t("settingsButton.label")} onClick={() => void desktopView.rpc?.request.openSettings({})}>⚙</button>
          <button class="icon-button" type="button" aria-label={t("titleBar.minimize")} onClick={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}>−</button>
          <button class="icon-button close-button" type="button" aria-label={t("titleBar.close")} onClick={() => void desktopView.rpc?.request.windowAction({ action: "close" })}>×</button>
        </div>
      </header>
      <div class="content">
        {next === undefined
          ? <section class="empty-state"><strong>{t("bossTimers.loading")}</strong></section>
          : <>
            <TimerTable state={next} nowMs={now} />
            <LogGravestone state={next} />
          </>}
      </div>
    </main>
  );
}

function TimerTable({ state: next, nowMs }: { state: BossTimerWindowState; nowMs: number }) {
  const t = useTranslator();
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
    { value: ALL_REGIONS, label: t("bossTimers.allRegions", { count: next.timers.length }) },
    ...[...regions].sort(compareBossRegions).map((candidate) => ({
      value: candidate,
      label: t("bossTimers.regionOption", {
        region: regionLabel(t, candidate),
        count: next.timers.filter((timer) => bossTimerRegion(timer) === candidate).length,
      }),
    })),
  ];

  return (
    <section class="card">
      <div class="section-head">
        <h2>{t("bossTimers.active")}</h2>
        <div class="filters">
          <input
            class="input search"
            type="search"
            placeholder={t("bossTimers.searchPlaceholder")}
            aria-label={t("bossTimers.searchAria")}
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          {regions.length > 1 && (
            <div class="region-filter">
              <CustomSelect ariaLabel={t("bossTimers.regionFilter")} value={activeRegion} options={regionOptions} onChange={setRegion} />
            </div>
          )}
        </div>
      </div>
      {next.timers.length === 0
        ? <p class="muted">{t("bossTimers.empty")}</p>
        : matching.length === 0
          ? <p class="muted">{t("bossTimers.noMatch")}</p>
          : <table class="timer-table">
            <thead>
              <tr>
                <th>{t("bossTimers.column.boss")}</th>
                <th>{t("bossTimers.column.where")}</th>
                <th>{t("bossTimers.column.killedBy")}</th>
                <th>{t("bossTimers.column.status")}</th>
                <th><span class="visually-hidden">{t("bossTimers.column.actions")}</span></th>
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
  const t = useTranslator();
  const phase = bossTimerPhase(timer, nowMs);
  const own = isOwnBossKill(timer, playerName);
  return (
    <tr class={`timer-row boss-${phase}`}>
      <td class="timer-boss">
        {timer.bossName}
        {own && <span class="own-kill" title={t("bossTimers.ownKill.title")} aria-label={t("bossTimers.ownKill.aria")}>✓</span>}
      </td>
      <td class="timer-where">
        <span class="timer-place">{t("bossTimers.place", { region: regionLabel(t, bossTimerRegion(timer)), channel: timer.channel ?? "?" })}</span>
        {/* The machine is diagnostic context, not part of the timer identity. */}
        {timer.instanceId !== undefined && <span class="timer-instance">{timer.instanceId}</span>}
      </td>
      <td class="timer-killer">{timer.killedBy ?? "—"}</td>
      <td class="timer-status">
        <span class="timer-countdown">{statusText(t, timer, phase, nowMs)}</span>
        <span class="timer-clock">{clockText(t, timer, phase)}</span>
      </td>
      <td class="timer-actions">
        <button
          class="btn"
          type="button"
          title={t("bossTimers.remove.title", { boss: timer.bossName })}
          onClick={() => apply(desktopView.rpc?.request.removeTimer({ id: timer.id }))}
        >
          {t("bossTimers.remove")}
        </button>
      </td>
    </tr>
  );
}

function LogGravestone({ state: next }: { state: BossTimerWindowState }) {
  const t = useTranslator();
  const [pickedMobId, setPickedMobId] = useState<string>();
  const [pickedRegion, setPickedRegion] = useState<string>();
  const [channelText, setChannelText] = useState("1");
  const [minutesAgoText, setMinutesAgoText] = useState("0");
  const [open, setOpen] = useState(false);
  const bossOptions = next.options.map((boss) => ({ value: boss.mobId, label: t("bossTimers.log.bossOption", { boss: boss.displayName, level: boss.level }) }));
  const regionOptions = next.knownRegions.map((candidate) => ({ value: candidate, label: regionLabel(t, candidate) }));
  const mobId = pickedMobId ?? next.options[0]?.mobId;
  // Whatever the select shows has to be what gets filed, or the entry lands somewhere the player was never told about.
  const region = pickedRegion ?? next.currentRegion ?? next.knownRegions[0];
  const channel = parseBounded(channelText, 1, MAX_BOSS_CHANNEL);
  const minutesAgo = parseBounded(minutesAgoText, 0, MAX_MANUAL_DEATH_MINUTES_AGO);
  const valid = mobId !== undefined && channel !== undefined && minutesAgo !== undefined;

  return (
    <section class="card">
      <div class="section-head">
        <h2>{t("bossTimers.log.heading")}</h2>
        <button class="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t(open ? "bossTimers.log.hide" : "bossTimers.log.add")}
        </button>
      </div>
      <p class="muted">
        {t("bossTimers.log.hint")}
        {next.currentInstanceId !== undefined && t("bossTimers.log.currentInstance", { instance: next.currentInstanceId })}
      </p>
      {open && <>
        <div class="entry-grid">
          <label class="field entry-boss">
            <span>{t("bossTimers.log.boss")}</span>
            {mobId !== undefined && <CustomSelect ariaLabel={t("bossTimers.log.boss")} value={mobId} options={bossOptions} onChange={setPickedMobId} />}
          </label>
          <label class="field">
            <span>{t("bossTimers.log.region")}</span>
            {region !== undefined && regionOptions.length > 0
              ? <CustomSelect ariaLabel={t("bossTimers.log.region")} value={region} options={regionOptions} onChange={setPickedRegion} />
              : <input class="input" value="—" disabled readonly aria-label={t("bossTimers.log.regionUndetected")} />}
          </label>
          <label class="field">
            <span>{t("bossTimers.log.channel")}</span>
            <input class="input" type="number" min="1" max={MAX_BOSS_CHANNEL} value={channelText} onInput={(event) => setChannelText(event.currentTarget.value)} />
          </label>
          <label class="field">
            <span>{t("bossTimers.log.diedMinutesAgo")}</span>
            <input class="input" type="number" min="0" max={MAX_MANUAL_DEATH_MINUTES_AGO} value={minutesAgoText} onInput={(event) => setMinutesAgoText(event.currentTarget.value)} />
          </label>
          <button
            class="btn primary"
            type="button"
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              apply(desktopView.rpc?.request.addTimer({
                mobId,
                channel,
                ...(region === undefined ? {} : { region }),
                diedAtMs: Date.now() - minutesAgo * 60_000,
              }));
              setOpen(false);
            }}
          >
            {t("bossTimers.log.start")}
          </button>
        </div>
        {channel === undefined && <p class="hint">{t("bossTimers.log.channelRange", { maximum: MAX_BOSS_CHANNEL })}</p>}
        {minutesAgo === undefined && <p class="hint">{t("bossTimers.log.minutesRange", { maximum: MAX_MANUAL_DEATH_MINUTES_AGO })}</p>}
        <p class="hint">{t("bossTimers.log.reanchor")}</p>
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

function regionLabel(t: Translator, region: string): string {
  return bossRegionLabel(region, t("bossTimers.region.unknown"));
}

function statusText(t: Translator, timer: BossTimer, phase: BossTimerPhase, nowMs: number): string {
  if (phase === "waiting") return t("bossTimers.status.waiting", { countdown: formatBossCountdown(bossEligibleAtMs(timer) - nowMs) });
  if (phase === "window") return t("bossTimers.status.window", { countdown: formatBossCountdown(bossDueAtMs(timer) - nowMs) });
  return t("bossTimers.status.spawned");
}

function clockText(t: Translator, timer: BossTimer, phase: BossTimerPhase): string {
  if (phase === "waiting") return t("bossTimers.clock.waiting", { clock: formatBossClock(bossEligibleAtMs(timer)) });
  if (phase === "window") return t("bossTimers.clock.window", { clock: formatBossClock(bossDueAtMs(timer)) });
  return t("bossTimers.clock.spawned", { clock: formatBossClock(bossDueAtMs(timer)) });
}

function parseBounded(text: string, minimum: number, maximum: number): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text.trim());
  return value >= minimum && value <= maximum ? value : undefined;
}

render(<App />, document.getElementById("root")!);
