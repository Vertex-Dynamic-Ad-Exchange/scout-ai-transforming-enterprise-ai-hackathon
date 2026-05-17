import type { Decision } from "@scout/shared";
import { ConfidenceBar } from "./ConfidenceBar.js";

/**
 * Arbiter disagreement panel — surfaces `disagreements[]` for
 * `HUMAN_REVIEW` rows (PRP 06 Task 5 + feature spec line 19, line
 * 168). For any other `decision`, the panel returns `null`.
 *
 * `Disagreement` mirrors `features/clusterC/agent-arbiter-scoring.md`
 * lines 27-31. The arbiter package landing later will export a
 * canonical schema in `@scout/shared`; this local type is the
 * forward-compat shim so the drill-down lands now without blocking on
 * the arbiter PRP. Once the schema exists in `@scout/shared`, switch
 * this import in one place.
 *
 * Empty `disagreements[]` paired with `HUMAN_REVIEW` is the step-3
 * below-threshold escalation path (D5). We render the literal
 * "Confidence below threshold — see profile signals" string so the
 * judge does not see an empty list with no explanation.
 */
export type VerifierKind = "text" | "image" | "video";

export interface Disagreement {
  kind: "decision" | "category" | "entity";
  label: string;
  perVerifier: Record<VerifierKind, number>;
}

export interface DisagreementsPanelProps {
  decision: Decision;
  disagreements: Disagreement[];
}

const VERIFIERS: VerifierKind[] = ["text", "image", "video"];

const EMPTY_HUMAN_REVIEW_TEXT =
  "Confidence below threshold — see profile signals";

export function DisagreementsPanel({
  decision,
  disagreements,
}: DisagreementsPanelProps): JSX.Element | null {
  if (decision !== "HUMAN_REVIEW") return null;
  if (disagreements.length === 0) {
    return (
      <section
        data-testid="disagreements-panel"
        aria-labelledby="dp-h"
        style={{ marginTop: 16 }}
      >
        <h3 id="dp-h" style={{ fontSize: 14, margin: "12px 0 4px" }}>
          Verifier disagreement
        </h3>
        <p data-testid="disagreements-empty-fallback" style={{ color: "#737373" }}>
          {EMPTY_HUMAN_REVIEW_TEXT}
        </p>
      </section>
    );
  }
  return (
    <section
      data-testid="disagreements-panel"
      aria-labelledby="dp-h"
      style={{ marginTop: 16 }}
    >
      <h3 id="dp-h" style={{ fontSize: 14, margin: "12px 0 4px" }}>
        Verifier disagreement
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {disagreements.map((d, i) => (
          <li
            key={`${d.kind}-${d.label}-${i}`}
            data-testid={`disagreement-${d.kind}-${d.label}`}
            style={{
              padding: "6px 0",
              borderBottom: "1px solid #f3f4f6",
            }}
          >
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: "#737373" }}>{d.kind}</span>
              <span style={{ marginLeft: 6 }}>{d.label}</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {VERIFIERS.map((v) => {
                const c = d.perVerifier[v];
                return (
                  <div
                    key={v}
                    data-testid={`disagreement-${d.kind}-${d.label}-${v}`}
                    style={{ display: "flex", flexDirection: "column" }}
                  >
                    <span style={{ fontSize: 11, color: "#525252" }}>
                      {v} {(c * 100).toFixed(0)}%
                    </span>
                    <ConfidenceBar value={c} label={`${v} ${d.label}`} />
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
