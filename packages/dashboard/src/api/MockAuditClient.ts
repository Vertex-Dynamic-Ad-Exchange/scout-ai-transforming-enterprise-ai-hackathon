import type { AuditRow } from "@scout/shared";
import { DEMO_SCENARIOS } from "../fixtures/demoScenarios.js";

/**
 * Test-time in-memory `AuditStore` reader. Seeded with `DEMO_SCENARIOS`
 * by default (PRP 07 Task 10 / D10) so `App.demo.test.tsx` and any
 * future PRP-05/06 visual smoke tests can run the five demo scenarios
 * end-to-end without standing up the Fastify backend.
 *
 * **Test-only.** This symbol MUST NOT reach production bundles
 * (`packages/dashboard/src/__bundle__/no-secrets.test.ts` greps `dist/`
 * for the literal `MockAuditClient` and fails the build if found). The
 * runtime barrel (`src/index.ts`) does NOT re-export it; tests import
 * it directly via `./MockAuditClient.js`.
 *
 * Surface mirrors the read interface in
 * `features/clusterD/dashboard-verdict-views.md:28-39`:
 *   - `query(filter?)` → `{ rows, nextCursor }` reverse-chronological
 *   - `get(id)` → `AuditRow | null` (404-equivalent on miss; NEVER
 *     throws — matches the enumeration-safe contract from
 *     `dashboard-backend`'s `GET /api/verdicts/:id`).
 *
 * Pagination + tenant scoping are deliberately out of scope: the live
 * backend handles both and `MockAuditClient` is only used in render
 * tests where row-set determinism trumps fidelity.
 */
export interface MockQueryFilter {
  kind?: "verdict" | "profile_job_dlq";
  decision?: AuditRow extends { verdict: { decision: infer D } } ? D : never;
}

export interface MockQueryResult {
  rows: AuditRow[];
  nextCursor: string | null;
}

function defaultSeed(): AuditRow[] {
  return DEMO_SCENARIOS.map((s) => s.row);
}

export class MockAuditClient {
  private readonly rows: AuditRow[];

  constructor(seed: AuditRow[] = defaultSeed()) {
    // Sort reverse-chronological once at construction; downstream
    // callers see the same order on every query. `localeCompare` on
    // ISO-8601 strings is correct because the format is
    // lexicographically ordered.
    this.rows = [...seed].sort((a, b) => b.ts.localeCompare(a.ts));
  }

  query(filter: MockQueryFilter = {}): MockQueryResult {
    const filtered = this.rows.filter((r) => {
      if (filter.kind !== undefined && r.kind !== filter.kind) return false;
      return true;
    });
    return { rows: filtered, nextCursor: null };
  }

  get(id: string): AuditRow | null {
    return this.rows.find((r) => r.id === id) ?? null;
  }
}
