export const UI_SCALE_VALUES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type UiScale = typeof UI_SCALE_VALUES[number];

let currentUiScale: UiScale = 1;

export function normalizeUiScale(value: unknown): UiScale {
  return UI_SCALE_VALUES.includes(value as UiScale) ? value as UiScale : 1;
}

export function getUiScale(): UiScale { return currentUiScale; }
export function scaledSize(value: number, scale = currentUiScale): number { return Math.ceil(value * scale); }
export function unscaledSize(value: number, scale = currentUiScale): number { return Math.ceil(value / scale); }

export function setUiScaleValue(value: unknown): { next: UiScale; previous: UiScale } {
  const next = normalizeUiScale(value);
  const previous = currentUiScale;
  currentUiScale = next;
  return { next, previous };
}
