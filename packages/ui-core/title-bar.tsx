import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { initWindowChrome } from "./window-chrome.ts";
import type { WindowChrome, WindowFrame } from "./window-chrome.ts";

export interface TitleBarProps {
  /** Short subtitle after the "Spirit Vale" wordmark, e.g. "Market", "DPS Settings". */
  appTag: string;
  minWidth: number;
  minHeight: number;
  getFrame(): Promise<WindowFrame>;
  setFrame(frame: WindowFrame): unknown;
  /** Omit for windows that must not maximize (e.g. the DPS overlay). */
  toggleMaximize?(): Promise<boolean>;
  onMinimize(): void;
  onClose(): void;
  /** Extra icon buttons (settings, pin, catalog, ...) rendered before minimize/close. */
  extraControls?: ComponentChildren;
}

/** Frameless titlebar wired to {@link initWindowChrome}. Mount once per window. */
export function TitleBar(props: TitleBarProps) {
  const chromeRef = useRef<WindowChrome | undefined>(undefined);
  const [maximized, setMaximized] = useState(false);

  const titlebarRef = (node: HTMLElement | null): void => {
    if (!node || chromeRef.current) return;
    chromeRef.current = initWindowChrome({
      titlebar: node,
      minWidth: props.minWidth,
      minHeight: props.minHeight,
      getFrame: props.getFrame,
      setFrame: props.setFrame,
      toggleMaximize: props.toggleMaximize,
      onMaximizedChange: setMaximized,
    });
  };

  return (
    <header ref={titlebarRef} class="titlebar">
      <div class="brand">
        <img class="brand-icon" src="views://assets/app-icon.png" alt="" />
        <span>Spirit Vale</span>
        <span class="brand-tag">{props.appTag}</span>
      </div>
      <div class="window-controls">
        {props.extraControls}
        <button class="icon-button" type="button" aria-label="Minimize" title="Minimize" onClick={props.onMinimize}>−</button>
        {props.toggleMaximize && (
          <button
            class="icon-button"
            type="button"
            aria-label={maximized ? "Restore" : "Maximize"}
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => void chromeRef.current?.toggleMaximize()}
          >
            {maximized ? "❐" : "▢"}
          </button>
        )}
        <button class="icon-button close-button" type="button" aria-label="Close" title="Close" onClick={props.onClose}>×</button>
      </div>
    </header>
  );
}
