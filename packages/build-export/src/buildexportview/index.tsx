import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { DesktopTitleBar } from "@svoverlay/ui-kit/desktop-title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { formatMeasuredAt } from "@svoverlay/ui-kit/format";
import { classIconUrl } from "@svoverlay/ui-kit/class-icon";

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
  const [confirmAction, setConfirmAction] = useState<"clear" | "delete" | undefined>();
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
  async function confirmRosterChange(): Promise<void> {
    const request = confirmAction === "clear"
      ? electroview.rpc!.request.clearInspectedCharacters({})
      : state ? electroview.rpc!.request.deleteInspectedCharacter({ id: state.selectedId }) : undefined;
    setConfirmAction(undefined);
    if (request) await update(request);
  }
  const selectedInspected = state?.selectedId.startsWith("inspect:") ?? false;
  const character = state?.character;
  const ready = state?.status === "ready";
  const onlySelf = state?.sources.length === 1 && state.sources[0]?.kind === "self";

  return <div class="app-shell">
    <DesktopTitleBar appTag="Build Export" minWidth={MINIMUM_WIDTH} minHeight={MINIMUM_HEIGHT}
      defaultWidth={MINIMUM_WIDTH}
      defaultHeight={MINIMUM_HEIGHT}
      requests={electroview.rpc?.request}
      extraControls={<SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />}
    />
    <div class="export-body">
      <div class="export-head"><h1>Open this character in the build planner</h1><p>{state?.statusDetail ?? "Loading…"}</p></div>
      <div class="export-layout">
        <aside class="roster" aria-label="Captured characters">
          <div class="roster-head"><div><strong>Saved players</strong><span>{state?.inspectedCount ?? 0} inspected builds</span></div></div>
          <label class="field roster-search"><span aria-hidden="true">⌕</span><input value={state?.searchQuery ?? ""} onInput={(event) => void update(electroview.rpc!.request.setSearch({ query: event.currentTarget.value }))} placeholder="Search name or class" aria-label="Search saved players" /></label>
          <div class="roster-list" role="tablist" aria-label="Captured characters">
            {state?.sources.map((source) => <button key={source.id} type="button" role="tab" aria-selected={source.id === state.selectedId} class={`roster-row${source.id === state.selectedId ? " is-active" : ""}`} onClick={() => void update(electroview.rpc!.request.selectCharacter({ id: source.id }))}>
              <img class="roster-class-icon" src={classIconUrl(source.cls)} alt="" /><span class="roster-player"><strong>{source.name}</strong><span>{source.kind === "self" ? "Your character" : `${source.cls} · Level ${source.level}`}</span></span>{source.inspectedAt ? <time title={`Inspected ${new Date(source.inspectedAt).toLocaleString()}`}>{formatMeasuredAt(source.inspectedAt)}</time> : <span class="roster-you">You</span>}
            </button>)}
            {onlySelf && state?.searchQuery ? <p class="roster-empty">No saved players match this search.</p> : null}
            {!state?.sources.length ? <p class="roster-empty">Inspect a player to save them here.</p> : null}
          </div>
          <button class="btn btn-ghost roster-clear" type="button" disabled={!state?.inspectedCount} onClick={() => setConfirmAction("clear")}>Clear saved roster</button>
        </aside>
        <section class="export-detail">
          {character ? <CharacterCard character={character} /> : <div class="character-card"><span class="meta">No character captured yet.</span></div>}
          <div class="report">
            {state?.notes.map((note) => <p class="note" key={note}>{note}</p>)}
            {state && state.unresolved.length > 0 ? <><h2>Left out</h2>{state.unresolved.map((group) => <div class="unresolved-group" key={group.group}><div class="group">{GROUP_LABELS[group.group] ?? group.group}</div><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</> : ready ? <p class="clean">Everything on this character matched the planner's catalog.</p> : null}
          </div>
          <div class="actions"><div class="planner-actions"><button class="btn btn-primary planner-open" type="button" disabled={!ready} onClick={() => void update(electroview.rpc!.request.exportToPlanner({}))}><span aria-hidden="true">↗</span> Open in planner</button><button class="btn planner-copy" type="button" disabled={!ready} onClick={() => void copyLink()}><span aria-hidden="true">{copied ? "✓" : "⧉"}</span> {copied ? "Link copied" : "Copy planner link"}</button></div>{selectedInspected ? <button class="btn danger-button" type="button" onClick={() => setConfirmAction("delete")}>Remove player</button> : null}<span class="grow" />{state?.lastExportedAt ? <span class="confirm">Opened {new Date(state.lastExportedAt).toLocaleTimeString()}</span> : null}</div>
        </section>
      </div>
      <div class="provenance"><div>Catalog snapshot from game build {state?.snapshotGameBuild || "unknown"}{state?.snapshotGameLabel ? ` (${state.snapshotGameLabel})` : ""}{state?.snapshotGeneratedAt ? `, generated ${new Date(state.snapshotGeneratedAt).toLocaleDateString()}` : ""}.</div><div>Item and skill data derived from <a href="#" onClick={(event) => { event.preventDefault(); void electroview.rpc?.request.openSite({}); }}>spiritvalers.com</a>. The planner link carries your build in the URL fragment, which never leaves your browser.</div></div>
    </div>
    {confirmAction ? <div class="modal-layer" role="presentation"><section class="modal-card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div class="modal-head"><div><h2 id="confirm-title">{confirmAction === "clear" ? "Clear saved roster?" : "Remove saved player?"}</h2><p>{confirmAction === "clear" ? "This removes every inspected player from this device." : `Remove ${state?.character?.name ?? "this player"} from the saved roster.`}</p></div><button class="modal-close" type="button" aria-label="Cancel" onClick={() => setConfirmAction(undefined)}>×</button></div><div class="modal-actions"><button class="btn" type="button" onClick={() => setConfirmAction(undefined)}>Cancel</button><button class="btn danger-button" type="button" onClick={() => void confirmRosterChange()}>{confirmAction === "clear" ? "Clear roster" : "Remove player"}</button></div></section></div> : null}
  </div>;
}

function CharacterCard({ character }: { character: NonNullable<BuildExportState["character"]> }) {
  const summary = character.base && character.base !== character.cls ? `${character.base} › ${character.cls}` : character.cls;
  const values = [[character.equipmentCount, "Equipment"], [character.cardCount, "Cards"], [character.artifactCount, "Artifacts"], [character.gemCount, "Gems"], [character.skillCount, "Skills"], [character.grimoireCount, "Grimoires"], ...(character.weaponSetCount === undefined ? [] : [[character.weaponSetCount, "Weapon sets"]])];
  return <div class="character-card"><div class="who"><span class="name">{character.name}</span><span class="meta">{summary} · Level {character.level} · Job {character.jobLevel}{character.inspectedAt ? ` · inspected ${new Date(character.inspectedAt).toLocaleString()}` : ""}</span></div><div class="tally">{values.map(([value, label]) => <div key={label}><span class="n">{value}</span><span class="k">{label}</span></div>)}</div></div>;
}

render(<App />, document.getElementById("root")!);
