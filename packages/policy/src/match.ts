import type {
  Decision,
  FiredRule,
  PageProfile,
  Policy,
  PolicyRule,
  PolicyMatchResult,
} from "@scout/shared";
import { PolicyMatchResultSchema } from "@scout/shared";
import { noisyOr } from "./aggregateConfidence.js";
import { evaluateCategoryRule, evaluateCreativeTagRule, evaluateEntityRule } from "./evaluators.js";

export const CONFIDENCE_FLOOR = 0.1;

function getWinningDecision(
  firedRulesByDecision: Record<Decision, FiredRule[]>,
  noFireDecision: Decision,
): Decision {
  if (firedRulesByDecision.DENY.length > 0) {
    return "DENY";
  }
  if (firedRulesByDecision.HUMAN_REVIEW.length > 0) {
    return "HUMAN_REVIEW";
  }
  if (firedRulesByDecision.ALLOW.length > 0) {
    return "ALLOW";
  }
  return noFireDecision;
}

function evaluateRule(profile: PageProfile, rule: PolicyRule): FiredRule[] {
  switch (rule.kind) {
    case "category":
      return profile.categories
        .map((category) =>
          evaluateCategoryRule(category, { rule, confidenceFloor: CONFIDENCE_FLOOR }),
        )
        .filter((entry): entry is FiredRule => entry !== null);
    case "entity":
      return profile.detectedEntities
        .map((entity) => evaluateEntityRule(entity, { rule, confidenceFloor: CONFIDENCE_FLOOR }))
        .filter((entry): entry is FiredRule => entry !== null);
    case "creative_tag": // PageProfile currently has no creative tag signals.
    {
      const creativeTagMatch = evaluateCreativeTagRule();
      return creativeTagMatch === null ? [] : [creativeTagMatch];
    }
    default: {
      const neverRuleKind: never = rule.kind;
      throw new Error(`Unhandled rule kind: ${String(neverRuleKind)}`);
    }
  }
}

export function match(profile: PageProfile, policy: Policy): PolicyMatchResult {
  const firedRulesByDecision: Record<Decision, FiredRule[]> = {
    ALLOW: [],
    DENY: [],
    HUMAN_REVIEW: [],
  };

  for (const rule of policy.rules) {
    const firedRules = evaluateRule(profile, rule);
    for (const firedRule of firedRules) {
      firedRulesByDecision[rule.action].push(firedRule);
    }
  }

  const decision = getWinningDecision(firedRulesByDecision, policy.escalation.ambiguousAction);
  const winningFiredRules = firedRulesByDecision[decision];
  const confidence =
    winningFiredRules.length === 0
      ? 0
      : noisyOr(winningFiredRules.map((rule) => rule.signalConfidence));

  const firedRules = [...winningFiredRules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const result: PolicyMatchResult = {
    decision,
    confidence,
    firedRules,
    policyVersion: policy.version,
  };
  return PolicyMatchResultSchema.parse(result);
}
