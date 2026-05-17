import type { Reason } from "@scout/shared";

/**
 * Reasons grouped by `Reason.kind` (PRP 06 Task 2 + feature spec line
 * 19). Header shows the kind label and a count chip; rows render
 * `ref` + `detail` verbatim. An empty `reasons[]` returns `null` so an
 * empty header never shows — the Drilldown root drives which groups
 * render, this component only owns the *non-empty* group surface.
 *
 * `kind` is `string` (not `Reason.kind`) because the Drilldown's
 * forward-compat path passes the literal "Other" bucket key (D4 +
 * Task 9) — keeping the type wide here lets the bucket key flow
 * through without an enum widening at the boundary.
 */
export interface ReasonGroupProps {
  kind: string;
  reasons: Reason[];
}

const KIND_LABEL: Record<string, string> = {
  profile_signal: "Profile signal",
  policy_rule: "Policy rule",
  arbiter_disagreement: "Arbiter disagreement",
  fail_closed: "Fail closed",
  Other: "Other",
};

function labelFor(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function ReasonGroup({ kind, reasons }: ReasonGroupProps): JSX.Element | null {
  if (reasons.length === 0) return null;
  return (
    <section data-testid={`reason-group-${kind}`} aria-labelledby={`rg-${kind}-h`}>
      <h3 id={`rg-${kind}-h`} style={{ margin: "12px 0 4px", fontSize: 14 }}>
        {labelFor(kind)}{" "}
        <span
          data-testid={`reason-group-count-${kind}`}
          style={{
            background: "#e5e5e5",
            color: "#404040",
            borderRadius: 8,
            padding: "0 6px",
            fontSize: 12,
          }}
        >
          {reasons.length}
        </span>
      </h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {reasons.map((r, i) => (
          <li
            key={`${r.ref}-${i}`}
            data-testid={`reason-row-${kind}-${i}`}
            style={{ padding: "4px 0", borderBottom: "1px solid #f3f4f6" }}
          >
            <code style={{ color: "#525252", fontSize: 12 }}>{r.ref}</code>
            <span style={{ marginLeft: 8 }}>{r.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
