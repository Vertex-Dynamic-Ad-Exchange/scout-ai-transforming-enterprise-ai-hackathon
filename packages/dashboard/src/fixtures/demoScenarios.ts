import type { AuditRow } from "@scout/shared";

/**
 * Placeholder for the five demo scenarios PRP 07 fills:
 *   1. Clean ALLOW
 *   2. Clean DENY
 *   3. Ambiguous Flash escalation
 *   4. HUMAN_REVIEW arbiter disagreement
 *   5. Cache-miss DENY-then-warm
 *
 * (FEATURE-TODO.md:84-89, feature spec lines 86 + 113.) PRP 04 lands
 * the file + `DemoScenario` type so the view PRPs compile against it;
 * the empty array is intentional and PRP 07's `App.demo.test.tsx`
 * asserts `length === 5` once the fixtures are authored. The shape is
 * the same as `demo-bidstream-seeding.md` produces at runtime — share
 * this file when that PRP lands.
 */
export type DemoScenario = { name: string; row: AuditRow };

export const demoScenarios: DemoScenario[] = [];
