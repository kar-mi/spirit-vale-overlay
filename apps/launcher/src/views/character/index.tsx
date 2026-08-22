import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { initWindowChrome, type WindowChrome } from "@svoverlay/ui-kit/window-chrome";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
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
import { formatItemEffects } from "./item-effects.ts";

const ATTRIBUTE_NAMES = ["STR", "VIT", "AGI", "DEX", "INT", "LUK"] as const;
type Tab = "basic" | "gear" | "advanced" | "skills";
interface BuildSection { label: string; value: string; tone?: "active" | "muted"; }
interface BuildItem { slot: string; name: string; refine: number; sections: BuildSection[]; }

const state = signal<CharacterViewState | undefined>(undefined);
const rpc = DesktopView.defineRPC<CharacterRpc>({ handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } } });
const electroview = new DesktopView({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const CHARACTER_DEFAULT_WIDTH = 920;
const CHARACTER_DEFAULT_HEIGHT = 720;
void ensureInitialWindowSize(electroview.rpc?.request, { width: 680, height: 520 });

function App() {
  const [tab, setTab] = useState<Tab>("basic");
  const chromeRef = useRef<WindowChrome | undefined>(undefined);
  const titlebarRef = (node: HTMLElement | null): void => {
    if (!node || chromeRef.current) return;
    chromeRef.current = initWindowChrome({
      titlebar: node, minWidth: 680, minHeight: 520,
      getFrame: async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: CHARACTER_DEFAULT_WIDTH, height: CHARACTER_DEFAULT_HEIGHT },
      setFrame: (frame) => void electroview.rpc?.request.setWindowFrame(frame),
    });
  };

  const next = state.value;
  const character = next?.snapshot;

  return (
    <main class="app-shell">
      <header ref={titlebarRef} class="titlebar">
        <div class="brand">
          <img class="brand-icon" src="views://assets/app-icon.png" alt="" />
          <span>Character</span>
          <span class="brand-tag">{next?.status === "live" ? "Live" : next?.status === "cached" ? "Last known" : "Waiting"}</span>
        </div>
        <div class="window-controls">
          <button class="icon-button" type="button" aria-label="Settings" title="Settings" onClick={() => void electroview.rpc?.request.openSettings({})}>⚙</button>
          <button class="icon-button" type="button" aria-label="Minimize" onClick={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}>−</button>
          <button class="icon-button close-button" type="button" aria-label="Close" onClick={() => void electroview.rpc?.request.windowAction({ action: "close" })}>×</button>
        </div>
      </header>
      <div class="content">
        {!character && (
          <section class="empty-state">
            <strong>Waiting for your character</strong>
            <p>Open or switch to a character in Spirit Vale while capture is active.</p>
          </section>
        )}
        {character && next && (
          <div>
            <section class="hero card">
              <div>
                <p class="eyebrow">Current character</p>
                <h1>{character.title ? `${character.name} · ${character.title}` : character.name}</h1>
                <p class="muted">{character.archetypes.length ? character.archetypes.join(" / ") : "Novice"}</p>
              </div>
              <div class="progression">
                <div><span>Level</span><strong>{format(character.level)}</strong></div>
                <div><span>Job</span><strong>{format(character.jobLevel)}</strong></div>
                <div><span>XP</span><strong>{format(character.experience)}</strong></div>
                <div><span>Job XP</span><strong>{format(character.jobExperience)}</strong></div>
                {next.records?.maxHealth !== undefined && (
                  <div class="record-tile"><span>HP · live</span><strong>{format(next.records.maxHealth)}</strong></div>
                )}
                {next.records?.maxMana !== undefined && (
                  <div class="record-tile"><span>MP · live</span><strong>{format(next.records.maxMana)}</strong></div>
                )}
                {next.records?.moveSpeed !== undefined && (
                  <div class="record-tile"><span>Speed · live</span><strong>{next.records.moveSpeed.toFixed(2)}</strong></div>
                )}
              </div>
            </section>
            <p class="status-detail">
              {next.status === "cached"
                ? `${next.statusDetail} · updated ${new Date(character.updatedAt).toLocaleString()}`
                : next.statusDetail}
            </p>
            <div class="tab-bar" role="tablist" aria-label="Character information">
              {(["basic", "gear", "advanced", "skills"] as const).map((tabId) => (
                <button
                  key={tabId}
                  class={tab === tabId ? "tab-button active" : "tab-button"}
                  type="button"
                  role="tab"
                  aria-selected={tab === tabId}
                  onClick={() => setTab(tabId)}
                >
                  {tabId === "basic" ? "Basic" : tabId === "gear" ? "Gear" : tabId === "advanced" ? "Advanced" : "Skills"}
                </button>
              ))}
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "basic"}>
              <section class="card"><h2>Attributes</h2><Attributes attributes={character.attributes} /></section>
              {history(character).length > 0 && (
                <section class="card"><h2>Character history</h2><HistoryGrid entries={history(character)} /></section>
              )}
              <section class="card">
                <div class="section-heading"><div><h2>Calculated stats</h2><p>Static, unbuffed values from the current saved build.</p></div></div>
                <StatGroups stats={next.stats} tab="basic" />
              </section>
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "gear"}>
              <section class="card">
                <div class="section-heading"><div><h2>Build</h2><p>{character.activeLoadout} loadout · rolled substats shown at their in-game scaled values</p></div></div>
                <div class="build-columns">
                  <div><h3>Equipment</h3><Build items={equipmentBuildItems(character.equipment)} /></div>
                  <div><h3>Artifacts</h3><Build items={artifactBuildItems(character.artifacts)} /></div>
                </div>
              </section>
              <section class="card"><h2>Gear totals</h2><GearTotals totals={next.gearTotals} /></section>
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "advanced"}>
              <section class="card">
                <div class="section-heading"><div><h2>Advanced stats</h2><p>Gear-granted values only; no base formula is known for these effects.</p></div></div>
                <StatGroups stats={next.stats} tab="advanced" />
              </section>
            </div>
            <div class="tab-panel" role="tabpanel" hidden={tab !== "skills"}>
              <section class="card"><h2>Skills</h2><Skills skills={character.skills} /></section>
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

function history(character: CharacterSnapshot): Array<[string, string]> {
  return [
    ["Playtime", character.playtimeSeconds === undefined ? undefined : duration(character.playtimeSeconds)],
    ["Monster kills", character.monsterKills === undefined ? undefined : format(character.monsterKills)],
    ["Boss kills", character.bossKills === undefined ? undefined : format(character.bossKills)],
    ["Deaths", character.deaths === undefined ? undefined : format(character.deaths)],
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
  if (!items.length) return <div class="build-list"><div class="build-empty">No items captured in this loadout.</div></div>;
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
              : <div class="build-empty">No stats or effects</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function equipmentBuildItems(equipment: CharacterEquipment[]): BuildItem[] {
  return equipment.map((item) => ({
    slot: item.slot, name: item.itemId, refine: item.refine,
    sections: [
      ...itemEffectSections(2, item.itemId, item.refine),
      ...(item.substats.length ? [{ label: "Rolled stats", value: substatText(item.substats) }] : []),
      ...(item.cards.length ? [{ label: "Cards", value: item.cards.map((card) => `${card}${itemEffectSummary(4, card)}`).join(" · ") }] : []),
    ],
  }));
}

function artifactBuildItems(artifacts: CharacterArtifact[]): BuildItem[] {
  const artifactCounts = new Map<string, number>();
  for (const artifact of artifacts) artifactCounts.set(artifact.itemId, (artifactCounts.get(artifact.itemId) ?? 0) + 1);
  return artifacts.map((item) => ({
    slot: item.slot, name: item.itemId, refine: item.refine,
    sections: [
      ...itemEffectSections(3, item.itemId, item.refine, artifactCounts.get(item.itemId) ?? 0, item.slot),
      ...(item.substats.length ? [{ label: "Rolled stats", value: substatText(item.substats) }] : []),
      ...(item.gems.length ? [{ label: "Gems", value: item.gems.map((gem) => `${gem.id}${gem.refine ? ` +${gem.refine}` : ""}${itemEffectSummary(5, gem.id, gem.refine)}`).join(" · ") }] : []),
    ],
  }));
}

function substatText(stats: CharacterSubstat[]): string {
  return stats.map((stat) => stat.value === undefined ? `${stat.name} (roll ${stat.roll})` : `${stat.name} ${stat.value}${stat.percent ? "%" : ""}`).join(" · ");
}

function itemEffectSections(itemType: number, itemId: string, refine: number, pieces?: number, artifactSlot?: string): BuildSection[] {
  const definition = resolveFishNetItem(itemType, itemId);
  if (!definition) return [];
  const show = formatItemEffects;
  const sections: BuildSection[] = [];
  const slot = isArtifactSlot(artifactSlot) ? artifactSlot : undefined;
  const baseEffects = [...(definition.effects ?? []), ...(slot ? definition.artifactSlotEffects?.[slot] ?? [] : [])];
  const base = show(baseEffects);
  if (base) sections.push({ label: "Base", value: base });
  const refineEffects = [...(definition.refineEffects ?? []), ...(slot ? definition.artifactSlotRefineEffects?.[slot] ?? [] : [])];
  if (refine && refineEffects.length) {
    const refined = refineEffects.map((effect) => ({ ...effect, value: effect.value * refine }));
    const text = show(refined);
    if (text) sections.push({ label: `Refine +${refine}`, value: text, tone: "active" });
  }
  if (definition.artifactSet && pieces !== undefined) {
    const set = definition.artifactSet;
    const perPiece = show(set.perPiece);
    if (perPiece) sections.push({ label: `Set ${pieces}/${set.requiredPieces}`, value: perPiece, tone: "active" });
    const full = show(set.fullSet);
    if (full) sections.push({ label: "Full set", value: full, tone: pieces >= set.requiredPieces ? "active" : "muted" });
  }
  return sections;
}
function itemEffectSummary(itemType: number, itemId: string, refine = 0): string { const values = itemEffectSections(itemType, itemId, refine).map((section) => section.value).join(", "); return values ? ` (${values})` : ""; }
function isArtifactSlot(value: string | undefined): value is FishNetArtifactSlot { return value === "Rune" || value === "Jewel" || value === "Scroll" || value === "Relic"; }

function GearTotals({ totals }: { totals: GearStatTotal[] }) {
  if (!totals.length) return <div class="gear-totals"><div class="build-empty">No rolled substats captured in this loadout.</div></div>;
  return (
    <div class="gear-totals">
      {totals.map((stat) => (
        <div class="gear-total" key={stat.name}>
          <span>{stat.name}</span>
          <strong>{signed(stat.total, stat.percent ? "%" : undefined)}{stat.unresolvedRolls ? ` · roll ${stat.unresolvedRolls}` : ""}</strong>
        </div>
      ))}
    </div>
  );
}

function Skills({ skills }: { skills: CharacterSkill[] }) {
  if (!skills.length) return <div class="gear-totals"><div class="build-empty">No learned skills captured.</div></div>;
  return (
    <div class="gear-totals">
      {skills.map((skill) => (
        <div class="gear-total" key={skill.id}>
          <span>{skill.displayName}</span>
          <strong>
            Lv {format(skill.level)}
            {skill.effects.length ? ` → ${skill.effects.map((effect) => `${signed(effect.value, effect.percent ? "%" : undefined)} ${effect.label}`).join(", ")}` : ""}
          </strong>
        </div>
      ))}
    </div>
  );
}

function StatGroups({ stats, tab }: { stats: CharacterStatBreakdown[]; tab: CharacterStatBreakdown["tab"] }) {
  const displayed = stats.filter((stat) => stat.tab === tab);
  if (!displayed.length) {
    return <div class="stat-groups"><div class="build-empty">{tab === "advanced" ? "No additional gear-granted stats in this loadout." : "No calculated stats available."}</div></div>;
  }
  const categories = [...new Set(displayed.map((stat) => stat.category))];
  return (
    <div class="stat-groups">
      {categories.map((category) => (
        <section class="stat-group" key={category}>
          <h3>{category}</h3>
          <div class="stat-column-headings"><span></span><span>Base</span><span>Calc</span><span>Actual</span></div>
          {displayed.filter((entry) => entry.category === category).map((stat) => <StatRow stat={stat} key={stat.id} />)}
        </section>
      ))}
    </div>
  );
}

function StatRow({ stat }: { stat: CharacterStatBreakdown }) {
  const drift = stat.record !== undefined && Math.abs(stat.record - stat.value) > Math.max(1, Math.abs(stat.value) * 0.01);
  const inputs = [`Gear ${signed(stat.gear, stat.unit)}`, ...Object.entries(stat.inputs).map(([key, value]) => `${key} ${format(value)}`)].join(" · ");
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
        {drift && <div class="drift-note">{`Server reports ${displayedValue(stat, stat.record!)} — the calculation misses a cap or modifier.`}</div>}
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
