import type { Category, DetectedEntity, PolicyRule, FiredRule } from "@scout/shared";

export interface RuleEvaluationInputs {
  rule: PolicyRule;
  confidenceFloor: number;
}

export function evaluateCategoryRule(
  category: Category,
  { rule, confidenceFloor }: RuleEvaluationInputs,
): FiredRule | null {
  if (category.label !== rule.match || category.confidence < confidenceFloor) {
    return null;
  }
  return {
    ruleId: rule.id,
    kind: "category",
    signalConfidence: category.confidence,
  };
}

export function evaluateEntityRule(
  entity: DetectedEntity,
  { rule, confidenceFloor }: RuleEvaluationInputs,
): FiredRule | null {
  if (entity.name !== rule.match || entity.confidence < confidenceFloor) {
    return null;
  }
  return {
    ruleId: rule.id,
    kind: "entity",
    signalConfidence: entity.confidence,
  };
}

export function evaluateCreativeTagRule(): FiredRule | null {
  return null;
}
