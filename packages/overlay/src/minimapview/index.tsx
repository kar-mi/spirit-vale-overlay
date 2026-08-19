import { computed, signal } from "@preact/signals";
import { render } from "preact";
import { Electroview } from "electrobun/view";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type { MinimapLootDrop, MinimapRpc, MinimapState } from "../minimap-types.ts";

/** World units mapped to the radar's edge. Loot beyond this ring is not drawn. */
const RADAR_WORLD_RADIUS = 60;
const RADAR_PIXEL_RADIUS = 168;
const RING_COUNT = 3;

const state = signal<MinimapState>({ visible: false, loot: [], rarityFilter: 0 });

const rpc = Electroview.defineRPC<MinimapRpc>({
  handlers: { requests: {}, messages: {
    stateChanged: (next) => { state.value = repairRendererPayload(next); },
  } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

interface RadarDot extends MinimapLootDrop {
  px: number;
  py: number;
}

const dots = computed<RadarDot[]>(() => {
  const player = state.value.player;
  if (!player) return [];
  const scale = RADAR_PIXEL_RADIUS / RADAR_WORLD_RADIUS;
  return state.value.loot
    .filter((drop) => (drop.rarity ?? 0) >= state.value.rarityFilter)
    .flatMap((drop) => {
      const dx = drop.x - player.x;
      // The game's world-space x axis maps to the radar's vertical (N/S) axis (inverted), and z maps to horizontal (E/W, inverted).
      const dz = drop.z - player.z;
      const px = -dz * scale;
      const py = -dx * scale;
      if (Math.hypot(px, py) > RADAR_PIXEL_RADIUS) return [];
      return [{ ...drop, px, py }];
    });
});

function RangeRings() {
  const rings = Array.from({ length: RING_COUNT }, (_, index) => {
    const diameter = (RADAR_PIXEL_RADIUS * 2 * (index + 1)) / RING_COUNT;
    return <span key={index} class="minimap-ring" style={{ width: `${diameter}px`, height: `${diameter}px`, left: "50%", top: "50%" }} />;
  });
  return <>{rings}</>;
}

function Compass() {
  return (
    <>
      <span class="minimap-compass north">N</span>
      <span class="minimap-compass south">S</span>
      <span class="minimap-compass east">E</span>
      <span class="minimap-compass west">W</span>
    </>
  );
}

function LootDot({ dot }: { dot: RadarDot }) {
  return (
    <span
      class="minimap-dot"
      style={{ left: `calc(50% + ${dot.px}px)`, top: `calc(50% + ${dot.py}px)` }}
      title={dot.displayName ?? "Loot"}
    />
  );
}

function App() {
  const next = state.value;
  if (!next.visible) return null;
  return (
    <main class="minimap-root">
      <div class="minimap-radar">
        <RangeRings />
        <div class="minimap-crosshair horizontal" />
        <div class="minimap-crosshair vertical" />
        <Compass />
        {next.player ? (
          <>
            <span class="minimap-player" />
            {dots.value.map((dot) => <LootDot key={dot.objectId} dot={dot} />)}
          </>
        ) : <span class="minimap-empty">Waiting for position</span>}
      </div>
    </main>
  );
}

render(<App />, document.getElementById("root")!);
