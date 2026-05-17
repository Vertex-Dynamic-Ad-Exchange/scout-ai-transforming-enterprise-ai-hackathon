import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Category, EvidenceRef, PageProfile } from "@scout/shared";
import { ProfileSnapshot } from "./ProfileSnapshot.js";

function baseProfile(overrides: Partial<PageProfile> = {}): PageProfile {
  return {
    id: "prof-1",
    url: "https://example.com/path",
    contentHash: "abc",
    categories: [],
    detectedEntities: [],
    evidenceRefs: [],
    capturedAt: "2026-05-17T12:00:00.000Z",
    ttl: 60,
    ...overrides,
  };
}

function ev(i: number, kind: EvidenceRef["kind"] = "screenshot"): EvidenceRef {
  return { kind, uri: `s3://bucket/${kind}-${i}.bin` };
}

function category(label: string, confidence: number): Category {
  return { label, confidence };
}

describe("ProfileSnapshot", () => {
  it("renders 12 EvidenceTile instances for evidenceRefs.length===12 (happy — full grid)", () => {
    const profile = baseProfile({
      evidenceRefs: Array.from({ length: 12 }, (_, i) => ev(i)),
    });
    render(<ProfileSnapshot profile={profile} />);
    expect(screen.getAllByTestId("evidence-tile")).toHaveLength(12);
  });

  it("renders exactly 3 tiles for evidenceRefs.length===3 — no padding, no truncation (edge)", () => {
    const profile = baseProfile({
      evidenceRefs: [ev(0), ev(1, "dom_snippet"), ev(2, "video_frame")],
    });
    render(<ProfileSnapshot profile={profile} />);
    expect(screen.getAllByTestId("evidence-tile")).toHaveLength(3);
  });

  it("renders 'No evidence captured' when evidenceRefs is empty (edge — empty state)", () => {
    render(<ProfileSnapshot profile={baseProfile()} />);
    expect(screen.getByTestId("profile-evidence-empty")).toHaveTextContent(
      "No evidence captured",
    );
    expect(screen.queryAllByTestId("evidence-tile")).toHaveLength(0);
  });

  it("renders all 50 categories without virtualization (edge — uncapped categories)", () => {
    const profile = baseProfile({
      categories: Array.from({ length: 50 }, (_, i) => category(`cat-${i}`, i / 50)),
    });
    render(<ProfileSnapshot profile={profile} />);
    const cats = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid^='profile-category-']"),
    );
    expect(cats).toHaveLength(50);
  });

  it("sorts categories descending by confidence (failure — unsorted input must be rendered sorted)", () => {
    const profile = baseProfile({
      categories: [
        category("low", 0.1),
        category("high", 0.9),
        category("mid", 0.5),
      ],
    });
    render(<ProfileSnapshot profile={profile} />);
    const cats = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid^='profile-category-']"),
    );
    const order = cats.map((el) =>
      el.getAttribute("data-testid")!.replace("profile-category-", ""),
    );
    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("renders detected entity chips with name and type", () => {
    const profile = baseProfile({
      detectedEntities: [
        { name: "Roulette Royale", type: "brand", confidence: 0.8 },
        { name: "Slot Machine", type: "object", confidence: 0.7 },
      ],
    });
    render(<ProfileSnapshot profile={profile} />);
    expect(screen.getByTestId("profile-entity-Roulette Royale")).toBeInTheDocument();
    expect(screen.getByTestId("profile-entity-Slot Machine")).toBeInTheDocument();
  });
});
