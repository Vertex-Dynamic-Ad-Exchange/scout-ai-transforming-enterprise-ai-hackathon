import { VerificationVerdictSchema } from "@scout/shared";
import type { VerificationVerdict, Reason, Decision } from "@scout/shared";
import type { PolicyMatchResult } from "@scout/policy";

export function assembleVerdict(params: {
  decision: Decision;
  reasons: Reason[];
  profileId: string | null;
  policyVersion: string;
  latencyMs: number;
  lobstertrapTraceId: string | null;
}): VerificationVerdict {
  // Defense-in-depth: validates shape before it leaves this module.
  // Catches schema drift while stubs are still in place.
  return VerificationVerdictSchema.parse(params);
}

export function buildReasonsFromMatch(matchResult: PolicyMatchResult): Reason[] {
  return matchResult.firedRules.map((rule) => ({
    kind: "policy_rule" as const,
    ref: rule.ruleId,
    detail: `${rule.kind} rule fired with signal confidence ${rule.signalConfidence.toFixed(2)}`,
  }));
}

export function failClosedVerdict(
  ref: string,
  latencyMs: number,
  profileId: string | null = null,
  policyVersion = "",
): VerificationVerdict {
  return VerificationVerdictSchema.parse({
    decision: "DENY" as const,
    reasons: [{ kind: "fail_closed", ref, detail: "Fail-closed default" }],
    profileId,
    policyVersion,
    latencyMs,
    lobstertrapTraceId: null,
  });
}
