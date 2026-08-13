import type { ComponentChildren } from "preact";
import { TitleBar } from "./title-bar.tsx";
import type { WindowFrame } from "./window-chrome.ts";

interface DesktopWindowRequests {
  getWindowFrame(payload: Record<string, never>): Promise<WindowFrame>;
  setWindowFrame(frame: WindowFrame): Promise<unknown>;
  windowAction(payload: { action: "minimize" | "close" }): Promise<unknown>;
  toggleMaximize?(payload: Record<string, never>): Promise<{ maximized: boolean }>;
}

export interface DesktopTitleBarProps {
  appTag: string;
  minWidth: number;
  minHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  defaultX?: number;
  defaultY?: number;
  requests: DesktopWindowRequests | undefined;
  maximizable?: boolean;
  extraControls?: ComponentChildren;
}

export function DesktopTitleBar({ appTag, minWidth, minHeight, defaultWidth, defaultHeight, defaultX = 0, defaultY = 0, requests, maximizable, extraControls }: DesktopTitleBarProps) {
  return (
    <TitleBar
      appTag={appTag}
      minWidth={minWidth}
      minHeight={minHeight}
      getFrame={async () => (await requests?.getWindowFrame({})) ?? { x: defaultX, y: defaultY, width: defaultWidth, height: defaultHeight }}
      setFrame={(frame) => { void requests?.setWindowFrame(frame); }}
      toggleMaximize={maximizable ? async () => (await requests?.toggleMaximize?.({}))?.maximized ?? false : undefined}
      onMinimize={() => { void requests?.windowAction({ action: "minimize" }); }}
      onClose={() => { void requests?.windowAction({ action: "close" }); }}
      extraControls={extraControls}
    />
  );
}
