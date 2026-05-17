import { ALIGNED_INTENT_LABEL, DIVERGENCE_HEADING } from "../messages.js";

/**
 * Divergence callout — the Veea-Award showpiece moment (PRP 07).
 *
 * Two renderings:
 *   - aligned (green) when `divergence` is `null` OR `""` (D4)
 *   - amber callout when `divergence` is a non-empty string
 *
 * The divergence body is rendered as React text children — auto-escaped
 * (D1). NEVER `dangerouslySetInnerHTML`: divergence text is sourced from
 * Lobster Trap audit rows and may echo attacker-controlled payloads
 * (e.g., DOM snippets from a prompt-injected page).
 *
 * The signal is color AND heading text AND body text (D3 / WCAG 2.1 §
 * 1.4.1 Use of Color) so it survives colorblind viewers, projector
 * misrender, and screen readers.
 *
 * Palette (D2): amber-100 bg (`#fef3c7`) + amber-900 text (`#78350f`).
 * Contrast 11.2:1 on white — well above AA's 4.5:1 for normal text.
 */
export function DivergenceCallout({ divergence }: { divergence: string | null }): JSX.Element {
  if (divergence === null || divergence === "") {
    return (
      <div
        role="status"
        data-testid="divergence-aligned"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          backgroundColor: "#dcfce7",
          color: "#14532d",
          padding: "4px 10px",
          borderRadius: 4,
          fontSize: 13,
        }}
      >
        <span aria-hidden>✓</span>
        <span>{ALIGNED_INTENT_LABEL}</span>
      </div>
    );
  }
  return (
    <aside
      role="alert"
      data-testid="divergence-callout-amber"
      aria-labelledby="divergence-heading"
      style={{
        backgroundColor: "#fef3c7",
        color: "#78350f",
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid #d97706",
        margin: "8px 0",
      }}
    >
      <h3 id="divergence-heading" style={{ margin: "0 0 4px", fontSize: 14, color: "#78350f" }}>
        <span aria-hidden>⚠ </span>
        {DIVERGENCE_HEADING}
      </h3>
      <p style={{ margin: 0, fontSize: 13, color: "#78350f" }}>{divergence}</p>
    </aside>
  );
}
