import type { CSSProperties, KeyboardEvent } from "react";
import type { AuditRow } from "@scout/shared";
import { DecisionBadge } from "./DecisionBadge.js";

const ROW_PX = 56;

interface VerdictRowProps {
  row: AuditRow;
  top: number;
  onSelect: () => void;
  onEscape: () => void;
}

function rowStyle(top: number): CSSProperties {
  return {
    position: "absolute",
    top,
    left: 0,
    right: 0,
    height: ROW_PX,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "0 12px",
    boxSizing: "border-box",
    borderBottom: "1px solid #e5e5e5",
  };
}

function onKeyDown(
  e: KeyboardEvent<HTMLDivElement>,
  onSelect: () => void,
  onEscape: () => void,
): void {
  if (e.key === "Enter") {
    e.preventDefault();
    onSelect();
  } else if (e.key === "Escape") {
    e.preventDefault();
    onEscape();
  }
}

export function VerdictRow({
  row,
  top,
  onSelect,
  onEscape,
}: VerdictRowProps): JSX.Element {
  if (row.kind === "profile_job_dlq") {
    return (
      <div
        role="row"
        tabIndex={0}
        data-testid={`verdict-row-${row.id}`}
        data-row-kind="profile_job_dlq"
        style={rowStyle(top)}
        onClick={onSelect}
        onKeyDown={(e) => onKeyDown(e, onSelect, onEscape)}
      >
        <time dateTime={row.ts}>{row.ts}</time>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.pageUrl}
        </span>
        <span data-testid={`dlq-attempts-${row.id}`}>{row.attempts}× retries</span>
        <span style={{ color: "#dc2626" }}>{row.nackReason}</span>
      </div>
    );
  }

  const { verdict, request } = row;
  return (
    <div
      role="row"
      tabIndex={0}
      data-testid={`verdict-row-${row.id}`}
      data-row-kind="verdict"
      style={rowStyle(top)}
      onClick={onSelect}
      onKeyDown={(e) => onKeyDown(e, onSelect, onEscape)}
    >
      <time dateTime={row.ts}>{row.ts}</time>
      <DecisionBadge decision={verdict.decision} />
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {request.pageUrl}
      </span>
      <span>{verdict.latencyMs} ms</span>
      <span style={{ color: "#737373" }}>{verdict.policyVersion}</span>
      {verdict.lobstertrapTraceId !== null && (
        <span
          data-testid={`lobstertrap-chip-${row.id}`}
          aria-label="Lobster Trap audit linked"
          style={{
            border: "1px solid #d97706",
            color: "#d97706",
            borderRadius: 4,
            padding: "0 6px",
            fontSize: 12,
          }}
        >
          LT
        </span>
      )}
    </div>
  );
}

export const ROW_HEIGHT_PX = ROW_PX;
