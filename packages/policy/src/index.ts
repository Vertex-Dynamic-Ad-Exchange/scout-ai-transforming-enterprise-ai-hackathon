import type { PageProfile, Policy, PolicyMatchResult } from "@scout/shared";
import { match } from "./match.js";

export interface PolicyMatcher {
  match(profile: PageProfile, policy: Policy): PolicyMatchResult;
}

export function createPolicyMatcher(): PolicyMatcher {
  return { match };
}

export type { FiredRule, PolicyMatchResult } from "@scout/shared";
export { CONFIDENCE_FLOOR, match } from "./match.js";
