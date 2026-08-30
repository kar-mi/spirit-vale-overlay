import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { initWindowChrome, type WindowChrome } from "@svoverlay/ui-kit/window-chrome";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { disableWebChrome } from "@svoverlay/ui-kit/disable-web-chrome";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { resolveFishNetItem, type FishNetArtifactSlot } from "@kar-mi/spirit-vale-tools-items";
import type {
  CharacterArtifact,
  CharacterEquipment,
  CharacterSkill,
  CharacterSnapshot,
  CharacterStatBreakdown,
  CharacterSubstat,
  CharacterViewState,
  GearStatTotal,
} from "@kar-mi/spirit-vale-tools-character";
import type { CharacterRpc } from "../../character/rpc.ts";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { Translator } from "@svoverlay/i18n/translate";
import { formatItemEffects } from "./item-effects.ts";

const ATTRIBUTE_NAMES = ["STR", "VIT", "AGI", "DEX", "INT", "LUK"] as const;
type Tab = "basic" | "gear" | "advanced" | "skills";
interface BuildSection { label: string; value: string; tone?: "active" | "muted"; }
interface BuildItem { slot: string; name: string; refine: number; sections: BuildSection[]; }

const state = signal<CharacterViewState | undefined>(undefined);
const rpc = DesktopView.defineRPC<CharacterRpc>({ handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } } });
const desktopView = new DesktopView({ rpc });
void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const CHARACTER_DEFAULT_WIDTH = 920;
const CHARACTER_DEFAULT_HEIGHT = 720;
disableWebChrome();
void ensureInitialWindowSize(desktopView.rpc?.request, { width: 680, height: 520 });

