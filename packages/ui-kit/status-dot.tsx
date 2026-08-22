export type StatusTone = "is-idle" | "is-ok" | "is-warn" | "is-err";

export interface StatusDotProps {
  tone: StatusTone;
  detail: string;
}

export function StatusDot({ tone, detail }: StatusDotProps) {
  return (
    <div class="status-readout">
      <span class={`status-dot ${tone}`} />
      <span>{detail}</span>
    </div>
  );
}
