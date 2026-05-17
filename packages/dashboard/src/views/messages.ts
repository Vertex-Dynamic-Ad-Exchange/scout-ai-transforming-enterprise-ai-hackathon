/**
 * Pinned content literals for PRP 07's IntentDiff view (D11, D12).
 *
 * Lives in `views/messages.ts` rather than `theme.ts` because the
 * heading is content, NOT theme (D11 — `theme.ts` owns the decision
 * palette and icons, nothing else). The literal is exported so the
 * showpiece test (`App.demo.test.tsx`) can import it instead of
 * duplicating the string — a duplicated literal silently drifts.
 *
 * The heading is paired with a colored callout in `DivergenceCallout`
 * but renders independently as text so the divergence signal is NEVER
 * color-only (D3 / WCAG 2.1 § 1.4.1 Use of Color).
 */
export const DIVERGENCE_HEADING = "Intent divergence detected";

export const EMPTY_DECLARED_INTENT = "Declared intent not authored yet — see policy follow-up.";

export const ALIGNED_INTENT_LABEL = "Declared and detected intent aligned";
