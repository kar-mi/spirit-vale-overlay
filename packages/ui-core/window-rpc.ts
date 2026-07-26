import type { WindowFrame } from "./window-chrome.ts";

export type WindowChromeRequests = {
  windowAction: { params: { action: "minimize" | "close" }; response: void };
  getWindowFrame: { params: Record<string, never>; response: WindowFrame };
  setWindowFrame: { params: WindowFrame; response: void };
};

export type MaximizableWindowChromeRequests = WindowChromeRequests & {
  toggleMaximize: { params: Record<string, never>; response: { maximized: boolean } };
};