function App() {
  const t = useTranslator();
  const [tab, setTab] = useState<Tab>("basic");
  const chromeRef = useRef<WindowChrome | undefined>(undefined);
  const titlebarRef = (node: HTMLElement | null): void => {
    if (!node || chromeRef.current) return;
    chromeRef.current = initWindowChrome({
      titlebar: node, minWidth: 680, minHeight: 520,
      getFrame: async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: CHARACTER_DEFAULT_WIDTH, height: CHARACTER_DEFAULT_HEIGHT },
      setFrame: (frame) => void desktopView.rpc?.request.setWindowFrame(frame),
    });
  };

  const next = state.value;
  const character = next?.snapshot;

  return (
    <main class="app-shell">
      <header ref={titlebarRef} class="titlebar">
        <div class="brand">
          <img class="brand-icon" src="views://assets/app-icon.png" alt="" />
          <span>{t("character.brand")}</span>
          <span class="brand-tag">{t(next?.status === "live" ? "character.status.live" : next?.status === "cached" ? "character.status.cached" : "character.status.waiting")}</span>
        </div>
        <div class="window-controls">
          <button class="icon-button" type="button" aria-label={t("settingsButton.label")} title={t("settingsButton.label")} onClick={() => void desktopView.rpc?.request.openSettings({})}>⚙</button>
          <button class="icon-button" type="button" aria-label={t("titleBar.minimize")} onClick={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}>−</button>
          <button class="icon-button close-button" type="button" aria-label={t("titleBar.close")} onClick={() => void desktopView.rpc?.request.windowAction({ action: "close" })}>×</button>
        </div>
      </header>
      <div class="content">
        {!character && (
          <section class="empty-state">
            <strong>{t("character.empty.heading")}</strong>
            <p>{t("character.empty.hint")}</p>
          </section>
        )}
        {character && next && (
          <div>
            <section class="hero card">
              <div>
                <p class="eyebrow">{t("character.eyebrow")}</p>
                <h1>{character.title ? `${character.name} · ${character.title}` : character.name}</h1>
                <p class="muted">{character.archetypes.length ? character.archetypes.join(" / ") : t("character.archetype.novice")}</p>
              </div>
              <div class="progression">
                <div><span>{t("character.progression.level")}</span><strong>{format(character.level)}</strong></div>
                <div><span>{t("character.progression.job")}</span><strong>{format(character.jobLevel)}</strong></div>
                <div><span>{t("character.progression.xp")}</span><strong>{format(character.experience)}</strong></div>
                <div><span>{t("character.progression.jobXp")}</span><strong>{format(character.jobExperience)}</strong></div>
                {next.records?.maxHealth !== undefined && (
                  <div class="record-tile"><span>{t("character.progression.hpLive")}</span><strong>{format(next.records.maxHealth)}</strong></div>
                )}
                {next.records?.maxMana !== undefined && (
                  <div class="record-tile"><span>{t("character.progression.mpLive")}</span><strong>{format(next.records.maxMana)}</strong></div>
                )}
                {next.records?.moveSpeed !== undefined && (
                  <div class="record-tile"><span>{t("character.progression.speedLive")}</span><strong>{next.records.moveSpeed.toFixed(2)}</strong></div>
                )}
              </div>
            </section>
            <p class="status-detail">
              {next.status === "cached"
                ? t("character.statusDetail.cached", { detail: next.statusDetail, when: new Date(character.updatedAt).toLocaleString() })
                : next.statusDetail}
            </p>
            <div class="tab-bar" role="tablist" aria-label={t("character.tabs.label")}>
              {(["basic", "gear", "advanced", "skills"] as const).map((tabId) => (
                <button
                  key={tabId}
                  class={tab === tabId ? "tab-button active" : "tab-button"}
                  type="button"
                  role="tab"
                  aria-selected={tab === tabId}
                  onClick={() => setTab(tabId)}
                >
                  {t(`character.tab.${tabId}`)}
                </button>
              ))}
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "basic"}>
              <section class="card"><h2>{t("character.section.attributes")}</h2><Attributes attributes={character.attributes} /></section>
              {history(t, character).length > 0 && (
                <section class="card"><h2>{t("character.section.history")}</h2><HistoryGrid entries={history(t, character)} /></section>
              )}
              <section class="card">
                <div class="section-heading"><div><h2>{t("character.section.calculated")}</h2><p>{t("character.section.calculatedHint")}</p></div></div>
                <StatGroups stats={next.stats} tab="basic" />
              </section>
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "gear"}>
              <section class="card">
                <div class="section-heading"><div><h2>{t("character.section.build")}</h2><p>{t("character.section.buildHint", { loadout: character.activeLoadout })}</p></div></div>
                <div class="build-columns">
                  <div><h3>{t("character.section.equipment")}</h3><Build items={equipmentBuildItems(t, character.equipment)} /></div>
                  <div><h3>{t("character.section.artifacts")}</h3><Build items={artifactBuildItems(t, character.artifacts)} /></div>
                </div>
              </section>
              <section class="card"><h2>{t("character.section.gearTotals")}</h2><GearTotals totals={next.gearTotals} /></section>
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "advanced"}>
              <section class="card">
                <div class="section-heading"><div><h2>{t("character.section.advanced")}</h2><p>{t("character.section.advancedHint")}</p></div></div>
                <StatGroups stats={next.stats} tab="advanced" />
              </section>
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "skills"}>
              <section class="card"><h2>{t("character.section.skills")}</h2><Skills skills={character.skills} /></section>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Attributes({ attributes }: { attributes: CharacterSnapshot["attributes"] }) {
  return (
    <div class="attribute-grid">
      {ATTRIBUTE_NAMES.map((name) => (
        <div class="attribute" key={name}><span>{name}</span><strong>{format(attributes[name])}</strong></div>
      ))}
    </div>
  );
}

function history(t: Translator, character: CharacterSnapshot): Array<[string, string]> {
  return [
    [t("character.history.playtime"), character.playtimeSeconds === undefined ? undefined : duration(character.playtimeSeconds)],
    [t("character.history.monsterKills"), character.monsterKills === undefined ? undefined : format(character.monsterKills)],
    [t("character.history.bossKills"), character.bossKills === undefined ? undefined : format(character.bossKills)],
    [t("character.history.deaths"), character.deaths === undefined ? undefined : format(character.deaths)],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined);
}

