import { useTranslator } from "@svoverlay/i18n/browser";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { initWindowChrome } from "./window-chrome.ts";
import type { WindowChrome, WindowFrame } from "./window-chrome.ts";

export interface TitleBarProps {
  appTag: string;
  minWidth: number;
  minHeight: number;
  getFrame(): Promise<WindowFrame>;
  setFrame(frame: WindowFrame): unknown;
  toggleMaximize?(): Promise<boolean>;
  onMinimize(): void;
  onClose(): void;
  extraControls?: ComponentChildren;
}

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

  const t = useTranslator();
  const maximizeLabel = maximized ? t("titleBar.restore") : t("titleBar.maximize");
  return (
    <header ref={titlebarRef} class="titlebar">
      <div class="brand">
        <img class="brand-icon" src="views://assets/app-icon.png" alt="" />
        <span>Spirit Vale</span>
        <span class="brand-tag">{props.appTag}</span>
      </div>
      <div class="window-controls">
        {props.extraControls}
        <button class="icon-button" type="button" aria-label={t("titleBar.minimize")} title={t("titleBar.minimize")} onClick={props.onMinimize}>−</button>
        {props.toggleMaximize && (
          <button
            class="icon-button"
            type="button"
            aria-label={maximizeLabel}
            title={maximizeLabel}
            onClick={() => void chromeRef.current?.toggleMaximize()}
          >
            {maximized ? "❐" : "▢"}
          </button>
        )}
        <button class="icon-button close-button" type="button" aria-label={t("titleBar.close")} title={t("titleBar.close")} onClick={props.onClose}>×</button>
      </div>
    </header>
  );
}
