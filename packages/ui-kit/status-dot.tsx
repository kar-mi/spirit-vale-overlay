export type StatusTone = "is-idle" | "is-ok" | "is-warn" | "is-err";

export interface StatusDotProps {
  tone: StatusTone;
  detail: string;
}

/**
 * Status readout: a tone-colored dot plus a detail line. Callers map their own
 * status enum to a tone (each view's status set differs, e.g. DpsAppStatus
 * has "capturing"/"loading" that market/rewards status don't).
 */
export function StatusDot({ tone, detail }: StatusDotProps) {
  return (
    <div class="status-readout">
      <span class={`status-dot ${tone}`} />
      <span>{detail}</span>
    </div>
  );
}
