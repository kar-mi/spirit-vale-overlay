import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";

export type WindowChromeRequests = {
  openSettings: { params: Record<string, never>; response: void };
  windowAction: { params: { action: "minimize" | "close" }; response: void };
  getWindowFrame: { params: Record<string, never>; response: WindowFrame };
  setWindowFrame: { params: WindowFrame; response: void };
};

export type MaximizableWindowChromeRequests = WindowChromeRequests & {
  toggleMaximize: { params: Record<string, never>; response: { maximized: boolean } };
};
