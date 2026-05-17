import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useVerdictsQuery } from "./hooks/useVerdictsQuery.js";
import { setSelectedVerdictId } from "./state/selectedVerdict.js";
import { ROW_HEIGHT_PX, VerdictRow } from "./components/VerdictRow.js";

/**
 * Left-pane verdict timeline (PRP 05).
 *
 * Virtualized with `@tanstack/react-virtual` — fixed-height rows (D1:
 * 56 px) and overscan 5 (D2). Variable row heights break the
 * estimateSize contract, so `pageUrl` ellipsises rather than wraps.
 *
 * Tab-toggle for the DLQ view (D6) is local `useState` — feature spec
 * line 81: *"Tab toggle is one piece of state, not a route."*
 */
const SCROLLER_HEIGHT = 600;

export function VerdictTimeline(): JSX.Element {
  const [kind, setKind] = useState<"verdict" | "profile_job_dlq">("verdict");
  const query = useVerdictsQuery({ kind });
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = query.data?.rows ?? [];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 5,
    // Bootstraps the visible-range math on the first render before
    // ResizeObserver fires — without it the virtualizer renders zero
    // rows in jsdom (no real layout) and degrades the first paint in
    // real browsers. Real ResizeObserver overwrites this on tick #1.
    initialRect: { width: 1024, height: SCROLLER_HEIGHT },
  });

  if (query.isError) {
    return (
      <div data-testid="timeline-error" role="alert">
        <span>Failed to load verdicts.</span>
        <button type="button" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  }
  if (!query.isLoading && rows.length === 0) {
    return <div data-testid="timeline-empty">No verdicts yet</div>;
  }

  return (
    <section aria-label="Verdict timeline">
      <nav role="tablist" aria-label="Timeline kind">
        <button
          type="button"
          role="tab"
          aria-selected={kind === "verdict"}
          onClick={() => setKind("verdict")}
        >
          Verdicts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "profile_job_dlq"}
          onClick={() => setKind("profile_job_dlq")}
        >
          Jobs
        </button>
      </nav>
      <div
        ref={parentRef}
        tabIndex={-1}
        data-testid="timeline-scroller"
        style={{ height: SCROLLER_HEIGHT, overflow: "auto", position: "relative" }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            if (row === undefined) return null;
            return (
              <VerdictRow
                key={row.id}
                row={row}
                top={vi.start}
                onSelect={() => setSelectedVerdictId(row.id)}
                onEscape={() => parentRef.current?.focus()}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