function HistoryGrid({ entries }: { entries: Array<[string, string]> }) {
  return (
    <div class="attribute-grid history-grid">
      {entries.map(([label, value]) => (
        <div class="attribute" key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
}

function Build({ items }: { items: BuildItem[] }) {
  const t = useTranslator();
  if (!items.length) return <div class="build-list"><div class="build-empty">{t("character.build.empty")}</div></div>;
  return (
    <div class="build-list">
      {items.map((item, index) => (
        <div class="build-item" key={`${item.slot}-${index}`}>
          <div class="build-item-head"><span>{item.slot}</span><strong>{item.name}{item.refine ? ` +${item.refine}` : ""}</strong></div>
          <div class="build-details">
            {item.sections.length
              ? item.sections.map((section, sectionIndex) => (
                <div class={section.tone ? `build-detail ${section.tone}` : "build-detail"} key={sectionIndex}>
                  <span class="build-detail-label">{section.label}</span>
                  <span class="build-detail-value">{section.value}</span>
                </div>
              ))
              : <div class="build-empty">{t("character.build.noEffects")}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function equipmentBuildItems(t: Translator, equipment: CharacterEquipment[]): BuildItem[] {
  return equipment.map((item) => ({
    slot: item.slot, name: item.itemId, refine: item.refine,
    sections: [
      ...itemEffectSections(t, 2, item.itemId, item.refine),
      ...(item.substats.length ? [{ label: t("character.build.rolledStats"), value: substatText(t, item.substats) }] : []),
      ...(item.cards.length ? [{ label: t("character.build.cards"), value: item.cards.map((card) => `${card}${itemEffectSummary(t, 4, card)}`).join(" · ") }] : []),
    ],
  }));
}

function artifactBuildItems(t: Translator, artifacts: CharacterArtifact[]): BuildItem[] {
  const artifactCounts = new Map<string, number>();
  for (const artifact of artifacts) artifactCounts.set(artifact.itemId, (artifactCounts.get(artifact.itemId) ?? 0) + 1);
  return artifacts.map((item) => ({
    slot: item.slot, name: item.itemId, refine: item.refine,
    sections: [
      ...itemEffectSections(t, 3, item.itemId, item.refine, artifactCounts.get(item.itemId) ?? 0, item.slot),
      ...(item.substats.length ? [{ label: t("character.build.rolledStats"), value: substatText(t, item.substats) }] : []),
      ...(item.gems.length ? [{ label: t("character.build.gems"), value: item.gems.map((gem) => `${gem.id}${gem.refine ? ` +${gem.refine}` : ""}${itemEffectSummary(t, 5, gem.id, gem.refine)}`).join(" · ") }] : []),
    ],
  }));
}

function substatText(t: Translator, stats: CharacterSubstat[]): string {
  return stats.map((stat) => stat.value === undefined
    ? t("character.build.unrolled", { stat: stat.name, roll: stat.roll })
    : `${stat.name} ${stat.value}${stat.percent ? "%" : ""}`).join(" · ");
}

function itemEffectSections(t: Translator, itemType: number, itemId: string, refine: number, pieces?: number, artifactSlot?: string): BuildSection[] {
  const definition = resolveFishNetItem(itemType, itemId);
  if (!definition) return [];
  const show = formatItemEffects;
  const sections: BuildSection[] = [];
  const slot = isArtifactSlot(artifactSlot) ? artifactSlot : undefined;
  const baseEffects = [...(definition.effects ?? []), ...(slot ? definition.artifactSlotEffects?.[slot] ?? [] : [])];
  const base = show(baseEffects);
  if (base) sections.push({ label: t("character.build.base"), value: base });
  const refineEffects = [...(definition.refineEffects ?? []), ...(slot ? definition.artifactSlotRefineEffects?.[slot] ?? [] : [])];
  if (refine && refineEffects.length) {
    const refined = refineEffects.map((effect) => ({ ...effect, value: effect.value * refine }));
    const text = show(refined);
    if (text) sections.push({ label: t("character.build.refine", { refine }), value: text, tone: "active" });
  }
  if (definition.artifactSet && pieces !== undefined) {
    const set = definition.artifactSet;
    const perPiece = show(set.perPiece);
    if (perPiece) sections.push({ label: t("character.build.set", { pieces, required: set.requiredPieces }), value: perPiece, tone: "active" });
    const full = show(set.fullSet);
    if (full) sections.push({ label: t("character.build.fullSet"), value: full, tone: pieces >= set.requiredPieces ? "active" : "muted" });
  }
  return sections;
}
function itemEffectSummary(t: Translator, itemType: number, itemId: string, refine = 0): string { const values = itemEffectSections(t, itemType, itemId, refine).map((section) => section.value).join(", "); return values ? ` (${values})` : ""; }
function isArtifactSlot(value: string | undefined): value is FishNetArtifactSlot { return value === "Rune" || value === "Jewel" || value === "Scroll" || value === "Relic"; }

function GearTotals({ totals }: { totals: GearStatTotal[] }) {
  const t = useTranslator();
  if (!totals.length) return <div class="gear-totals"><div class="build-empty">{t("character.gearTotals.empty")}</div></div>;
  return (
    <div class="gear-totals">
      {totals.map((stat) => (
        <div class="gear-total" key={stat.name}>
          <span>{stat.name}</span>
          <strong>{signed(stat.total, stat.percent ? "%" : undefined)}{stat.unresolvedRolls ? t("character.gearTotals.unresolvedRolls", { count: stat.unresolvedRolls }) : ""}</strong>
        </div>
      ))}
    </div>
  );
}

function Skills({ skills }: { skills: CharacterSkill[] }) {
  const t = useTranslator();
  if (!skills.length) return <div class="gear-totals"><div class="build-empty">{t("character.skills.empty")}</div></div>;
  return (
    <div class="gear-totals">
      {skills.map((skill) => (
        <div class="gear-total" key={skill.id}>
          <span>{skill.displayName}</span>
          <strong>
            {t("character.skills.level", { level: format(skill.level) })}
            {skill.effects.length ? ` → ${skill.effects.map((effect) => `${signed(effect.value, effect.percent ? "%" : undefined)} ${effect.label}`).join(", ")}` : ""}
          </strong>
        </div>
      ))}
    </div>
  );
}

function StatGroups({ stats, tab }: { stats: CharacterStatBreakdown[]; tab: CharacterStatBreakdown["tab"] }) {
  const t = useTranslator();
  const displayed = stats.filter((stat) => stat.tab === tab);
  if (!displayed.length) {
    return <div class="stat-groups"><div class="build-empty">{t(tab === "advanced" ? "character.stats.emptyAdvanced" : "character.stats.empty")}</div></div>;
  }
  const categories = [...new Set(displayed.map((stat) => stat.category))];
  return (
    <div class="stat-groups">
      {categories.map((category) => (
        <section class="stat-group" key={category}>
          <h3>{category}</h3>
          <div class="stat-column-headings"><span></span><span>{t("character.stats.base")}</span><span>{t("character.stats.calc")}</span><span>{t("character.stats.actual")}</span></div>
          {displayed.filter((entry) => entry.category === category).map((stat) => <StatRow stat={stat} key={stat.id} />)}
        </section>
      ))}
    </div>
  );
}

function StatRow({ stat }: { stat: CharacterStatBreakdown }) {
  const t = useTranslator();
  const drift = stat.record !== undefined && Math.abs(stat.record - stat.value) > Math.max(1, Math.abs(stat.value) * 0.01);
  const inputs = [t("character.stats.gear", { value: signed(stat.gear, stat.unit) }), ...Object.entries(stat.inputs).map(([key, value]) => `${key} ${format(value)}`)].join(" · ");
  return (
    <details class="stat-row">
      <summary>
        <span class="stat-label">{stat.label}</span>
        <span class="stat-value base-value">{valueText(stat.base, stat.unit)}</span>
        <span class="stat-value">{displayedValue(stat, stat.value)}</span>
        <span class={`stat-value record-value ${stat.record === undefined ? "missing" : drift ? "drift" : "match"}`}>
          {stat.record === undefined ? "—" : displayedValue(stat, stat.record)}
        </span>
      </summary>
      <div class="breakdown">
        {drift && <div class="drift-note">{t("character.stats.drift", { value: displayedValue(stat, stat.record!) })}</div>}
        <div class="formula">{stat.formula}</div>
        <div class="inputs">{inputs}</div>
      </div>
    </details>
  );
}

function displayedValue(stat: CharacterStatBreakdown, value: number): string {
  return stat.id === "gear-stat-101" ? `+${valueText(value, stat.unit)}` : valueText(value, stat.unit);
}

function format(value: number): string { return new Intl.NumberFormat().format(value); }
function valueText(value: number, unit?: "%"): string { return `${format(value)}${unit ?? ""}`; }
function signed(value: number, unit?: "%"): string { return `${value > 0 ? "+" : ""}${valueText(value, unit)}`; }
function duration(seconds: number): string { const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60); return `${format(hours)}h ${minutes}m`; }

render(<App />, document.getElementById("root")!);
