import { useState } from "preact/hooks";

export function useExpandedRows(): readonly [ReadonlySet<string>, (key: string) => void] {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void => {
    setExpanded((current) => {
      const updated = new Set(current);
      if (updated.has(key)) updated.delete(key); else updated.add(key);
      return updated;
    });
  };
  return [expanded, toggle] as const;
}
