import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { initWindowChrome, type WindowChrome } from "@svoverlay/ui-kit/window-chrome";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterRpc } from "../../character/rpc.ts";

type Tab = "basic" | "gear" | "advanced" | "skills";
import { Attributes, Build, GearTotals, HistoryGrid, Skills, StatGroups, artifactBuildItems, equipmentBuildItems, format, history } from "./character-content.tsx";

const state = signal<CharacterViewState | undefined>(undefined);
const rpc = Electroview.defineRPC<CharacterRpc>({ handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } } });
const electroview = new Electroview({ rpc });
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

render(<App />, document.getElementById("root")!);
