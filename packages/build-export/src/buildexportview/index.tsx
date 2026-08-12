import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type { BuildExportRpc, BuildExportState } from "../app-types.ts";

const MINIMUM_WIDTH = 760;
const MINIMUM_HEIGHT = 560;
let setStateExternal: ((next: BuildExportState) => void) | undefined;

const rpc = Electroview.defineRPC<BuildExportRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => setStateExternal?.(repairRendererPayload(next)) } },
});
const electroview = new Electroview({ rpc });
void ensureInitialWindowSize(electroview.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });

const GROUP_LABELS: Record<string, string> = { equipment: "Equipment", cards: "Cards", artifacts: "Artifacts", gems: "Gems", grimoires: "Grimoires", skills: "Skills", substats: "Substats", classes: "Classes" };

function App() {
  const [state, setState] = useState<BuildExportState>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setStateExternal = setState;
    void electroview.rpc?.request.getState({}).then((next) => setState(repairRendererPayload(next)));
    return () => { setStateExternal = undefined; };
  }, []);

  async function update(request: Promise<BuildExportState | undefined>): Promise<void> {
    const next = await request;
    if (next) setState(repairRendererPayload(next));
  }
  async function copyLink(): Promise<void> {
    const response = await electroview.rpc?.request.getPlannerLink({});
    if (!response?.link) return;
    await navigator.clipboard.writeText(response.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }
  const selectedInspected = state?.selectedId.startsWith("inspect:") ?? false;
  const character = state?.character;
  const ready = state?.status === "ready";
  const onlySelf = state?.sources.length === 1 && state.sources[0]?.kind === "self";

  return <div class="app-shell">
    <TitleBar appTag="Build Export" minWidth={MINIMUM_WIDTH} minHeight={MINIMUM_HEIGHT}
      getFrame={() => electroview.rpc!.request.getWindowFrame({})}
      setFrame={(frame) => electroview.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      extraControls={<SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />}
    />
    <div class="export-body">
      <div class="export-head"><h1>Open this character in the build planner</h1><p>{state?.statusDetail ?? "Loading…"}</p></div>
      <div class="export-layout">
        <aside class="roster" aria-label="Captured characters">
          <div class="roster-head"><strong>Roster</strong><span>{state?.inspectedCount ?? 0} saved</span></div>
          <label class="field roster-search"><span aria-hidden="true">⌕</span><input value={state?.searchQuery ?? ""} onInput={(event) => void update(electroview.rpc!.request.setSearch({ query: event.currentTarget.value }))} placeholder="Search name or class" aria-label="Search saved players" /></label>
          <div class="roster-list" role="tablist" aria-label="Captured characters">
            {state?.sources.map((source) => <button key={source.id} type="button" role="tab" aria-selected={source.id === state.selectedId} class={`roster-row${source.id === state.selectedId ? " is-active" : ""}`} onClick={() => void update(electroview.rpc!.request.selectCharacter({ id: source.id }))}>
              <strong>{source.name}</strong><span>{source.kind === "self" ? "You" : `${source.cls} · Lv ${source.level}`}</span>{source.inspectedAt ? <time>{new Date(source.inspectedAt).toLocaleDateString()}</time> : null}
            </button>)}
            {onlySelf && state?.searchQuery ? <p class="roster-empty">No saved players match this search.</p> : null}
            {!state?.sources.length ? <p class="roster-empty">Inspect a player to save them here.</p> : null}
          </div>
          <button class="roster-clear" type="button" disabled={!state?.inspectedCount} onClick={() => { if (window.confirm("Remove every inspected player from the saved roster?")) void update(electroview.rpc!.request.clearInspectedCharacters({})); }}>Clear saved roster</button>
        </aside>
        <section class="export-detail">
          {character ? <CharacterCard character={character} /> : <div class="character-card"><span class="meta">No character captured yet.</span></div>}
          <div class="report">
            {state?.notes.map((note) => <p class="note" key={note}>{note}</p>)}
            {state && state.unresolved.length > 0 ? <><h2>Left out</h2>{state.unresolved.map((group) => <div class="unresolved-group" key={group.group}><div class="group">{GROUP_LABELS[group.group] ?? group.group}</div><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</> : ready ? <p class="clean">Everything on this character matched the planner's catalog.</p> : null}
          </div>
          <div class="actions"><button class="primary-button" type="button" disabled={!ready} onClick={() => void update(electroview.rpc!.request.exportToPlanner({}))}>Open in build planner</button><button class="secondary-button" type="button" disabled={!ready} onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</button>{selectedInspected ? <button class="danger-button" type="button" onClick={() => { if (window.confirm("Remove this inspected player from the saved roster?")) void update(electroview.rpc!.request.deleteInspectedCharacter({ id: state!.selectedId })); }}>Remove player</button> : null}<span class="grow" />{state?.lastExportedAt ? <span class="confirm">Opened {new Date(state.lastExportedAt).toLocaleTimeString()}</span> : null}</div>
        </section>
      </div>
      <div class="provenance"><div>Catalog snapshot from game build {state?.snapshotGameBuild || "unknown"}{state?.snapshotGameLabel ? ` (${state.snapshotGameLabel})` : ""}{state?.snapshotGeneratedAt ? `, generated ${new Date(state.snapshotGeneratedAt).toLocaleDateString()}` : ""}.</div><div>Item and skill data derived from <a href="#" onClick={(event) => { event.preventDefault(); void electroview.rpc?.request.openSite({}); }}>spiritvalers.com</a>. The planner link carries your build in the URL fragment, which never leaves your browser.</div></div>
    </div>
  </div>;
}

function CharacterCard({ character }: { character: NonNullable<BuildExportState["character"]> }) {
  const summary = character.base && character.base !== character.cls ? `${character.base} › ${character.cls}` : character.cls;
  const values = [[character.equipmentCount, "Equipment"], [character.cardCount, "Cards"], [character.artifactCount, "Artifacts"], [character.gemCount, "Gems"], [character.skillCount, "Skills"], [character.grimoireCount, "Grimoires"], ...(character.weaponSetCount === undefined ? [] : [[character.weaponSetCount, "Weapon sets"]])];
  return <div class="character-card"><div class="who"><span class="name">{character.name}</span><span class="meta">{summary} · Level {character.level} · Job {character.jobLevel}{character.inspectedAt ? ` · inspected ${new Date(character.inspectedAt).toLocaleString()}` : ""}</span></div><div class="tally">{values.map(([value, label]) => <div key={label}><span class="n">{value}</span><span class="k">{label}</span></div>)}</div></div>;
}

render(<App />, document.getElementById("root")!);
