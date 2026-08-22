import type { OverlayDisplay } from "../../../../packages/overlay/src/display-layout.ts";
import { getDisplays } from "../backend/win32.ts";

export const Screen = {
  getAllDisplays: (): OverlayDisplay[] => getDisplays(),
  getPrimaryDisplay: (): OverlayDisplay => getDisplays().find((display) => display.isPrimary) ?? getDisplays()[0] ?? {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    isPrimary: true,
  },
};

export const PATHS = { VIEWS_FOLDER: "resources" };

export class BrowserWindow {}
export class BrowserView {}

export default { events: { on() {}, off() {}, once() {} } };
