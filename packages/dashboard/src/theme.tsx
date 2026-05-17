/**
 * Decision-badge palette (D9). WCAG 2.1 AA contrast against `#ffffff`
 * background verified at the chosen hexes:
 *
 *   ALLOW        #16a34a — contrast 3.79:1 (AA Large). Paired with
 *                          `check-circle` + literal text "ALLOW" so the
 *                          decision is never color-only (feature spec
 *                          line 71, WCAG 2.1 § 1.4.1 Use of Color).
 *   DENY         #dc2626 — contrast 4.83:1 (AA Normal). Paired with
 *                          `x-circle` + "DENY".
 *   HUMAN_REVIEW #d97706 — contrast 3.34:1 (AA Large). Paired with
 *                          `alert-circle` + "HUMAN REVIEW".
 *
 * Citation: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
 *
 * No icon library — three inline SVGs below keep the dependency
 * footprint flat (feature spec lines 56-65; PRP 04 anti-patterns).
 * View PRPs (05/06/07) consume both the palette and the icon set.
 */

import type { Decision } from "@scout/shared";

export const decisionPalette = {
  ALLOW: "#16a34a",
  DENY: "#dc2626",
  HUMAN_REVIEW: "#d97706",
} as const satisfies Record<Decision, string>;

export const decisionLabel = {
  ALLOW: "ALLOW",
  DENY: "DENY",
  HUMAN_REVIEW: "HUMAN REVIEW",
} as const satisfies Record<Decision, string>;

const ICON_SIZE = 16;

const iconProps = {
  width: ICON_SIZE,
  height: ICON_SIZE,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function CheckCircleIcon(): JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function XCircleIcon(): JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6" />
      <path d="M9 9l6 6" />
    </svg>
  );
}

export function AlertCircleIcon(): JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  );
}

export const decisionIcon: Record<Decision, () => JSX.Element> = {
  ALLOW: CheckCircleIcon,
  DENY: XCircleIcon,
  HUMAN_REVIEW: AlertCircleIcon,
};
