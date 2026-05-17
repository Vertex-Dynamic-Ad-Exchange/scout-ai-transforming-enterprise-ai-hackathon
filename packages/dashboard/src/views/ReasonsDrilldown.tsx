import { useMemo } from "react";
import type { AuditRow, AuditRowVerdict, Reason } from "@scout/shared";
import { useSelectedVerdictId } from "./state/selectedVerdict.js";
import { useVerdictDetail } from "./hooks/useVerdictDetail.js";
import { useFocusReturn } from "./hooks/useFocusReturn.js";
import { ReasonGroup } from "./components/ReasonGroup.js";
import { ProfileSnapshot } from "./components/ProfileSnapshot.js";
import {
  DisagreementsPanel,
  type Disagreement,
} from "./components/DisagreementsPanel.js";

/**
 * Drill-down detail pane (PRP 06).
 *
 * Returns `null` when no row is selected — the pane is the disclosed
 * surface in a WAI-ARIA disclosure pattern (D3): the Timeline row is
 * the invoker, this is the disclosed content, no backdrop, no focus
 * trap. The fetch is owned by `useVerdictDetail`; this component only
 * branches on its result.
 *
 * Security note (PRP 06 § Security guardrails): all text in this view
 * is rendered as React text children — never `dangerouslySetInnerHTML`
 * — so even an arbiter that smuggles HTML into `reason.detail` or
 * `category.label` cannot execute script. Evidence URIs are proxied
 * via `<EvidenceTile>` and never leak the raw `EvidenceRef.uri` to
 * the DOM. If a future variant of this view surfaces the
 * `_lobstertrap.evidence` payload, render it as text the same way.
 */

const KNOWN_KINDS: Reason["kind"][] = [
  "profile_signal",
  "policy_rule",
  "arbiter_disagreement",
  "fail_closed",
];

const OTHER = "Other";

const warnedUnknownKinds = new Set<string>();

// Test-only: warn-once memoization is module-scoped; vitest's
// per-test module isolation does not reset module-scoped state. Tests
// that assert the warn count must call this between cases.
export function __resetReasonsDrilldownWarnings(): void {
  warnedUnknownKinds.clear();
}

function bucketKey(kind: string): string {
  return KNOWN_KINDS.includes(kind as Reason["kind"]) ? kind : OTHER;
}

function groupReasons(reasons: Reason[]): Record<string, Reason[]> {
  const out: Record<string, Reason[]> = {};
  for (const r of reasons) {
    const key = bucketKey(r.kind);
    if (key === OTHER && !warnedUnknownKinds.has(r.kind)) {
      console.warn("ReasonsDrilldown: unknown Reason.kind", r.kind);
      warnedUnknownKinds.add(r.kind);
    }
    (out[key] ??= []).push(r);
  }
  return out;
}

/**
 * Defensive extractor — the arbiter PRP has not yet landed
 * `disagreements[]` on `VerificationVerdict` (or wherever the audit
 * row will carry it). For now we read it forward-compat via an
 * unknown cast so the test can inject by extending the fixture;
 * production verdicts return `[]` and the empty fallback fires.
 */
function readDisagreements(row: AuditRowVerdict): Disagreement[] {
  const slot = (row.verdict as unknown as { disagreements?: Disagreement[] })
    .disagreements;
  return Array.isArray(slot) ? slot : [];
}

interface BidContextProps {
  request: AuditRowVerdict["request"];
}

function BidContext({ request }: BidContextProps): JSX.Element {
  return (
    <section
      data-testid="bid-context"
      aria-label="Bid context"
      style={{ marginTop: 16 }}
    >
      <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Bid context</h3>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "2px 12px",
          fontSize: 12,
          margin: 0,
        }}
      >
        <dt style={{ color: "#737373" }}>pageUrl</dt>
        <dd data-testid="bid-page-url" style={{ margin: 0 }}>
          {request.pageUrl}
        </dd>
        <dt style={{ color: "#737373" }}>creativeRef</dt>
        <dd data-testid="bid-creative-ref" style={{ margin: 0 }}>
          {request.creativeRef}
        </dd>
        <dt style={{ color: "#737373" }}>geo</dt>
        <dd data-testid="bid-geo" style={{ margin: 0 }}>
          {request.geo}
        </dd>
      </dl>
    </section>
  );
}

interface ErrorBannerProps {
  onRetry: () => void;
}

function ErrorBanner({ onRetry }: ErrorBannerProps): JSX.Element {
  return (
    <div data-testid="drilldown-error" role="alert">
      <span>Failed to load verdict.</span>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function ReasonsDrilldown(): JSX.Element | null {
  const id = useSelectedVerdictId();
  const detail = useVerdictDetail(id);
  const { headingRef } = useFocusReturn();

  const data: AuditRow | undefined = detail.data;
  const grouped = useMemo(() => {
    if (data === undefined || data.kind !== "verdict") return {};
    return groupReasons(data.verdict.reasons);
  }, [data]);

  if (id === null) return null;
  if (detail.isLoading) {
    return (
      <div data-testid="drilldown-loading" role="status">
        Loading…
      </div>
    );
  }
  if (detail.isError || data === undefined) {
    return <ErrorBanner onRetry={() => void detail.refetch()} />;
  }
  if (data.kind !== "verdict") {
    // DLQ rows surface in the Timeline's Jobs tab — they don't drill
    // down here. Render nothing rather than half a verdict view.
    return null;
  }

  const disagreements = readDisagreements(data);

  return (
    <section
      data-testid="drilldown"
      aria-labelledby="drilldown-heading"
      style={{ padding: 12 }}
    >
      <h2
        id="drilldown-heading"
        ref={headingRef}
        tabIndex={-1}
        style={{ fontSize: 16, margin: "4px 0 8px" }}
      >
        Verdict {data.id}
      </h2>
      {[...KNOWN_KINDS, OTHER].map((k) => {
        const rs = grouped[k] ?? [];
        if (rs.length === 0) return null;
        return <ReasonGroup key={k} kind={k} reasons={rs} />;
      })}
      {data.profile !== null && <ProfileSnapshot profile={data.profile} />}
      <BidContext request={data.request} />
      <DisagreementsPanel
        decision={data.verdict.decision}
        disagreements={disagreements}
      />
    </section>
  );
}
