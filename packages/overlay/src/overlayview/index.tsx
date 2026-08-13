import { render } from "preact";
import { applyControl, chromeState, electroview, gridEnabled } from "./renderer-state.ts";
import { DragGhost, OverlayElement } from "./overlay-element.tsx";
import { DpsChartElement, PartyRankingElement, PersonalDpsElement } from "./meter-elements.tsx";
import {
  CharacterResourceElement,
  RateTrackerElement,
  WeightOverlayElement,
  XpChartElement,
} from "./resource-elements.tsx";
import { StatusOverlayElement } from "./status-elements.tsx";

function App() {
  const next = chromeState.value;
  if (!next) return <main class="overlay-root" />;
  return (
    <main class={next.locked ? "overlay-root" : "overlay-root editing"}>
      {!next.locked && <div class="edit-scrim" />}
      {!next.locked && gridEnabled.value && <div class="grid-overlay" aria-hidden="true" />}
      {!next.locked && (
        <div class="edit-controls">
          <p class="edit-hint">
            {next.displayLayout.length > 1
              ? `Drag elements to arrange the overlay, or onto another screen to move them there. Press ${next.shortcuts.toggleLock} to lock or unlock.`
              : `Drag elements to arrange the overlay. Press ${next.shortcuts.toggleLock} to lock or unlock.`}
          </p>
          <div class="edit-buttons">
            <button
              class={gridEnabled.value ? "lock-pill grid-pill active" : "lock-pill grid-pill"}
              type="button"
              onClick={() => { gridEnabled.value = !gridEnabled.value; }}
            >
              {gridEnabled.value ? "Grid: On" : "Grid: Off"}
            </button>
            <button class="lock-pill" type="button" onClick={() => void setLocked(true)}>Lock overlay</button>
          </div>
        </div>
      )}
      <OverlayElement id="dpsChart" locked={next.locked}><DpsChartElement /></OverlayElement>
      <OverlayElement id="personalDps" locked={next.locked}><PersonalDpsElement /></OverlayElement>
      <OverlayElement id="health" locked={next.locked}><CharacterResourceElement kind="health" /></OverlayElement>
      <OverlayElement id="mana" locked={next.locked}><CharacterResourceElement kind="mana" /></OverlayElement>
      <OverlayElement id="characterXp" locked={next.locked}><CharacterResourceElement kind="character-xp" /></OverlayElement>
      <OverlayElement id="jobXp" locked={next.locked}><CharacterResourceElement kind="job-xp" /></OverlayElement>
      <WeightOverlayElement locked={next.locked} />
      <OverlayElement id="xpTracker" locked={next.locked}><RateTrackerElement kind="xp" locked={next.locked} /></OverlayElement>
      <OverlayElement id="goldTracker" locked={next.locked}><RateTrackerElement kind="gold" locked={next.locked} /></OverlayElement>
      <OverlayElement id="xpChart" locked={next.locked}><XpChartElement /></OverlayElement>
      <OverlayElement id="partyRanking" locked={next.locked}><PartyRankingElement /></OverlayElement>
      <StatusOverlayElement id="buffs" locked={next.locked} category="buffs" flashExpiring />
      <StatusOverlayElement id="debuffs" locked={next.locked} category="debuffs" />
      <StatusOverlayElement id="toggles" locked={next.locked} category="toggles" />
      {!next.locked && <DragGhost surface={next.surface} />}
    </main>
  );
}

function setLocked(locked: boolean): Promise<void> {
  return electroview.rpc?.request.setLocked({ locked }).then((next) => applyControl(next)) ?? Promise.resolve();
}

render(<App />, document.getElementById("root")!);
