/**
 * Hand-rolled CSS confidence bar (PRP 06 D7 + feature spec line 64 — no
 * charting library in v1). One `<div>` per bar; `width` is
 * `clampConfidence(v) * 100%`. Out-of-range or `NaN` inputs collapse to
 * 0% rather than crashing the drill-down — verifier authors can ship a
 * malformed `confidence` value (e.g. `0/0`) without the dashboard
 * tearing the entire HUMAN_REVIEW panel down with it.
 */
export function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) {
    console.warn("ConfidenceBar: non-finite confidence, clamping to 0", v);
    return 0;
  }
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export interface ConfidenceBarProps {
  value: number;
  label?: string;
}

export function ConfidenceBar({ value, label }: ConfidenceBarProps): JSX.Element {
  const clamped = clampConfidence(value);
  return (
    <div
      data-testid="confidence-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-label={label}
      style={{
        position: "relative",
        height: 8,
        width: "100%",
        background: "#e5e5e5",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <div
        data-testid="confidence-bar-fill"
        style={{
          height: "100%",
          width: `${clamped * 100}%`,
          background: "#2563eb",
        }}
      />
    </div>
  );
}
