import { VerificationVerdictSchema } from "@scout/shared";
import type {
  VerificationVerdict,
  Reason,
  Decision,
  PageProfile,
  Policy,
} from "@scout/shared";
import type { PolicyMatchResult, FiredRule } from "@scout/policy";

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

function profileSignalRef(
  profile: PageProfile,
  policy: Policy,
  fired: FiredRule,
): string | null {
  const rule = policy.rules.find((r) => r.id === fired.ruleId);
  if (!rule) {
    return null;
  }

  switch (fired.kind) {
    case "category": {
      const category = profile.categories.find((c) => c.label === rule.match);
      return category?.label ?? null;
    }
    case "entity": {
      const entity = profile.detectedEntities.find((e) => e.name === rule.match);
      return entity?.name ?? null;
    }
    case "creative_tag":
      return null;
    default: {
      const neverKind: never = fired.kind;
      return neverKind;
    }
  }
}

export function buildReasonsFromMatch(
  profile: PageProfile,
  policy: Policy,
  matchResult: PolicyMatchResult,
): Reason[] {
  const reasons: Reason[] = [];
  for (const fired of matchResult.firedRules) {
    const signalRef = profileSignalRef(profile, policy, fired);
    if (signalRef !== null) {
      reasons.push({
        kind: "profile_signal",
        ref: signalRef,
        detail: `${fired.kind} signal "${signalRef}" matched with confidence ${fired.signalConfidence.toFixed(2)}`,
      });
    }
    reasons.push({
      kind: "policy_rule",
      ref: fired.ruleId,
      detail: `${fired.kind} rule fired with signal confidence ${fired.signalConfidence.toFixed(2)}`,
    });
  }
  return reasons;
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
