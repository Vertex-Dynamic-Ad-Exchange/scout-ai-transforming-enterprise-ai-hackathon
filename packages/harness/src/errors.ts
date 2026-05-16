import { HarnessError, HarnessException, type HarnessErrorCode } from "@scout/shared";

export function classifySdkError(err: unknown): HarnessErrorCode {
  // Echo through if the SDK orchestrator already classified upstream.
  if (err instanceof HarnessException) return err.code;
  if (typeof err !== "object" || err === null) return HarnessError.UPSTREAM_DOWN;

  const e = err as { status?: number; name?: string };

  // Playwright timeouts surface as Error subclasses with name="TimeoutError".
  if (e.name === "TimeoutError") return HarnessError.TIMEOUT;
  // browser-use Cloud's SessionTimeoutLimitExceededError comes back as HTTP 403.
  if (e.status === 403) return HarnessError.TIMEOUT;

  // Reason: BLOCKED / CONSENT_WALL_UNRESOLVED are emitted by the navigation
  // path in browserMode.ts (PRP-B2), not by SDK error classification. Any
  // unrecognized SDK-shaped failure surfaces as upstream-down so the
  // orchestrator can decide whether to fall back to Agent mode.
  return HarnessError.UPSTREAM_DOWN;
}
