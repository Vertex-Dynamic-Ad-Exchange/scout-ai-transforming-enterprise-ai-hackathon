import type { PageProfile } from "@scout/shared";
import { ConfidenceBar } from "./ConfidenceBar.js";
import { EvidenceTile } from "./EvidenceTile.js";

/**
 * The `PageProfile` snapshot panel inside the drill-down (PRP 06 Task
 * 4 + feature spec lines 67-71). Categories sorted descending by
 * confidence (D6 — categories scroll on overflow, evidence does not).
 * Entity chips one per `detectedEntities[]` element. Evidence grid is
 * up to 12 tiles (`EVIDENCE_REF_CAP`, arbiter D6) — never padded with
 * placeholders when fewer are present.
 *
 * `null`-profile rendering is the Drilldown's responsibility (D10):
 * this component never receives `null`. If a future caller passes one,
 * TypeScript would catch it; the component does not defensively
 * branch on undefined either, so a regression surfaces loudly.
 */
export interface ProfileSnapshotProps {
  profile: PageProfile;
}

export function ProfileSnapshot({ profile }: ProfileSnapshotProps): JSX.Element {
  const sortedCategories = [...profile.categories].sort(
    (a, b) => b.confidence - a.confidence,
  );

  return (
    <section
      data-testid="profile-snapshot"
      aria-labelledby="ps-h"
      style={{ marginTop: 16 }}
    >
      <h3 id="ps-h" style={{ fontSize: 14, margin: "12px 0 4px" }}>
        Profile snapshot
      </h3>

      <div
        data-testid="profile-categories"
        style={{ maxHeight: "40vh", overflowY: "auto" }}
      >
        {sortedCategories.map((c) => (
          <div
            key={c.label}
            data-testid={`profile-category-${c.label}`}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 40px",
              alignItems: "center",
              gap: 8,
              padding: "2px 0",
            }}
          >
            <span style={{ fontSize: 12 }}>{c.label}</span>
            <ConfidenceBar value={c.confidence} label={c.label} />
            <span style={{ fontSize: 12, color: "#525252" }}>
              {(c.confidence * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {profile.detectedEntities.length > 0 && (
        <div data-testid="profile-entities" style={{ marginTop: 8 }}>
          {profile.detectedEntities.map((e) => (
            <span
              key={`${e.type}:${e.name}`}
              data-testid={`profile-entity-${e.name}`}
              style={{
                display: "inline-block",
                border: "1px solid #d4d4d4",
                borderRadius: 12,
                padding: "0 8px",
                margin: "0 4px 4px 0",
                fontSize: 12,
              }}
            >
              {e.name}
              <span style={{ color: "#a3a3a3", marginLeft: 4 }}>{e.type}</span>
            </span>
          ))}
        </div>
      )}

      <div data-testid="profile-evidence-grid" style={{ marginTop: 8 }}>
        {profile.evidenceRefs.length === 0 ? (
          <p data-testid="profile-evidence-empty" style={{ color: "#737373" }}>
            No evidence captured
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, max-content)",
              gap: 6,
            }}
          >
            {profile.evidenceRefs.map((e, i) => (
              <EvidenceTile key={`${e.uri}-${i}`} evidence={e} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
