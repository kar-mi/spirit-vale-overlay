import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { formatMeasuredAt } from "@svoverlay/ui-kit/format";
import { classIconUrlForName } from "@svoverlay/ui-kit/class-display";

import { useTranslator } from "@svoverlay/i18n/browser";
import type { MessageKey } from "@svoverlay/i18n/messages";

import type { BuildExportRpc, BuildExportState } from "../app-types.ts";

const MINIMUM_WIDTH = 760;
const MINIMUM_HEIGHT = 560;
let setStateExternal: ((next: BuildExportState) => void) | undefined;

const rpc = DesktopView.defineRPC<BuildExportRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => setStateExternal?.(repairRendererPayload(next)) } },
});
const desktopView = new DesktopView({ rpc });
void ensureInitialWindowSize(desktopView.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });

const GROUP_LABEL_KEYS: Record<string, MessageKey> = {
  equipment: "buildExport.group.equipment", cards: "buildExport.group.cards",
  artifacts: "buildExport.group.artifacts", gems: "buildExport.group.gems",
  grimoires: "buildExport.group.grimoires", skills: "buildExport.group.skills",
  substats: "buildExport.group.substats", classes: "buildExport.group.classes",
};

function App() {
  const t = useTranslator();
  const [state, setState] = useState<BuildExportState>();
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"clear" | "delete" | undefined>();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setStateExternal = setState;
    void desktopView.rpc?.request.getState({}).then((next) => setState(repairRendererPayload(next)));
    return () => { setStateExternal = undefined; };
  }, []);

  async function update(request: Promise<BuildExportState | undefined>): Promise<void> {
    const next = await request;
    if (next) setState(repairRendererPayload(next));
  }
  async function copyLink(): Promise<void> {
    const response = await desktopView.rpc?.request.getPlannerLink({});
    if (!response?.link) return;
    await navigator.clipboard.writeText(response.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }
  async function confirmRosterChange(): Promise<void> {
    const request = confirmAction === "clear"
      ? desktopView.rpc!.request.clearInspectedCharacters({})
      : state ? desktopView.rpc!.request.deleteInspectedCharacter({ id: state.selectedId }) : undefined;
    setConfirmAction(undefined);
    if (request) await update(request);
  }
  useEffect(() => {
    if (!confirmAction) return;
    confirmButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmRosterChange();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [confirmAction]);
  const selectedInspected = state?.selectedId.startsWith("inspect:") ?? false;
  const character = state?.character;
  const ready = state?.status === "ready";
  const onlySelf = state?.sources.length === 1 && state.sources[0]?.kind === "self";

  return <div class="app-shell">
    <TitleBar appTag={t("buildExport.window.tag")} minWidth={MINIMUM_WIDTH} minHeight={MINIMUM_HEIGHT}
      getFrame={() => desktopView.rpc!.request.getWindowFrame({})}
      setFrame={(frame) => desktopView.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
      extraControls={<SettingsButton onClick={() => void desktopView.rpc?.request.openSettings({})} />}
    />
    <div class="export-body">
      <div class="export-head"><h1>{t("buildExport.heading")}</h1><p>{t.text(state?.statusDetail) ?? t("buildExport.loading")}</p></div>
      <div class="export-layout">
        <aside class="roster" aria-label={t("buildExport.roster.label")}>
          <div class="roster-head"><div><strong>{t("buildExport.roster.heading")}</strong><span>{t("buildExport.roster.count", { count: state?.inspectedCount ?? 0 })}</span></div></div>
          <label class="field roster-search"><span aria-hidden="true">⌕</span><input value={state?.searchQuery ?? ""} onInput={(event) => void update(desktopView.rpc!.request.setSearch({ query: event.currentTarget.value }))} placeholder={t("buildExport.roster.searchPlaceholder")} aria-label={t("buildExport.roster.searchAria")} /></label>
          <div class="roster-list" role="tablist" aria-label={t("buildExport.roster.label")}>
            {state?.sources.map((source) => <button key={source.id} type="button" role="tab" aria-selected={source.id === state.selectedId} class={`roster-row${source.id === state.selectedId ? " is-active" : ""}`} onClick={() => void update(desktopView.rpc!.request.selectCharacter({ id: source.id }))}>
              <img class="roster-class-icon" src={rosterClassIcon(source.cls)} alt="" /><span class="roster-player"><strong>{source.name}</strong><span>{source.kind === "self" ? t("buildExport.roster.self") : t("buildExport.roster.other", { cls: source.cls, level: source.level })}</span></span>{source.inspectedAt ? <time title={t("buildExport.roster.inspectedTitle", { when: new Date(source.inspectedAt).toLocaleString() })}>{formatMeasuredAt(source.inspectedAt)}</time> : <span class="roster-you">{t("buildExport.roster.you")}</span>}
            </button>)}
            {onlySelf && state?.searchQuery ? <p class="roster-empty">{t("buildExport.roster.noMatch")}</p> : null}
            {!state?.sources.length ? <p class="roster-empty">{t("buildExport.roster.empty")}</p> : null}
          </div>
          <button class="btn btn-ghost roster-clear" type="button" disabled={!state?.inspectedCount} onClick={() => setConfirmAction("clear")}>{t("buildExport.roster.clear")}</button>
        </aside>
        <section class="export-detail">
          {character ? <CharacterCard character={character} /> : <div class="character-card"><span class="meta">{t("buildExport.character.none")}</span></div>}
          <div class="report">
            {state?.notes.map((note) => <p class="note" key={note}>{note}</p>)}
            {state && state.unresolved.length > 0 ? <><h2>{t("buildExport.leftOut")}</h2>{state.unresolved.map((group) => <div class="unresolved-group" key={group.group}><div class="group">{GROUP_LABEL_KEYS[group.group] ? t(GROUP_LABEL_KEYS[group.group]!) : group.group}</div><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</> : ready ? <p class="clean">{t("buildExport.clean")}</p> : null}
          </div>
          <div class="actions"><div class="planner-actions"><button class="btn btn-primary planner-open" type="button" disabled={!ready} onClick={() => void update(desktopView.rpc!.request.exportToPlanner({}))}><span aria-hidden="true">↗</span> {t("buildExport.open")}</button><button class="btn planner-copy" type="button" disabled={!ready} onClick={() => void copyLink()}><span aria-hidden="true">{copied ? "✓" : "⧉"}</span> {t(copied ? "buildExport.copied" : "buildExport.copy")}</button></div>{selectedInspected ? <button class="btn danger-button" type="button" onClick={() => setConfirmAction("delete")}>{t("buildExport.removePlayer")}</button> : null}<span class="grow" />{state?.lastExportedAt ? <span class="confirm">{t("buildExport.openedAt", { when: new Date(state.lastExportedAt).toLocaleTimeString() })}</span> : null}</div>
        </section>
      </div>
      <div class="provenance"><div>{t("buildExport.provenance.snapshot", {
        build: state?.snapshotGameBuild || t("buildExport.provenance.unknownBuild"),
        label: state?.snapshotGameLabel ? ` (${state.snapshotGameLabel})` : "",
        generated: state?.snapshotGeneratedAt ? t("buildExport.provenance.generated", { date: new Date(state.snapshotGeneratedAt).toLocaleDateString() }) : "",
      })}</div><div>{t("buildExport.provenance.derivedFrom")} <a href="#" onClick={(event) => { event.preventDefault(); void desktopView.rpc?.request.openSite({}); }}>spiritvalers.com</a>. {t("buildExport.provenance.fragment")}</div></div>
    </div>
    {confirmAction ? <div class="modal-layer" role="presentation"><form class="modal-card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onSubmit={(event) => { event.preventDefault(); void confirmRosterChange(); }}><div class="modal-head"><div><h2 id="confirm-title">{t(confirmAction === "clear" ? "buildExport.confirm.clearTitle" : "buildExport.confirm.removeTitle")}</h2><p>{confirmAction === "clear" ? t("buildExport.confirm.clearBody") : t("buildExport.confirm.removeBody", { name: state?.character?.name || t("buildExport.confirm.thisPlayer") })}</p></div><button class="modal-close" type="button" aria-label={t("buildExport.confirm.cancel")} onClick={() => setConfirmAction(undefined)}>×</button></div><div class="modal-actions"><button class="btn" type="button" onClick={() => setConfirmAction(undefined)}>{t("buildExport.confirm.cancel")}</button><button ref={confirmButtonRef} class="btn danger-button" type="submit">{t(confirmAction === "clear" ? "buildExport.confirm.clearAction" : "buildExport.removePlayer")}</button></div></form></div> : null}
  </div>;
}

function CharacterCard({ character }: { character: NonNullable<BuildExportState["character"]> }) {
  const t = useTranslator();
  const summary = character.base && character.base !== character.cls ? `${character.base} › ${character.cls}` : character.cls;
  const values: Array<[number, MessageKey]> = [
    [character.equipmentCount, "buildExport.group.equipment"],
    [character.cardCount, "buildExport.group.cards"],
    [character.artifactCount, "buildExport.group.artifacts"],
    [character.gemCount, "buildExport.group.gems"],
    [character.skillCount, "buildExport.group.skills"],
    [character.grimoireCount, "buildExport.group.grimoires"],
    ...(character.weaponSetCount === undefined ? [] : [[character.weaponSetCount, "buildExport.group.weaponSets"] as [number, MessageKey]]),
  ];
  const meta = t("buildExport.card.meta", {
    summary,
    level: character.level,
    job: character.jobLevel,
    inspected: character.inspectedAt ? t("buildExport.card.inspected", { when: new Date(character.inspectedAt).toLocaleString() }) : "",
  });
  return <div class="character-card"><div class="who"><span class="name">{character.name || t("buildExport.card.unnamed")}</span><span class="meta">{meta}</span></div><div class="tally">{values.map(([value, labelKey]) => <div key={labelKey}><span class="n">{value}</span><span class="k">{t(labelKey)}</span></div>)}</div></div>;
}

function rosterClassIcon(className: string): string {
  return classIconUrlForName(className) ?? classIconUrlForName("Weaver")!;
}

render(<App />, document.getElementById("root")!);
