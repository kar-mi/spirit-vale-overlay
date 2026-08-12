import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type { BuildExportState } from "../app-types.ts";
import type { BuildExportRpc } from "../app-types.ts";

const MINIMUM_WIDTH = 520;
const MINIMUM_HEIGHT = 520;

let setStateExternal: ((next: BuildExportState) => void) | undefined;

const rpc = Electroview.defineRPC<BuildExportRpc>({
  handlers: {
    requests: {},
    messages: { stateChanged: (next) => setStateExternal?.(repairRendererPayload(next)) },
  },
});
const electroview = new Electroview({ rpc });
void ensureInitialWindowSize(electroview.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });

const GROUP_LABELS: Record<string, string> = {
  equipment: "Equipment",
  cards: "Cards",
  artifacts: "Artifacts",
  gems: "Gems",
  grimoires: "Grimoires",
  skills: "Skills",
  substats: "Substats",
  classes: "Classes",
};

function App() {
  const [state, setState] = useState<BuildExportState | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStateExternal = setState;
    void electroview.rpc?.request.getState({}).then((next) => setState(repairRendererPayload(next)));
    return () => { setStateExternal = undefined; };
  }, []);

  // These requests answer with the new state. Nothing publishes a stateChanged for them, so the
  // response has to be applied here or the click appears to do nothing.
  async function selectCharacter(id: string): Promise<void> {
    const next = await electroview.rpc?.request.selectCharacter({ id });
    if (next) setState(repairRendererPayload(next));
  }

  async function exportToPlanner(): Promise<void> {
    const next = await electroview.rpc?.request.exportToPlanner({});
    if (next) setState(repairRendererPayload(next));
  }

  async function copyLink(): Promise<void> {
    const response = await electroview.rpc?.request.getPlannerLink({});
    if (!response?.link) return;
    await navigator.clipboard.writeText(response.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  const character = state?.character;
  const ready = state?.status === "ready";

  return (
    <div class="app-shell">
      <TitleBar
        appTag="Build Export"
        minWidth={MINIMUM_WIDTH}
        minHeight={MINIMUM_HEIGHT}
        getFrame={() => electroview.rpc!.request.getWindowFrame({})}
        setFrame={(frame) => electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
        extraControls={<SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />}
      />

      <div class="export-body">
        <div class="export-head">
          <h1>Open this character in the build planner</h1>
          <p>{state?.statusDetail ?? "Loading\u2026"}</p>
        </div>

        {state && state.sources.length > 1
          ? (
            <div class="source-picker" role="tablist" aria-label="Captured characters">
              {state.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="tab"
                  aria-selected={source.id === state.selectedId}
                  class={`source-tab${source.id === state.selectedId ? " is-active" : ""}`}
                  onClick={() => void selectCharacter(source.id)}
                >
                  <strong>{source.name}</strong>
                  <span>{source.kind === "self" ? "You" : `${source.cls} \u00b7 Lv ${source.level}`}</span>
                </button>
              ))}
            </div>
          )
          : null}

        {character
          ? (
            <div class="character-card">
              <div class="who">
                <span class="name">{character.name}</span>
                <span class="meta">
                  {character.base && character.base !== character.cls
                    ? `${character.base} \u203a ${character.cls}`
                    : character.cls}
                  {" \u00b7 "}Level {character.level}
                  {" \u00b7 "}Job {character.jobLevel}
                  {character.inspectedAt
                    ? ` \u00b7 inspected ${new Date(character.inspectedAt).toLocaleTimeString()}`
                    : ""}
                </span>
              </div>
              <div class="tally">
                <div><span class="n">{character.equipmentCount}</span><span class="k">Equipment</span></div>
                <div><span class="n">{character.cardCount}</span><span class="k">Cards</span></div>
                <div><span class="n">{character.artifactCount}</span><span class="k">Artifacts</span></div>
                <div><span class="n">{character.gemCount}</span><span class="k">Gems</span></div>
                <div><span class="n">{character.skillCount}</span><span class="k">Skills</span></div>
                <div><span class="n">{character.grimoireCount}</span><span class="k">Grimoires</span></div>
                {character.weaponSetCount === undefined
                  ? null
                  : <div><span class="n">{character.weaponSetCount}</span><span class="k">Weapon sets</span></div>}
              </div>
            </div>
          )
          : <div class="character-card"><span class="meta">No character captured yet.</span></div>}

        <div class="report">
          {state?.notes.map((note) => <p class="note" key={note}>{note}</p>)}
          {state && state.unresolved.length > 0
            ? (
              <>
                <h2>Left out</h2>
                {state.unresolved.map((group) => (
                  <div class="unresolved-group" key={group.group}>
                    <div class="group">{GROUP_LABELS[group.group] ?? group.group}</div>
                    <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ))}
              </>
            )
            : ready
              ? <p class="clean">Everything on this character matched the planner's catalog.</p>
              : null}
        </div>

        <div class="actions">
          <button
            class="primary-button"
            type="button"
            disabled={!ready}
            onClick={() => void exportToPlanner()}
          >
            Open in build planner
          </button>
          <button class="secondary-button" type="button" disabled={!ready} onClick={() => void copyLink()}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <span class="grow" />
          {state?.lastExportedAt
            ? <span class="confirm">Opened {new Date(state.lastExportedAt).toLocaleTimeString()}</span>
            : null}
        </div>

        <div class="provenance">
          <div>
            Catalog snapshot from game build {state?.snapshotGameBuild || "unknown"}
            {state?.snapshotGameLabel ? ` (${state.snapshotGameLabel})` : ""}
            {state?.snapshotGeneratedAt
              ? `, generated ${new Date(state.snapshotGeneratedAt).toLocaleDateString()}`
              : ""}.
          </div>
          <div>
            Item and skill data derived from{" "}
            <a
              href="#"
              onClick={(event) => { event.preventDefault(); void electroview.rpc?.request.openSite({}); }}
            >
              spiritvalers.com
            </a>
            . The planner link carries your build in the URL fragment, which never leaves your browser.
          </div>
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
