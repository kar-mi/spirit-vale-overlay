import { useEffect, useRef, useState } from "preact/hooks";

export interface CustomSelectOption {
  value: string;
  label: string;
}

export interface CustomSelectProps {
  value: string;
  options: readonly CustomSelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
}

/** Themed replacement for a native <select> — the OS-drawn arrow/popup on a real <select>
 * can't be fully re-themed with CSS, so this renders the toggle and option list as ordinary
 * elements styled like the rest of the app (see .custom-select* in theme.css). */
export function CustomSelect({ value, options, onChange, disabled, ariaLabel, id }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = options.find((option) => option.value === value);

  return (
    <div class="custom-select" ref={rootRef}>
      <button
        id={id}
        type="button"
        class="input custom-select-toggle"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span class="custom-select-value">{selected?.label ?? value}</span>
      </button>
      {open && !disabled && (
        <ul class="custom-select-panel" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                class={option.value === value ? "custom-select-option active" : "custom-select-option"}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
