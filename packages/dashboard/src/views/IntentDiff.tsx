import type { LobstertrapDeclaredIntent, LobstertrapDetectedIntent } from "@scout/shared";
import { useSelectedVerdictId } from "./state/selectedVerdict.js";
import { useVerdictDetail } from "./hooks/useVerdictDetail.js";
import { DivergenceCallout } from "./components/DivergenceCallout.js";
import { EMPTY_DECLARED_INTENT } from "./messages.js";

/**
 * IntentDiff — the Veea-Award showpiece (PRP 07, feature spec lines
 * 20-23). Two-column read of one verdict's declared vs. detected
 * intent, with an amber divergence callout when Lobster Trap's DPI
 * observed something the agent did not declare.
 *
 * Rendering rules:
 *   - no selection            → null (no fetch)
 *   - fetch error             → ErrorBanner
 *   - not a verdict row (DLQ) → null (the Timeline's Jobs tab owns DLQ)
 *   - lobstertrapTraceId null → null (no LLM call this verdict, no diff)
 *   - declaredIntent null     → empty-state panel (Policy.declaredIntent
 *                                schema extension not yet landed —
 *                                feature spec line 122; v1 fallback)
 *   - otherwise               → declared column + divergence callout +
 *                                detected column
 *
 * Security (D1): every text payload is rendered as React text
 * children — auto-escaped. Lobster Trap-sourced text (declared_intent,
 * detected_intent, divergence, evidence) is untrusted and may echo
 * attacker-controlled DOM snippets. NEVER `dangerouslySetInnerHTML`.
 */

function DeclaredColumn({ intent }: { intent: LobstertrapDeclaredIntent }): JSX.Element {
  return (
    <section data-testid="intent-declared" aria-label="Declared intent" style={columnStyle}>
      <h3 style={headingStyle}>Declared intent</h3>
      <dl style={dlStyle}>
        <dt style={dtStyle}>agent</dt>
        <dd style={ddStyle}>{intent.agent_id}</dd>
        <dt style={dtStyle}>intent</dt>
        <dd style={ddStyle}>{intent.declared_intent}</dd>
        {intent.declared_paths !== undefined && intent.declared_paths.length > 0 && (
          <>
            <dt style={dtStyle}>paths</dt>
            <dd style={ddStyle}>{intent.declared_paths.join(", ")}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function DetectedColumn({ intent }: { intent: LobstertrapDetectedIntent }): JSX.Element {
  return (
    <section data-testid="intent-detected" aria-label="Detected intent" style={columnStyle}>
      <h3 style={headingStyle}>Detected intent</h3>
      <dl style={dlStyle}>
        <dt style={dtStyle}>observed</dt>
        <dd style={ddStyle}>{intent.detected_intent}</dd>
        {intent.evidence !== null && (
          <>
            <dt style={dtStyle}>evidence</dt>
            <dd style={ddStyle}>{intent.evidence}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function DetectedMissing(): JSX.Element {
  return (
    <section
      data-testid="intent-detected-missing"
      aria-label="Detected intent missing"
      style={{ ...columnStyle, color: "#737373", fontStyle: "italic" }}
    >
      Lobster Trap audit row not yet available for this verdict.
    </section>
  );
}

function EmptyDeclared(): JSX.Element {
  return (
    <section
      data-testid="intent-diff-empty-declared"
      role="status"
      aria-label="Declared intent empty"
      style={{
        padding: 12,
        color: "#737373",
        fontSize: 13,
      }}
    >
      {EMPTY_DECLARED_INTENT}
    </section>
  );
}

function ErrorBanner({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div data-testid="intent-diff-error" role="alert">
      <span>Failed to load intent diff.</span>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function IntentDiff(): JSX.Element | null {
  const id = useSelectedVerdictId();
  const detail = useVerdictDetail(id);

  if (id === null) return null;
  if (detail.isLoading) {
    return (
      <div data-testid="intent-diff-loading" role="status">
        Loading…
      </div>
    );
  }
  if (detail.isError || detail.data === undefined) {
    return <ErrorBanner onRetry={() => void detail.refetch()} />;
  }
  const row = detail.data;
  if (row.kind !== "verdict") return null;
  if (row.verdict.lobstertrapTraceId === null) return null;
  if (row.declaredIntent === null) return <EmptyDeclared />;

  return (
    <section
      data-testid="intent-diff"
      aria-label="Intent diff"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        padding: 12,
      }}
    >
      <DeclaredColumn intent={row.declaredIntent} />
      <div style={{ gridColumn: "1 / span 2" }}>
        <DivergenceCallout divergence={row.detectedIntent?.divergence ?? null} />
      </div>
      {row.detectedIntent !== null ? (
        <DetectedColumn intent={row.detectedIntent} />
      ) : (
        <DetectedMissing />
      )}
    </section>
  );
}

const columnStyle = {
  padding: 12,
  border: "1px solid #e5e5e5",
  borderRadius: 4,
  fontSize: 13,
} as const;

const headingStyle = {
  fontSize: 14,
  margin: "0 0 8px",
} as const;

const dlStyle = {
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "2px 12px",
  margin: 0,
} as const;

const dtStyle = { color: "#737373" } as const;
const ddStyle = { margin: 0 } as const;
